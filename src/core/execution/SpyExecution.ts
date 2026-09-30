import { z } from "zod";
import { Execution, Game, Player, PlayerID } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

/** Sends a spy at another player (fog of war only; see SpyNetwork). */
export class SpyExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    private player: Player,
    private targetID: PlayerID,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.active = false;
    const mg = this.mg!;
    const fog = mg.fogOfWar();
    if (fog === null || !mg.hasPlayer(this.targetID)) return;
    fog.spies().send(this.player, mg.player(this.targetID));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SpyExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      player: w.player(this.player),
      targetID: this.targetID,
    });
  }

  restoreSnapshot(s: SpyState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.player = r.player(s.player);
    this.targetID = s.targetID;
  }
}

const SpyStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  targetID: z.string(),
});
type SpyState = z.infer<typeof SpyStateSchema>;

export const SpyExecutionSnapshot = execSnapshotType({
  name: "Spy",
  version: 1,
  schema: SpyStateSchema,
  cls: () => SpyExecution,
});
