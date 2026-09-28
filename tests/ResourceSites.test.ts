import fs from "fs";
import path from "path";
import {
  provinceGenerationOptions,
  RESOURCE_SETTINGS,
} from "../src/core/configuration/ProvinceConfig";
import { GameMapSize } from "../src/core/game/Game";
import { GameMap } from "../src/core/game/GameMap";
import { generateProvinces, ProvinceMap } from "../src/core/game/Provinces";
import {
  generateResourceSites,
  RESOURCE_TYPES,
  ResourceType,
} from "../src/core/game/ResourceSites";
import { genTerrainFromBin } from "../src/core/game/TerrainMapLoader";

let map: GameMap;
let provinces: ProvinceMap;

beforeAll(async () => {
  const dir = path.join(__dirname, "testdata/maps/world");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  map = await genTerrainFromBin(
    manifest.map,
    new Uint8Array(fs.readFileSync(path.join(dir, "map.bin"))),
  );
  provinces = generateProvinces(
    map,
    provinceGenerationOptions(GameMapSize.Normal),
  );
});

function neighborsOf(p: number): Set<number> {
  const w = map.width();
  const out = new Set<number>();
  for (let t = 0; t < provinces.ids.length; t++) {
    if (provinces.ids[t] !== p) continue;
    for (const nb of [t - 1, t + 1, t - w, t + w]) {
      if (nb < 0 || nb >= provinces.ids.length) continue;
      const q = provinces.ids[nb];
      if (q !== 0 && q !== p) out.add(q);
    }
  }
  return out;
}

describe("generateResourceSites", () => {
  test("is deterministic per seed and differs between seeds", () => {
    const a = generateResourceSites(map, provinces, 1234);
    const b = generateResourceSites(map, provinces, 1234);
    const c = generateResourceSites(map, provinces, 98765);
    expect(b).toEqual(a);
    expect(c.map((s) => s.province)).not.toEqual(a.map((s) => s.province));
  });

  test("places sharePerType of the eligible provinces for each type", () => {
    const eligible = Array.from(provinces.sizes)
      .slice(1)
      .filter((s) => s >= RESOURCE_SETTINGS.minProvinceTiles).length;
    const target = Math.max(
      RESOURCE_SETTINGS.minPerType,
      Math.round(eligible * RESOURCE_SETTINGS.sharePerType),
    );
    const sites = generateResourceSites(map, provinces, 42);
    for (const type of RESOURCE_TYPES) {
      const n = sites.filter((s) => s.type === type).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(target);
    }
    // Farms and mines are not limited to the coast: they reach the target.
    expect(sites.filter((s) => s.type === ResourceType.Farm)).toHaveLength(
      target,
    );
  });

  test("no two resource provinces are neighbors, and each holds one", () => {
    const sites = generateResourceSites(map, provinces, 7);
    const chosen = new Set(sites.map((s) => s.province));
    expect(chosen.size).toBe(sites.length);
    for (const s of sites) {
      for (const q of neighborsOf(s.province))
        expect(chosen.has(q)).toBe(false);
    }
  });

  test("sites sit on land of their province; harbors on the open sea", () => {
    const sites = generateResourceSites(map, provinces, 99);
    for (const s of sites) {
      expect(provinces.ids[s.tile]).toBe(s.province);
      expect(map.isLand(s.tile)).toBe(true);
      expect(provinces.sizes[s.province]).toBeGreaterThanOrEqual(
        RESOURCE_SETTINGS.minProvinceTiles,
      );
      if (s.type === ResourceType.NaturalHarbor) {
        expect(map.isOceanShore(s.tile)).toBe(true);
      }
    }
  });

  test("keeps the minimum per type on a map with few provinces", () => {
    const sites = generateResourceSites(map, provinces, 5, {
      ...RESOURCE_SETTINGS,
      sharePerType: 0,
      minPerType: 2,
    });
    for (const type of RESOURCE_TYPES) {
      expect(sites.filter((s) => s.type === type).length).toBeLessThanOrEqual(
        2,
      );
    }
    expect(sites.filter((s) => s.type === ResourceType.Mine)).toHaveLength(2);
  });
});
