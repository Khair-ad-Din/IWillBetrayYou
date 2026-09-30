import {
  FOG_SETTINGS,
  SPY_SETTINGS,
} from "../src/core/configuration/ProvinceConfig";
import { FogOfWarExecution } from "../src/core/execution/FogOfWarExecution";
import { SpyExecution } from "../src/core/execution/SpyExecution";
import { ProvinceVisibility } from "../src/core/game/FogOfWar";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import {
  DisplayMessageUpdate,
  GameUpdateType,
  SpiesUpdate,
} from "../src/core/game/GameUpdates";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

const MAP = "plains";
const { Unknown, Visible } = ProvinceVisibility;

let game: Game;
let alice: Player;
let bob: Player;
let home: number;
/** Bob's provinces (he holds all of them). */
let bobProvinces: number[];
let messages: DisplayMessageUpdate[];
let spyUpdates: SpiesUpdate[];

function human(name: string): PlayerInfo {
  return new PlayerInfo(name, PlayerType.Human, name, name);
}

function conquerProvince(player: Player, province: number): void {
  for (const t of game.provinces().tilesOf(province)) player.conquer(t);
}

function neighbors(province: number): Set<number> {
  const provinces = game.provinces();
  const out = new Set<number>();
  for (const t of provinces.tilesOf(province)) {
    game.forEachNeighbor(t, (nb) => {
      const p = provinces.provinceOf(nb);
      if (p !== 0 && p !== province) out.add(p);
    });
  }
  return out;
}

function run(ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const updates = game.executeNextTick();
    messages.push(
      ...(updates[GameUpdateType.DisplayEvent] as DisplayMessageUpdate[]),
    );
    spyUpdates.push(...(updates[GameUpdateType.Spies] as SpiesUpdate[]));
  }
}

function vis(player: Player, province: number): ProvinceVisibility {
  return game.fogOfWar()!.visibility(player, province);
}

function spies() {
  return game.fogOfWar()!.spies();
}

function sendSpy(from: Player, to: Player): void {
  game.addExecution(new SpyExecution(from, to.id()));
  run(2);
}

/** Ticks for a spy to reach and investigate every one of Bob's provinces. */
const PLENTY = 400 * (SPY_SETTINGS.investigateTicks + 100);

let savedDetection: number;

beforeEach(async () => {
  savedDetection = SPY_SETTINGS.detectionPerMille;
  SPY_SETTINGS.detectionPerMille = 0;
  game = await setup(MAP, { fogOfWar: true }, [human("alice"), human("bob")]);
  alice = game.player("alice");
  bob = game.player("bob");
  messages = [];
  spyUpdates = [];

  // Alice in province 1; Bob in the provinces two steps away, plus one
  // tile next to Alice so she has seen him.
  home = 1;
  conquerProvince(alice, home);
  const near = neighbors(home);
  const twoAway = new Set<number>();
  for (const p of near) {
    for (const q of neighbors(p)) {
      if (q !== home && !near.has(q)) twoAway.add(q);
    }
  }
  bobProvinces = [...twoAway].sort((a, b) => a - b).slice(0, 3);
  for (const p of bobProvinces) conquerProvince(bob, p);
  bob.conquer(game.provinces().tilesOf([...near][0])[0]);

  alice.addGold(10_000_000n);
  game.addExecution(new FogOfWarExecution());
  run(FOG_SETTINGS.updateIntervalTicks + 1);
});

afterEach(() => {
  SPY_SETTINGS.detectionPerMille = savedDetection;
});

