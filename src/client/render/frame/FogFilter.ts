import { FOG_SETTINGS } from "../../../core/configuration/ProvinceConfig";
import { ProvinceVisibility } from "../../../core/game/FogOfWar";
import type { ClientFog } from "../../view/ClientFog";
import { OWNER_MASK } from "../gl/utils/TileCodec";
import type { FrameData, UnitState } from "../types";
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_WARSHIP,
} from "../types/UnitType";

/** Who is looking: the local player, and whose units they always see. */
export interface FogViewer {
  smallID: number;
  /** The local player, allies and teammates. */
  isFriendly(smallID: number): boolean;
  /** smallID of a player by their id (name labels are keyed by id). */
  smallIDOf(playerID: string): number | undefined;
}

const NUKES = new Set<string>([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
]);

/** Side of the square cells that decide what is seen at sea. */
const SEA_CELL = 16;

/**
 * Applies the fog of war to what the renderer gets each frame, for the local
 * player:
 *
 * - Tiles: Visible provinces show live; Remembered ones stay frozen as they
 *   were last seen (or, after a reload, painted in the owner the simulation
 *   remembers); Unknown ones look unclaimed.
 * - Units: other players' units only where the player sees (sea tiles count
 *   as seen near a Visible province or in range of a friendly warship, port
 *   or SAM). A nuke aimed at the player is always shown.
 * - Remembered structures are drawn greyed out where they were last seen.
 * - Names, attack rings, nuke target circles and effects follow the same
 *   rules.
 *
 * Returns the frame untouched while the viewer is not fogged.
 */
export class FogFilter {
  private readonly count: number;
  private readonly offsets: Int32Array;
  private readonly tilesOf: Int32Array;
  /** Provinces within about one cell of each SEA_CELL cell. */
  private readonly seaCells: number[][];
  private readonly cellsW: number;
  private readonly display: Uint16Array;
  /** Visibility the display currently reflects, per province. */
  private readonly shown: Uint8Array;
  /** Whether the display holds what the player last saw of a province. */
  private readonly frozen: Uint8Array;
  private active = false;
  private pendingFull = false;
  private viewerID = 0;
  private visionUnits: UnitState[] = [];

