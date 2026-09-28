import { ProvinceGenerationOptions } from "../configuration/ProvinceConfig";
import { PseudoRandom } from "../PseudoRandom";
import { TerrainType } from "./Game";
import { GameMap } from "./GameMap";

/** Province id of tiles that belong to no province (water, impassable). */
export const NO_PROVINCE = 0;

export interface ProvinceMap {
  /** Province id per tile, indexed by TileRef. 1..count, or NO_PROVINCE. */
  readonly ids: Uint16Array;
  /** Number of provinces; ids run from 1 to count. */
  readonly count: number;
  /** Land tiles per province, indexed by id (index 0 is unused). */
  readonly sizes: Int32Array;
}

/**
 * Splits the map's passable land into provinces of roughly
 * `opts.targetSize` tiles. Deterministic: the same map and options always
 * produce the same provinces, using only integer math and a PRNG seeded from
 * the map itself, so every client computes identical results.
 *
 * 1. Seeds are placed on a jittered grid whose cell area is the target size.
 * 2. Seeds grow over land at once (multi-source Dijkstra); highlands and
 *    mountains cost more, so borders tend to follow the relief, and water
 *    stops growth, so coasts and rivers become borders.
 * 3. Land no seed could reach (islands) becomes its own province, however
 *    small: a province never spans water, so capturing one never hands over
 *    land across the sea.
 * 4. Provinces below the minimum size merge into the land neighbor they share
 *    the longest border with (islands have none and stay as they are).
 */
export function generateProvinces(
  map: GameMap,
  opts: ProvinceGenerationOptions,
): ProvinceMap {
  const w = map.width();
  const h = map.height();
  const n = w * h;

  // Growth cost per tile; 0 marks tiles that are not province land.
  const cost = new Uint8Array(n);
  let landCount = 0;
  for (let t = 0; t < n; t++) {
    if (!map.isLand(t)) continue;
    let c: number;
    switch (map.terrainType(t)) {
      case TerrainType.Plains:
        c = opts.plainsCost;
        break;
      case TerrainType.Highland:
        c = opts.highlandCost;
        break;
      case TerrainType.Mountain:
        c = opts.mountainCost;
        break;
      default:
        continue;
    }
    cost[t] = Math.max(1, Math.min(255, Math.floor(c)));
    landCount++;
  }

  if (landCount === 0) {
    return { ids: new Uint16Array(n), count: 0, sizes: new Int32Array(1) };
  }

  const targetCount = Math.max(
    1,
    Math.min(
      Math.floor(landCount / Math.max(1, opts.minTilesPerProvince)),
      Math.max(
        opts.minProvinces,
        Math.min(opts.maxProvinces, Math.round(landCount / opts.targetSize)),
      ),
    ),
  );
  const provinceSize = Math.max(1, Math.floor(landCount / targetCount));
  const minSize = Math.max(
    1,
    Math.floor(provinceSize * opts.minProvinceFraction),
  );

  // Region label per tile during generation; 0 = unassigned.
  const label = new Int32Array(n);
  let labels = 0;

  growFromSeeds(map, cost, label, provinceSize, w, h, () => ++labels);
  labels = claimSeedlessLand(cost, label, labels, w, h);

  const parent = mergeSmallRegions(cost, label, labels, minSize, w, h);
  return renumber(cost, label, parent, labels, n);
}

function growFromSeeds(
  map: GameMap,
  cost: Uint8Array,
  label: Int32Array,
  provinceSize: number,
  w: number,
  h: number,
  nextLabel: () => number,
): void {
  const n = w * h;
  const cell = Math.max(1, Math.floor(Math.sqrt(provinceSize)));
  // A grid cell needs a quarter of its area on land to get a seed; the land
  // of emptier (coastal) cells is claimed by neighboring seeds instead.
  const minCellLand = Math.max(1, Math.ceil((cell * cell) / 4));
  const rng = new PseudoRandom(mapSeed(map, w, h));

  const dist = new Int32Array(n).fill(0x7fffffff);
  const buckets: (number[] | undefined)[] = [];
  const push = (d: number, t: number) => {
    let b = buckets[d];
    if (b === undefined) {
      b = [];
      buckets[d] = b;
    }
    b.push(t);
  };

  for (let cy = 0; cy < h; cy += cell) {
    const yEnd = Math.min(h, cy + cell);
    for (let cx = 0; cx < w; cx += cell) {
      const xEnd = Math.min(w, cx + cell);
      let landInCell = 0;
      for (let y = cy; y < yEnd; y++) {
        const row = y * w;
        for (let x = cx; x < xEnd; x++) {
          if (cost[row + x] !== 0) landInCell++;
        }
      }
      if (landInCell < minCellLand) continue;

      let k = rng.nextInt(0, landInCell);
      let seed = -1;
      for (let y = cy; y < yEnd && seed < 0; y++) {
        const row = y * w;
        for (let x = cx; x < xEnd; x++) {
          if (cost[row + x] === 0) continue;
          if (k === 0) {
            seed = row + x;
            break;
          }
          k--;
        }
      }
      label[seed] = nextLabel();
      dist[seed] = 0;
      push(0, seed);
    }
  }

  // Dial's algorithm: costs are small integers, so buckets indexed by
  // distance replace a priority queue. Ties go to whoever relaxes first,
  // which is deterministic given the fixed seed order.
  const nbuf = [0, 0, 0, 0];
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (b === undefined) continue;
    for (let i = 0; i < b.length; i++) {
      const t = b[i];
      if (dist[t] !== d) continue;
      const l = label[t];
      const count = neighbors4(t, w, n, nbuf);
      for (let j = 0; j < count; j++) {
        const nb = nbuf[j];
        const c = cost[nb];
        if (c === 0) continue;
        const nd = d + c;
        if (nd < dist[nb]) {
          dist[nb] = nd;
          label[nb] = l;
          push(nd, nb);
        }
      }
    }
    buckets[d] = undefined;
  }
}

