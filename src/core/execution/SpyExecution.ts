import { z } from "zod";
import { Execution, Game, Player, PlayerID } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zPlayerRef, zTile } from "../snapshot/SnapshotType";

/** A player's spy command (fog of war only; see SpyNetwork). */
export type SpyCommand =
  /** Send the closest spy to spy on a player (menus). */
  | { kind: "send"; targetID: PlayerID }
  /** Buy a spy and place it on one's own tile. */
  | { kind: "buy"; tile: number }
  /** Order a spy at a tile: explore, spy on its country, or move. */
  | { kind: "order"; spyID: number; tile: number }
  /** Turn a spy's automatic exploring on or off. */
  | { kind: "auto"; spyID: number; auto: boolean };

/** Carries out one spy command. */
export class SpyExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    private player: Player,
    private command: SpyCommand,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.active = false;
    const mg = this.mg!;
    const spies = mg.fogOfWar()?.spies();
    if (spies === undefined) return;
    const c = this.command;
    switch (c.kind) {
      case "send":
        if (mg.hasPlayer(c.targetID)) {
          spies.sendAt(this.player, mg.player(c.targetID));
        }
        break;
      case "buy":
        if (mg.isValidRef(c.tile)) spies.buy(this.player, c.tile as TileRef);
        break;
      case "order":
        spies.order(this.player, c.spyID, c.tile as TileRef);
        break;
      case "auto":
        spies.setAuto(this.player, c.spyID, c.auto);
        break;
    }
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
      command: this.command,
    });
  }

  restoreSnapshot(s: SpyState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.player = r.player(s.player);
    this.command = s.command;
  }
}

const SpyStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  command: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("send"), targetID: z.string() }),
    z.object({ kind: z.literal("buy"), tile: zTile() }),
    z.object({ kind: z.literal("order"), spyID: zInt(), tile: zTile() }),
    z.object({ kind: z.literal("auto"), spyID: zInt(), auto: z.boolean() }),
  ]),
});
type SpyState = z.infer<typeof SpyStateSchema>;

export const SpyExecutionSnapshot = execSnapshotType({
  name: "Spy",
  version: 2,
  migrations: {
    // v1 only sent spies at players.
    1: (d) => ({
      active: d.active,
      initialized: d.initialized,
      player: d.player,
      command: { kind: "send", targetID: d.targetID },
    }),
  },
  schema: SpyStateSchema,
  cls: () => SpyExecution,
});
