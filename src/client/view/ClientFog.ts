import { ProvinceMemory, ProvinceVisibility } from "../../core/game/FogOfWar";
import { FogOfWarUpdate } from "../../core/game/GameUpdates";

interface ViewerFog {
  /** Provinces that are not Unknown. */
  visibility: Map<number, ProvinceVisibility>;
  memory: Map<number, ProvinceMemory>;
  known: Set<number>;
  /** Provinces changed since the last drainChanges(). */
  changed: Set<number>;
  /** Set when a full update replaced everything since the last drain. */
  reset: boolean;
}

/**
 * The fog of war as the simulation reports it (FogOfWarUpdate), for every
 * human player; the client reads the local player's. Before the first update
 * (and in games without fog) nothing is fogged.
 */
export class ClientFog {
  private readonly viewers = new Map<number, ViewerFog>();
  private _started = false;
  private _version = 0;

  apply(update: FogOfWarUpdate): void {
    if (update.full) {
      for (const v of this.viewers.values()) {
        for (const p of v.visibility.keys()) v.changed.add(p);
        v.visibility.clear();
        v.memory.clear();
        v.known.clear();
        v.reset = true;
      }
    }
    for (const c of update.provinces) {
      const v = this.viewer(c.viewer);
      if (c.visibility === ProvinceVisibility.Unknown) {
        v.visibility.delete(c.province);
      } else {
        v.visibility.set(c.province, c.visibility);
      }
      if (c.memory !== undefined) v.memory.set(c.province, c.memory);
      else v.memory.delete(c.province);
      v.changed.add(c.province);
    }
    for (const k of update.known) this.viewer(k.viewer).known.add(k.player);
    this._started = true;
    this._version++;
  }

  /** True once the simulation has sent the fog (the game option is on). */
  started(): boolean {
    return this._started;
  }

  /** Bumped on every update. */
  version(): number {
    return this._version;
  }

  /** Whether `viewer` is fogged at all (spectators and the AI are not). */
  tracks(viewer: number): boolean {
    return this._started && this.viewers.has(viewer);
  }

  visibility(viewer: number, province: number): ProvinceVisibility {
    const v = this.viewers.get(viewer);
    if (!this._started || v === undefined) return ProvinceVisibility.Visible;
    return v.visibility.get(province) ?? ProvinceVisibility.Unknown;
  }

  memory(viewer: number, province: number): ProvinceMemory | null {
    return this.viewers.get(viewer)?.memory.get(province) ?? null;
  }

  knows(viewer: number, player: number): boolean {
    const v = this.viewers.get(viewer);
    if (!this._started || v === undefined) return true;
    return player === viewer || v.known.has(player);
  }

  /** Remembered provinces of `viewer`. */
  remembered(viewer: number): number[] {
    const v = this.viewers.get(viewer);
    if (v === undefined) return [];
    const out: number[] = [];
    for (const [p, vis] of v.visibility) {
      if (vis === ProvinceVisibility.Remembered) out.push(p);
    }
    return out;
  }

  /**
   * Provinces whose visibility changed for `viewer` since the last call, and
   * whether a full update replaced everything meanwhile.
   */
  drainChanges(viewer: number): { provinces: number[]; reset: boolean } {
    const v = this.viewers.get(viewer);
    if (v === undefined) return { provinces: [], reset: false };
    const out = { provinces: [...v.changed], reset: v.reset };
    v.changed.clear();
    v.reset = false;
    return out;
  }

  private viewer(id: number): ViewerFog {
    let v = this.viewers.get(id);
    if (v === undefined) {
      v = {
        visibility: new Map(),
        memory: new Map(),
        known: new Set(),
        changed: new Set(),
        reset: true,
      };
      this.viewers.set(id, v);
    }
    return v;
  }
}

/** What the local player knows of another player under fog of war. */
export interface PlayerIntel {
  /** Tiles of theirs the player sees or remembers. */
  tiles: number;
  /** Extra troop-cap tiles from the farms the player knows of. */
  bonusTiles: number;
  /** Whether any of their provinces is in sight right now. */
  live: boolean;
  /** Troops when last seen live (current when `live`), or null if never. */
  troops: number | null;
  /** Tick of that sighting; null while live or never seen. */
  troopsTick: number | null;
  /** Levels of their structures (or count of warships) the player knows. */
  unitLevels(unitType: string): number;
}

/** The fog as drawn on the map (FogFilter), for the rest of the UI. */
export interface FogPerception {
  isActive(): boolean;
  /** Owner smallID of a tile as the local player sees it. */
  displayedOwner(tile: number): number;
  /** Whether the local player sees what is on a tile right now. */
  tileSeen(tile: number): boolean;
  intel(smallID: number): PlayerIntel;
}
