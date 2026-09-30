import { z } from "zod";
import { FOG_SETTINGS } from "../configuration/ProvinceConfig";
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

  init(mg: Game): void {
    this.mg = mg;
    if (this.fog !== null) return;
    this.fog = new FogOfWar(mg);
    mg.setFogOfWar(this.fog);
  }

  tick(ticks: number): void {
    const fog = this.fog!;
    const due =
      !fog.isStarted() ||
      ticks % Math.max(1, FOG_SETTINGS.updateIntervalTicks) === 0;
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
    });
  }

  restoreSnapshot(s: FogOfWarState, r: SnapshotReader): void {
    this.mg = r.game;
    this.active = true;
    this.lastChanges = { provinces: [], known: [] };
    this.fullSyncPending = true;
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
});
type FogOfWarState = z.infer<typeof FogOfWarStateSchema>;

export const FogOfWarExecutionSnapshot = execSnapshotType({
  name: "FogOfWar",
  version: 1,
  schema: FogOfWarStateSchema,
  cls: () => FogOfWarExecution,
});
