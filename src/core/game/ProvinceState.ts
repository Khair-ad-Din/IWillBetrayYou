import { GameMap, TileRef } from "./GameMap";
import { NO_PROVINCE, ProvinceMap } from "./Provinces";

// Owner counts are keyed by province * OWNER_KEY + owner smallID.
const OWNER_KEY = 0x10000;

/**
 * Runtime province bookkeeping: the tiles of every province and how many of
 * them each owner holds (smallID 0 = unowned). The counts are derived from
 * tile ownership, so they are rebuilt rather than snapshotted.
 */
export class ProvinceState {
  private readonly offsets: Int32Array;
  private readonly tiles: Int32Array;
  private readonly ownedTotal: Int32Array;
  private readonly ownerCounts = new Map<number, number>();

  constructor(
    private readonly provinceMap: ProvinceMap,
    gameMap: GameMap,
  ) {
    const { ids, count, sizes } = provinceMap;
    this.offsets = new Int32Array(count + 2);
    for (let p = 1; p <= count; p++) {
      this.offsets[p + 1] = this.offsets[p] + sizes[p];
    }
    this.tiles = new Int32Array(this.offsets[count + 1]);
    const fill = this.offsets.slice();
    for (let t = 0; t < ids.length; t++) {
      const p = ids[t];
      if (p !== NO_PROVINCE) this.tiles[fill[p]++] = t;
    }
    this.ownedTotal = new Int32Array(count + 1);
    this.rebuildOwnerCounts(gameMap);
  }

  map(): ProvinceMap {
    return this.provinceMap;
  }

  count(): number {
    return this.provinceMap.count;
  }

  /** Province of a tile, or NO_PROVINCE for water and impassable land. */
  provinceOf(tile: TileRef): number {
    return this.provinceMap.ids[tile];
  }

  size(province: number): number {
    return this.provinceMap.sizes[province] ?? 0;
  }

  /** The tiles of a province (a view; do not mutate). */
  tilesOf(province: number): Int32Array {
    return this.tiles.subarray(
      this.offsets[province],
      this.offsets[province + 1],
    );
  }

  /** Tiles of `province` owned by `smallID` (0 = unowned). */
  ownedBy(province: number, smallID: number): number {
    if (smallID === 0) {
      return this.size(province) - this.ownedTotal[province];
    }
    return this.ownerCounts.get(province * OWNER_KEY + smallID) ?? 0;
  }

  /** Records a tile changing hands; smallID 0 = unowned. */
  onOwnerChange(tile: TileRef, prev: number, next: number): void {
    const p = this.provinceMap.ids[tile];
    if (p === NO_PROVINCE || prev === next) return;
    if (prev !== 0) {
      this.ownedTotal[p]--;
      const key = p * OWNER_KEY + prev;
      const c = (this.ownerCounts.get(key) ?? 0) - 1;
      if (c > 0) this.ownerCounts.set(key, c);
      else this.ownerCounts.delete(key);
    }
    if (next !== 0) {
      this.ownedTotal[p]++;
      const key = p * OWNER_KEY + next;
      this.ownerCounts.set(key, (this.ownerCounts.get(key) ?? 0) + 1);
    }
  }

  /** Recounts every owner from the map's tile owners. */
  rebuildOwnerCounts(gameMap: GameMap): void {
    this.ownerCounts.clear();
    this.ownedTotal.fill(0);
    const ids = this.provinceMap.ids;
    for (let t = 0; t < ids.length; t++) {
      if (ids[t] !== NO_PROVINCE && gameMap.hasOwner(t)) {
        this.onOwnerChange(t, 0, gameMap.ownerID(t));
      }
    }
  }
}