  constructor(
    private readonly ids: Uint16Array,
    private readonly mapW: number,
    private readonly mapH: number,
  ) {
    let count = 0;
    for (let i = 0; i < ids.length; i++) if (ids[i] > count) count = ids[i];
    this.count = count;

    const sizes = new Int32Array(count + 2);
    for (let t = 0; t < ids.length; t++) sizes[ids[t] + 1]++;
    this.offsets = new Int32Array(count + 2);
    for (let p = 1; p <= count + 1; p++) {
      this.offsets[p] = this.offsets[p - 1] + sizes[p];
    }
    this.tilesOf = new Int32Array(ids.length);
    const fill = this.offsets.slice();
    for (let t = 0; t < ids.length; t++) this.tilesOf[fill[ids[t]]++] = t;

    this.cellsW = Math.ceil(mapW / SEA_CELL);
    const cellsH = Math.ceil(mapH / SEA_CELL);
    const inCell: Set<number>[] = [];
    for (let c = 0; c < this.cellsW * cellsH; c++) inCell.push(new Set());
    for (let t = 0; t < ids.length; t++) {
      if (ids[t] === 0) continue;
      const x = t % mapW;
      const y = (t - x) / mapW;
      inCell[
        Math.floor(y / SEA_CELL) * this.cellsW + Math.floor(x / SEA_CELL)
      ].add(ids[t]);
    }
    this.seaCells = [];
    for (let cy = 0; cy < cellsH; cy++) {
      for (let cx = 0; cx < this.cellsW; cx++) {
        const near = new Set<number>();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= this.cellsW || ny >= cellsH) {
              continue;
            }
            for (const p of inCell[ny * this.cellsW + nx]) near.add(p);
          }
        }
        this.seaCells.push([...near]);
      }
    }

    this.display = new Uint16Array(ids.length);
    this.shown = new Uint8Array(count + 1);
    this.frozen = new Uint8Array(count + 1);
  }

  /** The renderer lost its state: send the whole map on the next frame. */
  invalidate(): void {
    this.pendingFull = true;
  }

  /** Whether the last filtered frame was fogged. */
  isActive(): boolean {
    return this.active;
  }

  filter(frame: FrameData, fog: ClientFog, viewer: FogViewer): FrameData {
    if (frame.inSpawnPhase || !fog.tracks(viewer.smallID)) {
      if (this.active) {
        // Leaving the fog (e.g. the game ended): repaint everything live.
        this.active = false;
        return { ...frame, changedTiles: null, structuresDirty: true };
      }
      return frame;
    }

    const real = frame.tileState;
    let changedTiles: number[] | null;
    let structuresDirty = frame.structuresDirty;
    const drained = fog.drainChanges(viewer.smallID);
    if (
      !this.active ||
      viewer.smallID !== this.viewerID ||
      drained.reset ||
      this.pendingFull ||
      frame.changedTiles === null
    ) {
      this.pendingFull = false;
      const restart = !this.active || viewer.smallID !== this.viewerID;
      this.active = true;
      this.viewerID = viewer.smallID;
      this.rebuild(real, fog, restart);
      changedTiles = null;
      structuresDirty = true;
    } else {
      changedTiles = [];
      for (const p of drained.provinces) {
        if (this.applyProvince(p, real, fog, changedTiles)) {
          structuresDirty = true;
        }
      }
      const ids = this.ids;
      const shown = this.shown;
      for (const t of frame.changedTiles) {
        const p = ids[t];
        if (p === 0 || shown[p] === ProvinceVisibility.Visible) {
          this.display[t] = real[t];
          changedTiles.push(t);
        }
      }
    }

    this.visionUnits = [];
    for (const u of frame.units.values()) {
      if (
        u.isActive &&
        viewer.isFriendly(u.ownerID) &&
        (u.unitType === UT_WARSHIP ||
          u.unitType === UT_PORT ||
          u.unitType === UT_SAM_LAUNCHER)
      ) {
        this.visionUnits.push(u);
      }
    }

    const me = viewer.smallID;
    const units = new Map<number, UnitState>();
    for (const [id, u] of frame.units) {
      if (this.unitVisible(u, real, viewer)) units.set(id, u);
    }
    let ghostID = -1;
    for (const p of fog.remembered(me)) {
      const memory = fog.memory(me, p);
      if (memory === null) continue;
      for (const s of memory.structures) {
        units.set(ghostID, ghostStructure(ghostID, s));
        ghostID--;
      }
    }

    const names = new Map(frame.names);
    for (const [key, n] of frame.names) {
      const smallID = viewer.smallIDOf(n.playerID);
      const x = Math.floor(n.x);
      const y = Math.floor(n.y);
      if (
        smallID === undefined ||
        !fog.knows(me, smallID) ||
        !this.inBounds(x, y) ||
        this.shown[this.ids[y * this.mapW + x]] === ProvinceVisibility.Unknown
      ) {
        names.delete(key);
      }
    }

    return {
      ...frame,
      tileState: this.display,
      changedTiles,
      structuresDirty,
      units,
      names,
      attackRings: frame.attackRings.filter((r) => this.pointSeen(r.x, r.y)),
      nukeTelegraphs: frame.nukeTelegraphs.filter((n) => {
        if (n.relation !== 2) return true;
        const x = Math.floor(n.x);
        const y = Math.floor(n.y);
        if (!this.inBounds(x, y)) return false;
        const t = y * this.mapW + x;
        return (real[t] & OWNER_MASK) === me || this.tileSeen(t);
      }),
      events: {
        deadUnits: frame.events.deadUnits.filter(
          (d) => viewer.isFriendly(d.ownerSmallID) || this.tileSeen(d.pos),
        ),
        conquestEvents: frame.events.conquestEvents.filter((c) =>
          this.pointSeen(c.x, c.y),
        ),
        bonusEvents: frame.events.bonusEvents.filter(
          (b) => viewer.isFriendly(b.smallID) || this.tileSeen(b.tile),
        ),
      },
    };
  }

  /** Provinces the player remembers, for the grey veil. */
  rememberedProvinces(): number[] {
    const out: number[] = [];
    if (!this.active) return out;
    for (let p = 1; p <= this.count; p++) {
      if (this.shown[p] === ProvinceVisibility.Remembered) out.push(p);
    }
    return out;
  }

  /** Whether a tile is shown at all (not Unknown), for map markers. */
  tileKnown(tile: number): boolean {
    if (!this.active) return true;
    const p = this.ids[tile];
    return p === 0 || this.shown[p] !== ProvinceVisibility.Unknown;
  }

  private rebuild(real: Uint16Array, fog: ClientFog, restart: boolean): void {
    if (restart) this.frozen.fill(0);
    for (let p = 1; p <= this.count; p++) {
      this.applyProvince(p, real, fog, null);
    }
    const ids = this.ids;
    for (let t = 0; t < ids.length; t++) {
      if (ids[t] === 0) this.display[t] = real[t];
    }
  }

  /**
   * Repaints province `p` after its visibility changed; pushes the repainted
   * tiles to `changed` when given. Returns whether its structures change.
   */
  private applyProvince(
    p: number,
    real: Uint16Array,
    fog: ClientFog,
    changed: number[] | null,
  ): boolean {
    if (p <= 0 || p > this.count) return false;
    const vis = fog.visibility(this.viewerID, p);
    const was = this.shown[p];
    this.shown[p] = vis;
    const start = this.offsets[p];
    const end = this.offsets[p + 1];
    const tiles = this.tilesOf;
    const display = this.display;

    if (vis === ProvinceVisibility.Visible) {
      for (let i = start; i < end; i++) display[tiles[i]] = real[tiles[i]];
      this.frozen[p] = 1;
    } else if (vis === ProvinceVisibility.Remembered && this.frozen[p]) {
      // Keep the frozen picture: it is what the player last saw.
      return was !== vis;
    } else {
      const owner =
        vis === ProvinceVisibility.Remembered
          ? (fog.memory(this.viewerID, p)?.owner ?? 0) & OWNER_MASK
          : 0;
      for (let i = start; i < end; i++) display[tiles[i]] = owner;
      this.frozen[p] = vis === ProvinceVisibility.Remembered ? 1 : 0;
    }
    if (changed !== null) {
      for (let i = start; i < end; i++) changed.push(tiles[i]);
    }
    return was !== vis;
  }

  private unitVisible(u: UnitState, real: Uint16Array, viewer: FogViewer) {
    if (viewer.isFriendly(u.ownerID)) return true;
    if (
      NUKES.has(u.unitType) &&
      u.targetTile !== null &&
      (real[u.targetTile] & OWNER_MASK) === viewer.smallID
    ) {
      return true;
    }
    return this.tileSeen(u.pos);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.mapW && y < this.mapH;
  }

  private pointSeen(x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.inBounds(tx, ty) && this.tileSeen(ty * this.mapW + tx);
  }

  /** Whether the player sees what is on `tile` right now. */
  private tileSeen(tile: number): boolean {
    const p = this.ids[tile];
    if (p !== 0) return this.shown[p] === ProvinceVisibility.Visible;
    const x = tile % this.mapW;
    const y = (tile - x) / this.mapW;
    const cell =
      Math.floor(y / SEA_CELL) * this.cellsW + Math.floor(x / SEA_CELL);
    for (const near of this.seaCells[cell] ?? []) {
      if (this.shown[near] === ProvinceVisibility.Visible) return true;
    }
    for (const u of this.visionUnits) {
      const range =
        u.unitType === UT_WARSHIP
          ? FOG_SETTINGS.warshipVisionRange
          : u.unitType === UT_PORT
            ? FOG_SETTINGS.portVisionRange
            : FOG_SETTINGS.samVisionRange;
      const ux = u.pos % this.mapW;
      const uy = (u.pos - ux) / this.mapW;
      const dx = ux - x;
      const dy = uy - y;
      if (dx * dx + dy * dy <= range * range) return true;
    }
    return false;
  }
}

/** A structure as last seen, drawn greyed out (the under-construction look). */
function ghostStructure(
  id: number,
  s: { type: string; tile: number; owner: number; level: number },
): UnitState {
  return {
    id,
    unitType: s.type,
    ownerID: s.owner,
    lastOwnerID: null,
    pos: s.tile,
    lastPos: s.tile,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: false,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: true,
    natural: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: s.level,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
  };
}