describe("spies", () => {
  test("cost gold, more for each one sent, and at most maxActive at once", () => {
    expect(game.fogOfWar()!.knowsPlayer(alice, bob)).toBe(true);
    const goldBefore = alice.gold();
    expect(spies().cost(alice)).toBe(BigInt(SPY_SETTINGS.baseCost));
    sendSpy(alice, bob);
    expect(spies().activeCount(alice)).toBe(1);
    expect(alice.gold()).toBe(goldBefore - BigInt(SPY_SETTINGS.baseCost));
    expect(spies().cost(alice)).toBe(
      BigInt(SPY_SETTINGS.baseCost + SPY_SETTINGS.costStep),
    );

    for (let i = 1; i < SPY_SETTINGS.maxActive + 2; i++) sendSpy(alice, bob);
    expect(spies().activeCount(alice)).toBe(SPY_SETTINGS.maxActive);
    expect(spies().canSend(alice, bob)).toBe("max_spies");
  });

  test("cannot be sent at yourself, without gold, or at a player never seen", async () => {
    expect(spies().canSend(alice, alice)).toBe("self");
    const poor = game.player("bob");
    poor.removeGold(poor.gold());
    expect(spies().canSend(poor, alice)).toBe("gold");

    // Carol has never been seen by Alice.
    const g2 = await setup(MAP, { fogOfWar: true }, [
      human("alice"),
      human("carol"),
    ]);
    const a = g2.player("alice");
    const carol = g2.player("carol");
    for (const t of g2.provinces().tilesOf(1)) a.conquer(t);
    const far = g2.provinces().count();
    for (const t of g2.provinces().tilesOf(far)) carol.conquer(t);
    a.addGold(1_000_000n);
    g2.addExecution(new FogOfWarExecution());
    for (let i = 0; i < 3; i++) g2.executeNextTick();
    expect(g2.fogOfWar()!.spies().canSend(a, carol)).toBe("unknown_player");
  });

  test("reveal the target's provinces for good, one by one, then come home", () => {
    for (const p of bobProvinces) expect(vis(alice, p)).toBe(Unknown);
    sendSpy(alice, bob);

    // The first province is revealed after one investigation (plus travel).
    let revealed = 0;
    for (let i = 0; i < PLENTY && spies().activeCount(alice) > 0; i += 10) {
      run(10);
      revealed = game.fogOfWar()!.revealedBy(alice).size;
      if (revealed === 1) break;
    }
    expect(revealed).toBe(1);

    run(PLENTY / 10);
    for (const p of bobProvinces) {
      expect(game.fogOfWar()!.revealedBy(alice).has(p)).toBe(true);
    }
    run(FOG_SETTINGS.updateIntervalTicks + 1);
    for (const p of bobProvinces) expect(vis(alice, p)).toBe(Visible);

    // Done: the spy went home and Alice was told.
    expect(spies().activeCount(alice)).toBe(0);
    expect(
      messages.some(
        (m) =>
          m.message === "events_display.spy_finished" &&
          m.playerID === alice.smallID(),
      ),
    ).toBe(true);
  });

  test("its owner sees the province it is in", () => {
    sendSpy(alice, bob);
    run(FOG_SETTINGS.updateIntervalTicks + 1);
    const spy = spies().list()[0];
    expect(vis(alice, spy.province)).toBe(Visible);
  });

  test("a caught spy dies, keeps nothing new, and both players are told", () => {
    SPY_SETTINGS.detectionPerMille = 1000;
    sendSpy(alice, bob);
    run(PLENTY / 20);
    expect(spies().activeCount(alice)).toBe(0);
    expect(game.fogOfWar()!.revealedBy(alice).size).toBe(0);
    const caught = messages.filter(
      (m) => m.messageType === MessageType.SPY_CAUGHT,
    );
    expect(caught.map((m) => [m.message, m.playerID])).toEqual([
      ["events_display.spy_caught_victim", bob.smallID()],
      ["events_display.spy_caught_owner", alice.smallID()],
    ]);
  });

  test("are sent to the clients with where they are and how far along", () => {
    sendSpy(alice, bob);
    run(FOG_SETTINGS.updateIntervalTicks * 2);
    const last = spyUpdates[spyUpdates.length - 1];
    expect(last.spies).toHaveLength(1);
    expect(last.spies[0]).toMatchObject({
      owner: alice.smallID(),
      target: bob.smallID(),
    });
    expect(last.sent).toEqual([[alice.smallID(), 1]]);
  });

  test("survive a snapshot mid-mission", async () => {
    sendSpy(alice, bob);
    run(SPY_SETTINGS.investigateTicks);
    const restored = await expectSnapshotRoundTrip(game, MAP, 40);
    const a = restored.player("alice");
    expect(restored.fogOfWar()!.spies().activeCount(a)).toBe(1);
    expect(restored.fogOfWar()!.spies().list()).toEqual(spies().list());
  });
});
