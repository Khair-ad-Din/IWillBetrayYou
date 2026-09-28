import fs from "fs";
import path from "path";
import {
  PROVINCE_SETTINGS,
  ProvinceGenerationOptions,
  provinceGenerationOptions,
} from "../src/core/configuration/ProvinceConfig";
import { GameMapSize } from "../src/core/game/Game";
import { GameMap } from "../src/core/game/GameMap";
import {
  generateProvinces,
  NO_PROVINCE,
  ProvinceMap,
} from "../src/core/game/Provinces";
import { genTerrainFromBin } from "../src/core/game/TerrainMapLoader";

// Terrain bytes (must match GameMapImpl): bit 7 = land, low 5 bits = magnitude.
const WATER = 0;
const PLAINS = 0b10000000;
const MOUNTAIN = 0b10000000 | 25;
const IMPASSABLE = 0b10011111;

const OPTS: ProvinceGenerationOptions = {
  targetSize: 1000,
  minProvinces: 1,
  maxProvinces: 10_000,
  minTilesPerProvince: 1,
  minProvinceFraction: 0.25,
  plainsCost: 1,
  highlandCost: 2,
  mountainCost: 4,
};

async function buildMap(
  w: number,
  h: number,
  tile: (x: number, y: number) => number,
): Promise<GameMap> {
  const data = new Uint8Array(w * h);
  let land = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = tile(x, y);
      if (data[y * w + x] & 0x80) land++;
    }
  }
  return genTerrainFromBin({ width: w, height: h, num_land_tiles: land }, data);
}

function isProvinceLand(map: GameMap, t: number): boolean {
  return map.isLand(t) && !map.isImpassable(t);
}

/** Number of 4-connected components of each province. */
function componentsPerProvince(map: GameMap, p: ProvinceMap): Int32Array {
  const w = map.width();
  const n = w * map.height();
  const seen = new Uint8Array(n);
  const components = new Int32Array(p.count + 1);
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    const id = p.ids[start];
    if (id === NO_PROVINCE || seen[start]) continue;
    components[id]++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const t = stack.pop()!;
      const x = t % w;
      for (const nb of [
        x > 0 ? t - 1 : -1,
        x < w - 1 ? t + 1 : -1,
        t >= w ? t - w : -1,
        t < n - w ? t + w : -1,
      ]) {
        if (nb < 0 || seen[nb] || p.ids[nb] !== id) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
  }
  return components;
}