/** Writes the in-bounds 4-neighbors of `t` into `out`; returns how many. */
function neighbors4(t: number, w: number, n: number, out: number[]): number {
  let k = 0;
  const x = t % w;
  if (x > 0) out[k++] = t - 1;
  if (x < w - 1) out[k++] = t + 1;
  if (t >= w) out[k++] = t - w;
  if (t < n - w) out[k++] = t + w;
  return k;
}

/**
 * Makes every connected piece of land that no seed reached (an island) its
 * own region. Returns the new label count.
 */
function claimSeedlessLand(
  cost: Uint8Array,
  label: Int32Array,
  labels: number,
  w: number,
  h: number,
): number {
  const n = w * h;
  const queue = new Int32Array(n);
  const nbuf = [0, 0, 0, 0];
  for (let start = 0; start < n; start++) {
    if (cost[start] === 0 || label[start] !== 0) continue;
    const l = ++labels;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = l;
    while (head < tail) {
      const count = neighbors4(queue[head++], w, n, nbuf);
      for (let j = 0; j < count; j++) {
        const nb = nbuf[j];
        if (cost[nb] === 0 || label[nb] !== 0) continue;
        label[nb] = l;
        queue[tail++] = nb;
      }
    }
  }
  return labels;
}

/**
 * Merges regions smaller than `minSize` into the neighbor they share the
 * longest border with, smallest first. Returns the union-find parent array.
 */
function mergeSmallRegions(
  cost: Uint8Array,
  label: Int32Array,
  labels: number,
  minSize: number,
  w: number,
  h: number,
): Int32Array {
  const n = w * h;
  const size = new Int32Array(labels + 1);
  const shared: Map<number, number>[] = [];
  for (let l = 0; l <= labels; l++) shared.push(new Map());
  const addShared = (a: number, b: number, v: number) => {
    shared[a].set(b, (shared[a].get(b) ?? 0) + v);
  };

  for (let t = 0; t < n; t++) {
    const a = label[t];
    if (a === 0) continue;
    size[a]++;
    const x = t % w;
    if (x < w - 1) {
      const b = label[t + 1];
      if (b !== 0 && b !== a) {
        addShared(a, b, 1);
        addShared(b, a, 1);
      }
    }
    if (t < n - w) {
      const b = label[t + w];
      if (b !== 0 && b !== a) {
        addShared(a, b, 1);
        addShared(b, a, 1);
      }
    }
  }

  const parent = new Int32Array(labels + 1);
  for (let l = 0; l <= labels; l++) parent[l] = l;

  const small: number[] = [];
  for (let l = 1; l <= labels; l++) {
    if (size[l] > 0 && size[l] < minSize) small.push(l);
  }
  small.sort((a, b) => size[a] - size[b] || a - b);

  for (const l of small) {
    // Merged regions stay keyed by their surviving root, so `l` is a root
    // until something merges it away.
    if (parent[l] !== l || size[l] >= minSize) continue;
    let best = 0;
    let bestShared = 0;
    for (const [nb, v] of shared[l]) {
      if (v > bestShared || (v === bestShared && nb < best)) {
        best = nb;
        bestShared = v;
      }
    }
    if (best === 0) continue; // Isolated island: keep it.

    parent[l] = best;
    size[best] += size[l];
    for (const [nb, v] of shared[l]) {
      shared[nb].delete(l);
      if (nb === best) continue;
      addShared(best, nb, v);
      addShared(nb, best, v);
    }
    shared[best].delete(l);
    shared[l].clear();
  }

  return parent;
}

function renumber(
  cost: Uint8Array,
  label: Int32Array,
  parent: Int32Array,
  labels: number,
  n: number,
): ProvinceMap {
  const find = (l: number): number => {
    let r = l;
    while (parent[r] !== r) r = parent[r];
    while (parent[l] !== r) {
      const next = parent[l];
      parent[l] = r;
      l = next;
    }
    return r;
  };

  const newId = new Int32Array(labels + 1);
  const ids = new Uint16Array(n);
  const counts: number[] = [0];
  let count = 0;
  for (let t = 0; t < n; t++) {
    if (cost[t] === 0 || label[t] === 0) continue;
    const r = find(label[t]);
    let id = newId[r];
    if (id === 0) {
      id = ++count;
      if (id > 0xffff) {
        throw new Error("Too many provinces for a 16-bit province id");
      }
      newId[r] = id;
      counts.push(0);
    }
    ids[t] = id;
    counts[id]++;
  }
  return { ids, count, sizes: Int32Array.from(counts) };
}

/** Seed derived from the map, so a map always gets the same provinces. */
function mapSeed(map: GameMap, w: number, h: number): number {
  let s = Math.imul(w, 0x9e3779b1) ^ Math.imul(h, 0x85ebca6b);
  s ^= Math.imul(map.numLandTiles(), 0xc2b2ae35);
  return s | 0;
}
