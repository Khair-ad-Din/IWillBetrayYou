import { z } from "zod";
import { FOG_SETTINGS, SPY_SETTINGS } from "../configuration/ProvinceConfig";
import {
  FogDelta,
  FogOfWar,
  ProvinceMemory,
  ViewerState,
} from "../game/FogOfWar";
import { Execution, Game, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zBytes, zInt, zPlayerRef, zTile } from "../snapshot/SnapshotType";

/**
 * Runs the fog of war (game option): recomputes every human player's vision
 * every FOG_SETTINGS.updateIntervalTicks once the spawn phase is over, sends
 * the changes to the clients, and keeps what players remember across
 * snapshots.
 */
export class FogOfWarExecution implements Execution {
  private mg: Game | null = null;
  private fog: FogOfWar | null = null;
  private active = true;
  private lastChanges: FogDelta = { provinces: [], known: [] };
  // Not snapshotted: a restored game resends everything on its first tick.
  private fullSyncPending = true;
  // Whether the clients were last sent any spy (to clear the last one).
  private spiesShown = false;

  init(mg: Game): void {
    this.mg = mg;
    if (this.fog !== null) return;
    this.fog = new FogOfWar(mg);
    mg.setFogOfWar(this.fog);
  }

  tick(ticks: number): void {
    const fog = this.fog!;
    // A province a spy just revealed shows at once, not up to an update later.
    const revealed = fog.spies().tick();
    const due =
      revealed ||
      !fog.isStarted() ||
      ticks % Math.max(1, FOG_SETTINGS.updateIntervalTicks) === 0;
    this.sendSpies();
    if (due) this.lastChanges = fog.update();
    else if (!this.fullSyncPending) return;

    if (this.fullSyncPending) {
      this.fullSyncPending = false;
      this.mg!.addUpdate({
        type: GameUpdateType.FogOfWar,
        full: true,
        ...fog.fullState(),
      });
    } else if (
      this.lastChanges.provinces.length > 0 ||
      this.lastChanges.known.length > 0
    ) {
      this.mg!.addUpdate({
        type: GameUpdateType.FogOfWar,
        full: false,
        ...this.lastChanges,
      });
    }
  }

  /**
   * Sends the spies to the clients every tick while any is alive (they
   * move), and once more when the last one is gone.
   */
  private sendSpies(): void {
    const spies = this.fog!.spies();
    const list = spies.list();
    if (list.length === 0 && !this.spiesShown && !this.fullSyncPending) {
      return;
    }
    this.spiesShown = list.length > 0;
    this.mg!.addUpdate({
      type: GameUpdateType.Spies,
      spies: list.map((s) => ({
        id: s.id,
        owner: s.owner,
        x: s.x / 100,
        y: s.y / 100,
        moving: s.x !== s.destX || s.y !== s.destY,
        mission: s.mission,
        target: s.target,
        province: s.investigating ? s.goal : 0,
        auto: s.auto,
        progress: s.investigating
          ? Math.floor(
              (100 * (SPY_SETTINGS.investigateTicks - s.ticksLeft)) /
                SPY_SETTINGS.investigateTicks,
            )
          : null,
      })),
    });
  }

  /** The changes of the last update, for tests. */
  changes(): FogDelta {
    return this.lastChanges;
  }

  fogOfWar(): FogOfWar {
    return this.fog!;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    // Everything stays visible while players pick where to start.
    return false;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    const fog = this.fog;
    return FogOfWarExecutionSnapshot.write({
      started: fog?.isStarted() ?? false,
      viewers: fog === null ? [] : viewersRecord(fog.viewerStates()),
      spies: fog?.spies().state() ?? { spies: [], nextID: 1 },
    });
  }

  restoreSnapshot(s: FogOfWarState, r: SnapshotReader): void {
    this.mg = r.game;
    this.active = true;
    this.lastChanges = { provinces: [], known: [] };
    this.fullSyncPending = true;
    this.spiesShown = false;
    this.fog = new FogOfWar(r.game);
    r.game.setFogOfWar(this.fog);
    const viewers = new Map<number, ViewerState>();
    for (const v of s.viewers) {
      viewers.set(v.id, {
        visibility: v.visibility.slice(),
        memory: new Map(
          v.memory.map((m) => [
            m.province,
            {
              owner: m.owner,
              tick: m.tick,
              structures: m.structures.map((st) => ({
                type: st.type,
                tile: st.tile as TileRef,
                owner: st.owner,
                level: st.level,
              })),
            } satisfies ProvinceMemory,
          ]),
        ),
        revealed: new Set(v.revealed),
        known: new Set(v.known),
      });
    }
    this.fog.restore(s.started, viewers);
    this.fog.spies().restore({
      spies: s.spies.spies.map((spy) => ({ ...spy })),
      nextID: s.spies.nextID,
    });
  }
}

// Collections keep their insertion order, which is the same on every client
// (FogOfWar only fills them in fixed orders), so a restored game iterates
// them exactly like the original.
function viewersRecord(viewers: ReadonlyMap<number, ViewerState>) {
  return [...viewers.entries()].map(([id, v]) => ({
    id,
    visibility: v.visibility.slice(),
    memory: [...v.memory.entries()].map(([province, m]) => ({
      province,
      owner: m.owner,
      tick: m.tick,
      structures: m.structures.map((st) => ({ ...st })),
    })),
    revealed: [...v.revealed],
    known: [...v.known],
  }));
}

const FogOfWarStateSchema = z.object({
  started: z.boolean(),
  viewers: z.array(
    z.object({
      id: zPlayerRef(),
      visibility: zBytes(),
      memory: z.array(
        z.object({
          province: zInt(),
          owner: zPlayerRef(),
          tick: zInt(),
          structures: z.array(
            z.object({
              type: z.enum(UnitType),
              tile: zTile(),
              owner: zPlayerRef(),
              level: zInt(),
            }),
          ),
        }),
      ),
      revealed: z.array(zInt()),
      known: z.array(zPlayerRef()),
    }),
  ),
  spies: z.object({
    spies: z.array(
      z.object({
        id: zInt(),
        owner: zPlayerRef(),
        x: zInt(),
        y: zInt(),
        destX: zInt(),
        destY: zInt(),
        mission: z.enum(["none", "country", "province"]),
        target: zPlayerRef(),
        goal: zInt(),
        investigating: z.boolean(),
        ticksLeft: zInt(),
        auto: z.boolean(),
      }),
    ),
    nextID: zInt(),
  }),
});
type FogOfWarState = z.infer<typeof FogOfWarStateSchema>;

export const FogOfWarExecutionSnapshot = execSnapshotType({
  name: "FogOfWar",
  version: 4,
  migrations: {
    // v2 adds spies; games saved before had none.
    1: (d) => ({ ...d, spies: { spies: [], sent: [], nextID: 1 } }),
    // v3 spies are map units; v2 spies (province hoppers) are dropped.
    2: (d) => ({ ...d, spies: { spies: [], nextID: d.spies.nextID } }),
    // v4 adds automatic exploring (off for older spies).
    3: (d) => ({
      ...d,
      spies: {
        ...d.spies,
        spies: d.spies.spies.map((s: object) => ({ ...s, auto: false })),
      },
    }),
  },
  schema: FogOfWarStateSchema,
  cls: () => FogOfWarExecution,
});
