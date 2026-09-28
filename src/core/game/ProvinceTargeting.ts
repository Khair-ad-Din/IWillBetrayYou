import { RESOURCE_SETTINGS } from "../configuration/ProvinceConfig";
import { Game, Player } from "./Game";
import { TileRef } from "./GameMap";
import { NO_PROVINCE } from "./Provinces";

/**
 * Picks the province an attack on `targetSmallID` (0 = unclaimed land) should
 * be fought over when the player did not aim at one: among the provinces
 * where the target holds tiles touching the attacker's border, the one with
 * the best score. The score is the contact length, boosted by how much of the
 * province the attacker already holds, so half-taken provinces get finished
 * instead of leaving scraps behind.
 *
 * Provinces in `avoid` are only chosen when nothing else is available; the AI
 * passes the provinces it is already attacking so it opens new fronts. With
 * `preferResources` (the AI), provinces holding a live resource site score
 * aiResourceProvinceWeight times higher.
 * Returns NO_PROVINCE when the target holds nothing next to the attacker.
 */
export function chooseAttackProvince(
  game: Game,
  attacker: Player,
  targetSmallID: number,
  avoid?: ReadonlySet<number>,
  preferResources = false,
): number {
  const map = game.map();
  const provinces = game.provinces();
  const nbuf: TileRef[] = [0, 0, 0, 0];
  const contact = new Map<number, number>();
  attacker.borderTiles().forEach((tile) => {
    const n = map.neighbors4(tile, nbuf);
    for (let i = 0; i < n; i++) {
      const nb = nbuf[i];
      if (map.ownerID(nb) !== targetSmallID) continue;
      if (!map.isLand(nb) || map.isImpassable(nb)) continue;
      const p = provinces.provinceOf(nb);
      if (p !== NO_PROVINCE) contact.set(p, (contact.get(p) ?? 0) + 1);
    }
  });

  const attackerID = attacker.smallID();
  const resourceProvinces = game.resourceProvinces();
  let best = NO_PROVINCE;
  let bestScore = -1;
  let bestAvoided = true;
  for (const [p, c] of contact) {
    const avoided = avoid?.has(p) ?? false;
    // Any province outside `avoid` beats every avoided one.
    if (avoided && !bestAvoided) continue;
    const share = provinces.ownedBy(p, attackerID) / provinces.size(p);
    let score = c * (1 + 2 * share);
    if (preferResources && resourceProvinces.has(p)) {
      score *= RESOURCE_SETTINGS.aiResourceProvinceWeight;
    }
    if (
      (bestAvoided && !avoided) ||
      score > bestScore ||
      (score === bestScore && p < best)
    ) {
      best = p;
      bestScore = score;
      bestAvoided = avoided;
    }
  }
  return best;
}

/** A tile of `province` owned by `ownerSmallID`, or null if it holds none. */
export function tileOfProvinceOwnedBy(
  game: Game,
  province: number,
  ownerSmallID: number,
): TileRef | null {
  const map = game.map();
  const tiles = game.provinces().tilesOf(province);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (map.ownerID(t) === ownerSmallID && map.isLand(t)) return t;
  }
  return null;
}