describe("generateProvinces", () => {
  test("covers all passable land and nothing else", async () => {
    const map = await buildMap(120, 80, (x, y) => {
      if (x < 10) return WATER;
      if (x === 60 && y < 40) return IMPASSABLE;
      if (y > 60 && x > 90) return MOUNTAIN;
      return PLAINS;
    });
    const p = generateProvinces(map, OPTS);

    let land = 0;
    for (let t = 0; t < map.width() * map.height(); t++) {
      if (isProvinceLand(map, t)) {
        land++;
        expect(p.ids[t]).toBeGreaterThanOrEqual(1);
        expect(p.ids[t]).toBeLessThanOrEqual(p.count);
      } else {
        expect(p.ids[t]).toBe(NO_PROVINCE);
      }
    }
    const total = Array.from(p.sizes).reduce((a, b) => a + b, 0);
    expect(total).toBe(land);
    for (let id = 1; id <= p.count; id++) {
      expect(p.sizes[id]).toBeGreaterThan(0);
    }
  });

  test("is deterministic", async () => {
    const tile = (x: number, y: number) =>
      (x * 7 + y * 13) % 29 === 0 ? MOUNTAIN : PLAINS;
    const a = generateProvinces(await buildMap(150, 100, tile), OPTS);
    const b = generateProvinces(await buildMap(150, 100, tile), OPTS);
    expect(b.count).toBe(a.count);
    expect(Buffer.from(b.ids.buffer).equals(Buffer.from(a.ids.buffer))).toBe(
      true,
    );
  });

  test("makes about landTiles / targetSize provinces", async () => {
    const map = await buildMap(200, 200, () => PLAINS);
    const p = generateProvinces(map, OPTS);
    // 40 000 land tiles / 1000 per province.
    expect(p.count).toBeGreaterThanOrEqual(30);
    expect(p.count).toBeLessThanOrEqual(50);
  });

  test("respects the province count clamp", async () => {
    const map = await buildMap(200, 200, () => PLAINS);
    const p = generateProvinces(map, { ...OPTS, maxProvinces: 10 });
    expect(p.count).toBeLessThanOrEqual(12);
  });

  test("provinces on one landmass are contiguous and not too small", async () => {
    const map = await buildMap(200, 150, (x, y) =>
      Math.abs(x - 100) < 3 && y % 40 < 30 ? MOUNTAIN : PLAINS,
    );
    const p = generateProvinces(map, OPTS);
    const components = componentsPerProvince(map, p);
    const minSize = Math.floor(
      Math.floor((200 * 150) / Math.round((200 * 150) / OPTS.targetSize)) *
        OPTS.minProvinceFraction,
    );
    for (let id = 1; id <= p.count; id++) {
      expect(components[id]).toBe(1);
      expect(p.sizes[id]).toBeGreaterThanOrEqual(minSize);
    }
  });

  test("islands get their own provinces and no province spans water", async () => {
    // Mainland on the left, a big island on the right, a 2x2 islet between.
    const map = await buildMap(200, 100, (x, y) => {
      if (x < 90) return PLAINS;
      if (x >= 130) return PLAINS;
      if (x >= 110 && x < 112 && y >= 50 && y < 52) return PLAINS;
      return WATER;
    });
    const p = generateProvinces(map, OPTS);

    const mainland = new Set<number>();
    const island = new Set<number>();
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 200; x++) {
        const id = p.ids[map.ref(x, y)];
        if (x < 90) mainland.add(id);
        if (x >= 130) island.add(id);
      }
    }
    for (const id of island) expect(mainland.has(id)).toBe(false);

    const islet = p.ids[map.ref(110, 50)];
    expect(islet).not.toBe(NO_PROVINCE);
    expect(p.sizes[islet]).toBe(4);

    const components = componentsPerProvince(map, p);
    for (let id = 1; id <= p.count; id++) expect(components[id]).toBe(1);
  });

  test("tiny maps are not split below minTilesPerProvince", async () => {
    const map = await buildMap(20, 20, () => PLAINS);
    const p = generateProvinces(map, {
      ...OPTS,
      minProvinces: 40,
      minTilesPerProvince: 400,
    });
    expect(p.count).toBe(1);
  });

  test("handles maps without land", async () => {
    const map = await buildMap(20, 20, () => WATER);
    const p = generateProvinces(map, OPTS);
    expect(p.count).toBe(0);
    expect(p.ids.every((id) => id === NO_PROVINCE)).toBe(true);
  });

  test("covers the real world test map", async () => {
    const dir = path.join(__dirname, "testdata/maps/world");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const map = await genTerrainFromBin(
      manifest.map,
      new Uint8Array(fs.readFileSync(path.join(dir, "map.bin"))),
    );
    const p = generateProvinces(
      map,
      provinceGenerationOptions(GameMapSize.Normal),
    );
    expect(p.count).toBeGreaterThan(0);
    let mismatches = 0;
    for (let t = 0; t < map.width() * map.height(); t++) {
      if ((p.ids[t] !== NO_PROVINCE) !== isProvinceLand(map, t)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe("provinceGenerationOptions", () => {
  test("uses tilesPerProvince on normal maps", () => {
    expect(provinceGenerationOptions(GameMapSize.Normal).targetSize).toBe(
      PROVINCE_SETTINGS.tilesPerProvince,
    );
  });

  test("shrinks provinces on compact maps", () => {
    expect(provinceGenerationOptions(GameMapSize.Compact).targetSize).toBe(
      Math.round(
        PROVINCE_SETTINGS.tilesPerProvince *
          PROVINCE_SETTINGS.compactSizeMultiplier,
      ),
    );
  });
});
