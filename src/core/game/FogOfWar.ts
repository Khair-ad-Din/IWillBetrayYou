import { FOG_SETTINGS } from "../configuration/ProvinceConfig";
import { Game, Player, PlayerType, Structures, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { NO_PROVINCE } from "./Provinces";
import { ProvinceState } from "./ProvinceState";
import { SpyNetwork } from "./Spies";

/** How much a player knows about a province under fog of war. */
export enum ProvinceVisibility {
  /** Never seen: it looks unclaimed. */
  Unknown = 0,
  /** Seen before: shown as it was last seen. */
  Remembered = 1,
  /** Seen live. */
  Visible = 2,
}

export interface RememberedStructure {
  type: UnitType;
  tile: TileRef;
  /** smallID of the owner when last seen. */
  owner: number;
  level: number;
}

/** A province as a player last saw it. */
export interface ProvinceMemory {
  /** smallID of the player holding most of it (0 = nobody). */
  owner: number;
  /** Tick it was last seen. */
  tick: number;
  structures: RememberedStructure[];
}

/** A province whose visibility changed for one viewer. */
export interface FogChange {
  viewer: number;
  province: number;
  visibility: ProvinceVisibility;
  /** Set when the province turns Remembered. */
  memory?: ProvinceMemory;
}

/** A player `viewer` saw for the first time. */
export interface FogKnownPlayer {
  viewer: number;
  player: number;
}

/** What one fog update changed. */
export interface FogDelta {
  provinces: FogChange[];
  known: FogKnownPlayer[];
}

/** What one player knows, keyed by their smallID in FogOfWar. */
export interface ViewerState {
  /** ProvinceVisibility per province id (index 0 unused). */
  visibility: Uint8Array;
  memory: Map<number, ProvinceMemory>;
  /** Provinces seen live for the rest of the game (spies). */
  revealed: Set<number>;
  /** smallIDs of the players this viewer has seen. */
  known: Set<number>;
}

const VISION_UNITS = [UnitType.Warship, UnitType.Port, UnitType.SAMLauncher];

/**
 * Fog of war for human players (the AI sees everything). A player sees live:
 *
 * - every province they hold tiles in, and the provinces next to those;
 * - what their warships, ports and SAMs see (FOG_SETTINGS ranges);
 * - provinces revealed to them for good by their spies;
 * - everything their allies and teammates see that way.
 *
 * A province that stops being visible is remembered as it was last seen
 * (main owner and structures); one never seen stays Unknown. A player
 * becomes known to a viewer the first time the viewer sees one of their
 * tiles, and stays known.
 *
 * Nothing is fogged until the first update after the spawn phase.
 * Deterministic: it only reads game state and iterates in fixed orders.
 */
export class FogOfWar {
  private readonly provinces: ProvinceState;
  private readonly adjacency: number[][];
  private readonly viewers = new Map<number, ViewerState>();
  private readonly spyNetwork: SpyNetwork;
  private started = false;

  constructor(private readonly game: Game) {
    this.provinces = game.provinces();
    this.adjacency = provinceAdjacency(game);
    this.spyNetwork = new SpyNetwork(game, this, this.adjacency);
  }

  /** The players' spies (they reveal provinces to their owners). */
  spies(): SpyNetwork {
    return this.spyNetwork;
  }

  /** Provinces revealed to `viewer` for the rest of the game. */
  revealedBy(viewer: Player | number): ReadonlySet<number> {
    return this.viewers.get(smallIDOf(viewer))?.revealed ?? new Set();
  }

  /** False until the first update: everything counts as visible before. */
  isStarted(): boolean {
    return this.started;
  }

  visibility(viewer: Player | number, province: number): ProvinceVisibility {
    const v = this.viewers.get(smallIDOf(viewer));
    if (!this.started || v === undefined) return ProvinceVisibility.Visible;
    return v.visibility[province] as ProvinceVisibility;
  }

  /** How `viewer` last saw `province`, if it is Remembered. */
  memory(viewer: Player | number, province: number): ProvinceMemory | null {
    return this.viewers.get(smallIDOf(viewer))?.memory.get(province) ?? null;
  }

  /** Whether `viewer` has ever seen `other` (always true before the fog). */
  knowsPlayer(viewer: Player | number, other: Player | number): boolean {
    const v = this.viewers.get(smallIDOf(viewer));
    if (!this.started || v === undefined) return true;
    const id = smallIDOf(other);
    return id === smallIDOf(viewer) || v.known.has(id);
  }

  /** Makes `province` visible to `viewer` for the rest of the game. */
  reveal(viewer: Player | number, province: number): void {
    this.viewerState(smallIDOf(viewer)).revealed.add(province);
  }

  /** The tracked viewers, for snapshots and tests. */
  viewerStates(): ReadonlyMap<number, ViewerState> {
    return this.viewers;
  }

  /** Restores the state a snapshot captured. */
  restore(started: boolean, viewers: Map<number, ViewerState>): void {
    this.started = started;
    this.viewers.clear();
    for (const [id, v] of viewers) this.viewers.set(id, v);
  }

  /** Everything every viewer knows, as changes from a blank state. */
  fullState(): FogDelta {
    const provinces: FogChange[] = [];
    const known: FogKnownPlayer[] = [];
    for (const [viewer, v] of this.viewers) {
      for (let p = 1; p < v.visibility.length; p++) {
        const visibility = v.visibility[p] as ProvinceVisibility;
        if (visibility === ProvinceVisibility.Unknown) continue;
        const memory = v.memory.get(p);
        provinces.push(
          memory === undefined
            ? { viewer, province: p, visibility }
            : { viewer, province: p, visibility, memory },
        );
      }
      for (const player of v.known) known.push({ viewer, player });
    }
    return { provinces, known };
  }

  /** Recomputes every human player's vision and returns what changed. */
  update(): FogDelta {
    for (const p of this.game.players()) {
      if (p.type() === PlayerType.Human) this.viewerState(p.smallID());
    }

    const count = this.provinces.count();
    const ownerProvinces = new Map<number, number[]>();
    const provinceOwners: number[][] = [];
    const mainOwner = new Int32Array(count + 1);
    const mainOwnerTiles = new Int32Array(count + 1);
    for (let p = 0; p <= count; p++) provinceOwners.push([]);
    this.provinces.forEachOwnerCount((province, owner, tiles) => {
      let list = ownerProvinces.get(owner);
      if (list === undefined) {
        list = [];
        ownerProvinces.set(owner, list);
      }
      list.push(province);
      provinceOwners[province].push(owner);
      if (
        tiles > mainOwnerTiles[province] ||
        (tiles === mainOwnerTiles[province] && owner < mainOwner[province])
      ) {
        mainOwner[province] = owner;
        mainOwnerTiles[province] = tiles;
      }
    });
    // ProvinceState's map order differs after a snapshot restore.
    for (const owners of provinceOwners) owners.sort((a, b) => a - b);

    const baseVision = new Map<number, Uint8Array>();
    const baseOf = (player: Player): Uint8Array => {
      const id = player.smallID();
      let seen = baseVision.get(id);
      if (seen === undefined) {
        seen = this.baseVision(player, ownerProvinces.get(id) ?? []);
        baseVision.set(id, seen);
      }
      return seen;
    };

    let structures: Map<number, RememberedStructure[]> | null = null;
    const changes: FogChange[] = [];
    const known: FogKnownPlayer[] = [];
    const tick = this.game.ticks();
    const ids = [...this.viewers.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const viewer = this.game.playerBySmallID(id);
      if (!viewer.isPlayer()) continue;
      const state = this.viewers.get(id)!;

      const sources = [baseOf(viewer)];
      for (const other of this.game.players()) {
        if (other !== viewer && viewer.isFriendly(other)) {
          sources.push(baseOf(other));
        }
      }

      for (let p = 1; p <= count; p++) {
        let visible = false;
        for (const s of sources) {
          if (s[p] !== 0) {
            visible = true;
            break;
          }
        }
        const old = state.visibility[p] as ProvinceVisibility;
        if (visible) {
          for (const owner of provinceOwners[p]) {
            if (owner === id || state.known.has(owner)) continue;
            state.known.add(owner);
            known.push({ viewer: id, player: owner });
          }
          if (old !== ProvinceVisibility.Visible) {
            state.visibility[p] = ProvinceVisibility.Visible;
            state.memory.delete(p);
            changes.push({
              viewer: id,
              province: p,
              visibility: ProvinceVisibility.Visible,
            });
          }
        } else if (old === ProvinceVisibility.Visible) {
          structures ??= this.structuresByProvince();
          const memory: ProvinceMemory = {
            owner: mainOwner[p],
            tick,
            structures: structures.get(p) ?? [],
          };
          state.visibility[p] = ProvinceVisibility.Remembered;
          state.memory.set(p, memory);
          changes.push({
            viewer: id,
            province: p,
            visibility: ProvinceVisibility.Remembered,
            memory,
          });
        }
      }
    }
    this.started = true;
    return { provinces: changes, known };
  }

  private viewerState(id: number): ViewerState {
    let v = this.viewers.get(id);
    if (v === undefined) {
      v = {
        visibility: new Uint8Array(this.provinces.count() + 1),
        memory: new Map(),
        revealed: new Set(),
        known: new Set(),
      };
      this.viewers.set(id, v);
    }
    return v;
  }

  /** What `player` sees on their own, one flag per province. */
  private baseVision(player: Player, owned: number[]): Uint8Array {
    const seen = new Uint8Array(this.provinces.count() + 1);
    for (const p of owned) {
      seen[p] = 1;
      for (const nb of this.adjacency[p]) seen[nb] = 1;
    }
    const revealed = this.viewers.get(player.smallID())?.revealed;
    if (revealed !== undefined) for (const p of revealed) seen[p] = 1;

    for (const unit of player.units(VISION_UNITS)) {
      let range: number;
      switch (unit.type()) {
        case UnitType.Warship:
          range = FOG_SETTINGS.warshipVisionRange;
          break;
        case UnitType.Port:
          range = FOG_SETTINGS.portVisionRange;
          break;
        default:
          range = FOG_SETTINGS.samVisionRange;
      }
      this.markCircle(seen, unit.tile(), range);
    }
    return seen;
  }

  /** Flags every province with a sampled tile within `range` of `center`. */
  private markCircle(seen: Uint8Array, center: TileRef, range: number): void {
    const map = this.game.map();
    const ids = this.provinces.map().ids;
    const w = map.width();
    const h = map.height();
    const cx = map.x(center);
    const cy = map.y(center);
    const step = Math.max(1, FOG_SETTINGS.visionSampleStep);
    const r2 = range * range;
    seen[ids[center]] = 1;
    for (let dy = -range; dy <= range; dy += step) {
      const y = cy + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -range; dx <= range; dx += step) {
        const x = cx + dx;
        if (x < 0 || x >= w || dx * dx + dy * dy > r2) continue;
        const p = ids[y * w + x];
        if (p !== NO_PROVINCE) seen[p] = 1;
      }
    }
    seen[NO_PROVINCE] = 0;
  }

  private structuresByProvince(): Map<number, RememberedStructure[]> {
    const byProvince = new Map<number, RememberedStructure[]>();
    for (const unit of this.game.units(Structures.types)) {
      if (!unit.isActive()) continue;
      const p = this.provinces.provinceOf(unit.tile());
      if (p === NO_PROVINCE) continue;
      let list = byProvince.get(p);
      if (list === undefined) {
        list = [];
        byProvince.set(p, list);
      }
      list.push({
        type: unit.type(),
        tile: unit.tile(),
        owner: unit.owner().smallID(),
        level: unit.level(),
      });
    }
    return byProvince;
  }
}

