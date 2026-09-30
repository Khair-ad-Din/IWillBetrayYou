import {
  FOG_SETTINGS,
  SPY_SETTINGS,
} from "../src/core/configuration/ProvinceConfig";
import { FogOfWarExecution } from "../src/core/execution/FogOfWarExecution";
import { SpyCommand, SpyExecution } from "../src/core/execution/SpyExecution";
import { ProvinceVisibility } from "../src/core/game/FogOfWar";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import {
  DisplayMessageUpdate,
  GameUpdateType,
  SpiesUpdate,
} from "../src/core/game/GameUpdates";
import { Spy } from "../src/core/game/Spies";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

const MAP = "plains";
const { Unknown, Visible } = ProvinceVisibility;

let game: Game;
let alice: Player;
let bob: Player;
let home: number;
/** Bob's provinces two steps away from Alice (he holds all of them). */
let bobProvinces: number[];
let messages: DisplayMessageUpdate[];
let spyUpdates: SpiesUpdate[];
let savedDetection: number;

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

function command(player: Player, c: SpyCommand): void {
  game.addExecution(new SpyExecution(player, c));
  run(2);
}

function homeTile(): TileRef {
  return game.provinces().tilesOf(home)[0] as TileRef;
}

function buySpy(): Spy {
  command(alice, { kind: "buy", tile: homeTile() });
  const list = spies().list();
  return list[list.length - 1];
}

/** Runs until `done` holds (or fails after `max` ticks). */
function runUntil(done: () => boolean, max = 5000): void {
  for (let i = 0; i < max && !done(); i++) run(1);
  expect(done()).toBe(true);
}

beforeEach(async () => {
  savedDetection = SPY_SETTINGS.detectionPerMille;
  SPY_SETTINGS.detectionPerMille = 0;
  game = await setup(MAP, { fogOfWar: true }, [human("alice"), human("bob")]);
  alice = game.player("alice");
  bob = game.player("bob");
  messages = [];
  spyUpdates = [];

  // Alice in province 1; Bob in provinces two steps away, plus one tile
  // next to Alice so she has seen him.
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

  alice.addGold(100_000_000n);
  game.addExecution(new FogOfWarExecution());
  run(FOG_SETTINGS.updateIntervalTicks + 1);
});

afterEach(() => {
  SPY_SETTINGS.detectionPerMille = savedDetection;
});

