import { TerraNullius, UnitType } from "../../core/game/Game";
import { renderTroops } from "../Utils";
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
 * Troops. Under fog of war the real count is never shown: only an estimate,
 * the troop cap the player's known land would give (shownMaxTroops).
 */
export function shownTroops(
  game: GameView,
  player: PlayerView,
): { troops: number; estimated: boolean } {
  if (game.intel(player) === null) {
    return { troops: player.troops(), estimated: false };
  }
  return { troops: shownMaxTroops(game, player), estimated: true };
}

/**
 * Troops in an attack or boat of `attacker`, or "??" when the fog hides them
 * (how many troops others commit is not known).
 */
export function shownAttackTroops(
  game: GameView,
  attacker: PlayerView | TerraNullius | null | undefined,
  troops: number,
): string {
  if (attacker?.isPlayer() && game.intel(attacker as PlayerView) !== null) {
    return "??";
  }
  return renderTroops(troops);
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