function smallIDOf(p: Player | number): number {
  return typeof p === "number" ? p : p.smallID();
}

/**
 * Neighboring provinces, per province id: those sharing a land border, and
 * those facing each other across at most FOG_SETTINGS.neighborWaterGap water
 * tiles (rivers, narrow straits), scanning rows and columns.
 */
function provinceAdjacency(game: Game): number[][] {
  const provinces = game.provinces();
  const ids = provinces.map().ids;
  const map = game.map();
  const w = map.width();
  const h = map.height();
  const sets: Set<number>[] = [];
  for (let p = 0; p <= provinces.count(); p++) sets.push(new Set());
  const link = (a: number, b: number) => {
    if (a === b || a === NO_PROVINCE || b === NO_PROVINCE) return;
    sets[a].add(b);
    sets[b].add(a);
  };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = ids[row + x];
      if (p === NO_PROVINCE) continue;
      if (x + 1 < w) link(p, ids[row + x + 1]);
      if (y + 1 < h) link(p, ids[row + w + x]);
    }
  }

  const gap = Math.max(0, Math.floor(FOG_SETTINGS.neighborWaterGap));
  // From each land tile facing water, walk across the water (right, then
  // down) and link the province found on the far bank, if close enough.
  const acrossWater = (p: number, start: number, step: number, n: number) => {
    let t = start;
    for (let i = 0; i < n && i < gap; i++, t += step) {
      if (map.isLand(t)) {
        link(p, ids[t]);
        return;
      }
    }
    if (n > gap && map.isLand(t)) link(p, ids[t]);
  };
  if (gap > 0) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const t = row + x;
        const p = ids[t];
        if (p === NO_PROVINCE) continue;
        if (x + 1 < w && !map.isLand(t + 1)) {
          acrossWater(p, t + 1, 1, w - x - 1);
        }
        if (y + 1 < h && !map.isLand(t + w)) {
          acrossWater(p, t + w, w, h - y - 1);
        }
      }
    }
  }
  return sets.map((s) => [...s].sort((a, b) => a - b));
}
