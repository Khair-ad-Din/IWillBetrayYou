import { RESOURCE_SETTINGS } from "../configuration/ProvinceConfig";
import { PseudoRandom } from "../PseudoRandom";
import { GameMap, TileRef } from "./GameMap";
import { NO_PROVINCE, ProvinceMap } from "./Provinces";

export enum ResourceType {
  Farm = "Farm",
  Mine = "Mine",
  NaturalHarbor = "NaturalHarbor",
}

/** Placement order, so the scarcest (harbors: coast only) pick first. */
export const RESOURCE_TYPES: readonly ResourceType[] = [
  ResourceType.NaturalHarbor,
  ResourceType.Farm,
  ResourceType.Mine,
];

export interface ResourceSite {
  type: ResourceType;
  province: number;
  /** Where the resource sits: the province's central land tile, or for a
   * natural harbor its ocean-shore tile closest to the center. */
  tile: TileRef;
}

/**
 * Picks the provinces that hold a resource and where in them it sits.
 * Deterministic for a given map, provinces and seed (the game id), so every
 * client places the same sites, while each game gets a different layout.
 *
 * - Each type goes to sharePerType of the eligible provinces (at least
 *   minPerType), eligible meaning at least minProvinceTiles large, and for
 *   harbors, touching the open sea.
 * - No two resource provinces are neighbors, whatever their types.
 * - Types take turns picking from one shuffled province order, so no type
 *   gets all the best spots.
 */
export function generateResourceSites(
  map: GameMap,
  provinces: ProvinceMap,
  seed: number,
  settings: typeof RESOURCE_SETTINGS = RESOURCE_SETTINGS,
): ResourceSite[] {
  const { ids, count, sizes } = provinces;
  const w = map.width();
  const n = ids.length;

  // Centroid of each province, then its central tile and its harbor tile.
  const sumX = new Float64Array(count + 1);
  const sumY = new Float64Array(count + 1);
  for (let t = 0; t < n; t++) {
    const p = ids[t];
    if (p === NO_PROVINCE) continue;
    sumX[p] += t % w;
    sumY[p] += Math.floor(t / w);
  }
  const centerTile = new Int32Array(count + 1).fill(-1);
  const harborTile = new Int32Array(count + 1).fill(-1);
  const centerDist = new Float64Array(count + 1).fill(Infinity);
  const harborDist = new Float64Array(count + 1).fill(Infinity);
  const neighbors: Set<number>[] = [];
  for (let p = 0; p <= count; p++) neighbors.push(new Set());
  for (let t = 0; t < n; t++) {
    const p = ids[t];
    if (p === NO_PROVINCE) continue;
    const x = t % w;
    const y = Math.floor(t / w);
    const dx = x - sumX[p] / sizes[p];
    const dy = y - sumY[p] / sizes[p];
    const d = dx * dx + dy * dy;
    if (d < centerDist[p]) {
      centerDist[p] = d;
      centerTile[p] = t;
    }
    if (map.isOceanShore(t) && d < harborDist[p]) {
      harborDist[p] = d;
      harborTile[p] = t;
    }
    // Land adjacency between provinces (right and down cover every pair).
    if (x < w - 1) {
      const q = ids[t + 1];
      if (q !== NO_PROVINCE && q !== p) {
        neighbors[p].add(q);
        neighbors[q].add(p);
      }
    }
    if (t + w < n) {
      const q = ids[t + w];
      if (q !== NO_PROVINCE && q !== p) {
        neighbors[p].add(q);
        neighbors[q].add(p);
      }
    }
  }

  const eligible: number[] = [];
  for (let p = 1; p <= count; p++) {
    if (sizes[p] >= settings.minProvinceTiles) eligible.push(p);
  }
  const target = Math.max(
    settings.minPerType,
    Math.round(eligible.length * settings.sharePerType),
  );
  const order = new PseudoRandom(seed).shuffleArray(eligible);

  const blocked = new Uint8Array(count + 1);
  const placed = new Map<ResourceType, number>();
  const sites: ResourceSite[] = [];
  const cursor = new Map<ResourceType, number>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const type of RESOURCE_TYPES) {
      if ((placed.get(type) ?? 0) >= target) continue;
      let i = cursor.get(type) ?? 0;
      for (; i < order.length; i++) {
        const p = order[i];
        if (blocked[p]) continue;
        const tile =
          type === ResourceType.NaturalHarbor ? harborTile[p] : centerTile[p];
        if (tile < 0) continue;
        sites.push({ type, province: p, tile });
        placed.set(type, (placed.get(type) ?? 0) + 1);
        blocked[p] = 1;
        for (const q of neighbors[p]) blocked[q] = 1;
        progress = true;
        i++;
        break;
      }
      cursor.set(type, i);
    }
  }
  return sites;
}