describe("spies", () => {
  test("are bought on your own land, each one dearer, at most three", () => {
    const [first, second, third] = SPY_SETTINGS.costs.map(BigInt);
    const gold = alice.gold();
    const spy = buySpy();
    expect(spy.owner).toBe(alice.smallID());
    expect(game.ref(Math.floor(spy.x / 100), Math.floor(spy.y / 100))).toBe(
      homeTile(),
    );
    expect(alice.gold()).toBe(gold - first);
    buySpy();
    expect(alice.gold()).toBe(gold - first - second);
    buySpy();
    expect(alice.gold()).toBe(gold - first - second - third);
    expect(spies().aliveCount(alice)).toBe(3);
    expect(spies().canBuy(alice, homeTile())).toBe("max_spies");

    // Not on someone else's land.
    const bobTile = game.provinces().tilesOf(bobProvinces[0])[0] as TileRef;
    expect(spies().canBuy(alice, bobTile)).toBe("no_land");
  });

  test("move in a straight line at a fixed speed", () => {
    const spy = buySpy();
    const target = game.ref(90, 90);
    command(alice, { kind: "order", spyID: spy.id, tile: target });
    const x0 = spy.x;
    const y0 = spy.y;
    run(10);
    const moved = Math.hypot(spy.x - x0, spy.y - y0) / 100;
    expect(moved).toBeGreaterThan(10 * SPY_SETTINGS.tilesPerTick - 1);
    expect(moved).toBeLessThan(10 * SPY_SETTINGS.tilesPerTick + 1);
  });

  test("explore a province you cannot see, then wait for orders", () => {
    const spy = buySpy();
    const unknown = bobProvinces[0];
    expect(vis(alice, unknown)).toBe(Unknown);
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: game.provinces().tilesOf(unknown)[0] as TileRef,
    });
    expect(spy.mission).toBe("province");
    runUntil(() => game.fogOfWar()!.revealedBy(alice).has(unknown));
    // Only that province: the rest of Bob's land is still unexplored.
    expect(game.fogOfWar()!.revealedBy(alice).size).toBe(1);
    expect(spies().aliveCount(alice)).toBe(1);
    expect(spy.mission).toBe("none");
  });

  test("investigating takes investigateTicks, however big the province", () => {
    const spy = buySpy();
    const unknown = bobProvinces[0];
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: game.provinces().tilesOf(unknown)[0] as TileRef,
    });
    runUntil(() => spy.investigating);
    let ticks = 0;
    while (spy.investigating) {
      run(1);
      ticks++;
    }
    expect(ticks).toBe(SPY_SETTINGS.investigateTicks);
  });

  test("spy on a country: every province you cannot see, then wait", () => {
    const spy = buySpy();
    // Alice already sees Bob's tile next to her; the rest is unknown.
    const bobTile = game.provinces().tilesOf([...neighbors(home)][0])[0];
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: bobTile as TileRef,
    });
    expect(spy.mission).toBe("country");
    expect(spy.target).toBe(bob.smallID());
    // It heads for Bob's unseen provinces, not where it was clicked.
    expect(bobProvinces).toContain(spy.goal);

    runUntil(() => spy.mission === "none", 20_000);
    const revealed = game.fogOfWar()!.revealedBy(alice);
    for (const p of bobProvinces) expect(revealed.has(p)).toBe(true);
    // Provinces it could already see live were not investigated.
    for (const p of revealed) expect(bobProvinces).toContain(p);
    run(FOG_SETTINGS.updateIntervalTicks + 1);
    for (const p of bobProvinces) expect(vis(alice, p)).toBe(Visible);
    expect(spies().aliveCount(alice)).toBe(1);
    expect(
      messages.some(
        (m) =>
          m.message === "events_display.spy_finished" &&
          m.playerID === alice.smallID(),
      ),
    ).toBe(true);
  });

  test("the menus send your closest spy at a country", () => {
    expect(spies().canSendAt(alice, bob)).toBe("no_spy");
    const spy = buySpy();
    command(alice, { kind: "send", targetID: bob.id() });
    expect(spy.mission).toBe("country");
    expect(spy.target).toBe(bob.smallID());
  });

  test("a caught spy dies, keeps nothing new, and both players are told", () => {
    SPY_SETTINGS.detectionPerMille = 1000;
    const spy = buySpy();
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: game.provinces().tilesOf(bobProvinces[0])[0] as TileRef,
    });
    runUntil(() => spies().aliveCount(alice) === 0);
    expect(game.fogOfWar()!.revealedBy(alice).size).toBe(0);
    const caught = messages.filter(
      (m) => m.messageType === MessageType.SPY_CAUGHT,
    );
    expect(caught.map((m) => [m.message, m.playerID])).toEqual([
      ["events_display.spy_caught_victim", bob.smallID()],
      ["events_display.spy_caught_owner", alice.smallID()],
    ]);
  });

  test("its owner sees the province it stands in", () => {
    const spy = buySpy();
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: game.provinces().tilesOf(bobProvinces[0])[0] as TileRef,
    });
    runUntil(() => spy.investigating);
    run(FOG_SETTINGS.updateIntervalTicks + 1);
    expect(vis(alice, bobProvinces[0])).toBe(Visible);
  });

  test("are sent to the clients while alive, and cleared when gone", () => {
    SPY_SETTINGS.detectionPerMille = 1000;
    const spy = buySpy();
    run(1);
    const last = spyUpdates[spyUpdates.length - 1];
    expect(last.spies).toHaveLength(1);
    expect(last.spies[0]).toMatchObject({
      id: spy.id,
      owner: alice.smallID(),
      moving: false,
      mission: "none",
      progress: null,
    });
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: game.provinces().tilesOf(bobProvinces[0])[0] as TileRef,
    });
    runUntil(() => spies().aliveCount(alice) === 0);
    run(1);
    expect(spyUpdates[spyUpdates.length - 1].spies).toEqual([]);
  });

  test("survive a snapshot mid-mission", async () => {
    const spy = buySpy();
    command(alice, {
      kind: "order",
      spyID: spy.id,
      tile: game.provinces().tilesOf(bobProvinces[0])[0] as TileRef,
    });
    run(5);
    const restored = await expectSnapshotRoundTrip(game, MAP, 40);
    expect(restored.fogOfWar()!.spies().list()).toEqual(spies().list());
  });
});
