import { GameMapSize } from "../game/Game";

/**
 * Province generation tuning. `tilesPerProvince` is the main knob: the average
 * number of land tiles in one province on a Normal-size map. Everything else
 * (province count, merge thresholds, compact scaling) is derived from it.
 */
export const PROVINCE_SETTINGS = {
  /** Average land tiles per province on a Normal-size map. */
  tilesPerProvince: 6000,
  /**
   * Compact maps have 1/4 of the tiles and 1/4 of the nations. Provinces are
   * made smaller there so each player still owns several of them.
   */
  compactSizeMultiplier: 0.5,
  /** Clamp on the number of provinces for very small / very large maps. */
  minProvinces: 40,
  maxProvinces: 800,
  /**
   * No province is made smaller than this on average, even if that leaves a
   * tiny map with fewer than minProvinces provinces.
   */
  minTilesPerProvince: 500,
  /**
   * Provinces (and seedless land such as islands) smaller than this fraction
   * of the target size are merged into a neighbor.
   */
  minProvinceFraction: 0.25,
  /**
   * Growth cost per terrain type: higher values make provinces stop at
   * highlands and mountains, so borders follow the relief.
   */
  plainsCost: 1,
  highlandCost: 2,
  mountainCost: 4,
  /**
   * Once an attacker holds this fraction of a province, the whole province
   * becomes theirs: the scraps other players (except allies, teammates and
   * spawn-immune players) and unclaimed land hold there flip at once.
   */
  captureThreshold: 0.95,
};

/**
 * Resource sites (farm, mine, natural harbor): where they spawn. Each game
 * places them at random (seeded from the game id), so players cannot learn
 * them by heart.
 */
export const RESOURCE_SETTINGS = {
  /** Fraction of the eligible provinces that get each resource type. */
  sharePerType: 0.08,
  /** At least this many sites of each type, however small the map. */
  minPerType: 2,
  /** Provinces smaller than this (tiny islands) never get a resource. */
  minProvinceTiles: 500,
  /** A farm's owner counts its tiles in the farm's province this many times
   * over towards the troop cap. */
  farmTileMultiplier: 2,
  /** Gold per tick a mine pays per level. */
  mineGoldPerLevel: 300,
  /** Ticks a mine must stay with one owner to gain a level (10 ticks = 1 s).
   * It drops back to level 1 when captured. */
  mineLevelUpTicks: 2 * 60 * 10,
};

export interface ProvinceGenerationOptions {
  /** Average land tiles per province for this map size. */
  targetSize: number;
  minProvinces: number;
  maxProvinces: number;
  minTilesPerProvince: number;
  minProvinceFraction: number;
  plainsCost: number;
  highlandCost: number;
  mountainCost: number;
}

export function provinceGenerationOptions(
  mapSize: GameMapSize,
  settings: typeof PROVINCE_SETTINGS = PROVINCE_SETTINGS,
): ProvinceGenerationOptions {
  const multiplier =
    mapSize === GameMapSize.Compact ? settings.compactSizeMultiplier : 1;
  return {
    targetSize: Math.max(1, Math.round(settings.tilesPerProvince * multiplier)),
    minProvinces: settings.minProvinces,
    maxProvinces: settings.maxProvinces,
    minTilesPerProvince: settings.minTilesPerProvince,
    minProvinceFraction: settings.minProvinceFraction,
    plainsCost: settings.plainsCost,
    highlandCost: settings.highlandCost,
    mountainCost: settings.mountainCost,
  };
}
