import { UnitType } from "../../core/game/Game";
import type { GameView } from "./GameView";
import type { PlayerView } from "./PlayerView";

/**
 * What the UI may show about a player under fog of war. Without fog, for
 * the local player, allies and teammates, these are the real values.
 */

/** Tiles the local player knows the player holds. */
export function shownTiles(game: GameView, player: PlayerView): number {
  return game.intel(player)?.tiles ?? player.numTilesOwned();
}

/**
 * Troops, with how many seconds old the figure is (0 = live); troops is
 * null when the local player has never seen them.
 */
export function shownTroops(
  game: GameView,
  player: PlayerView,
): { troops: number | null; ageSeconds: number } {
  const intel = game.intel(player);
  if (intel === null) return { troops: player.troops(), ageSeconds: 0 };
  const age =
    intel.troopsTick === null
      ? 0
      : Math.max(0, Math.floor((game.ticks() - intel.troopsTick) / 10));
  return { troops: intel.troops, ageSeconds: age };
}

/** Gold, or null when the fog hides it (always, for other players). */
export function shownGold(game: GameView, player: PlayerView): bigint | null {
  return game.intel(player) === null ? player.gold() : null;
}

/** Levels of the player's structures (or warships) the local player knows. */
export function shownUnitLevels(
  game: GameView,
  player: PlayerView,
  unitType: UnitType,
): number {
  return (
    game.intel(player)?.unitLevels(unitType) ?? player.totalUnitLevels(unitType)
  );
}

/**
 * The troop cap. Under fog of war, the one the player's known land and
 * cities would give: the real formula fed with what the local player knows.
 */
export function shownMaxTroops(game: GameView, player: PlayerView): number {
  const intel = game.intel(player);
  if (intel === null) return game.config().maxTroops(player);
  const cityLevels = intel.unitLevels(UnitType.City);
  const known = {
    type: () => player.type(),
    isLobbyCreator: () => player.isLobbyCreator(),
    numTilesOwned: () => intel.tiles,
    bonusTroopTiles: () => intel.bonusTiles,
    units: () =>
      cityLevels > 0
        ? [{ isUnderConstruction: () => false, level: () => cityLevels }]
        : [],
  };
  return game.config().maxTroops(known as unknown as PlayerView);
}
