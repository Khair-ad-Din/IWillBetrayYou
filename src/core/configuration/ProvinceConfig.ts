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
};

export interface ProvinceGenerationOptions {
  /** Average land tiles per province for this map size. */
  targetSize: number;
  minProvinces: number;
  maxProvinces: number;
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
    minProvinceFraction: settings.minProvinceFraction,
    plainsCost: settings.plainsCost,
    highlandCost: settings.highlandCost,
    mountainCost: settings.mountainCost,
  };
}
