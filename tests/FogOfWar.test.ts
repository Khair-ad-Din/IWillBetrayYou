import { FOG_SETTINGS } from "../src/core/configuration/ProvinceConfig";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "../src/core/execution/alliance/BreakAllianceExecution";
import { FogOfWarExecution } from "../src/core/execution/FogOfWarExecution";
import { ProvinceVisibility } from "../src/core/game/FogOfWar";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

const MAP = "plains";
const { Unknown, Remembered, Visible } = ProvinceVisibility;

let game: Game;
let alice: Player;
let bob: Player;
let fog: FogOfWarExecution;

function human(name: string): PlayerInfo {
  return new PlayerInfo(name, PlayerType.Human, name, name);
}

function conquerProvince(player: Player, province: number): void {
  for (const t of game.provinces().tilesOf(province)) player.conquer(t);
}

/** Provinces sharing a land border with `province`. */
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

/** A province that neither is nor touches `province`, as far as possible. */
function farFrom(province: number): number {
  const near = neighbors(province);
  const provinces = game.provinces();
  const center = provinces.tilesOf(province)[0];
  let best = 0;
  let bestDist = -1;
  for (let p = 1; p <= provinces.count(); p++) {
    if (p === province || near.has(p)) continue;
    const d = game.manhattanDist(center, provinces.tilesOf(p)[0]);
    if (d > bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** Runs ticks until the fog has made its first update. */
function startFog(): void {
  for (let i = 0; i < 5 && !game.fogOfWar()?.isStarted(); i++) {
    game.executeNextTick();
  }
  expect(game.fogOfWar()!.isStarted()).toBe(true);
}

/**
 * Runs ticks until the fog has updated at least once after whatever the test
 * just queued (executions such as a broken alliance take a tick or two).
 */
function updateFog(): void {
  for (let i = 0; i < 2 * FOG_SETTINGS.updateIntervalTicks; i++) {
    game.executeNextTick();
  }
}

function vis(player: Player, province: number): ProvinceVisibility {
  return game.fogOfWar()!.visibility(player, province);
}

function ally(a: Player, b: Player): void {
  game.addExecution(new AllianceRequestExecution(a, b.id()));
  game.executeNextTick();
  game.addExecution(new AllianceRequestExecution(b, a.id()));
  game.executeNextTick();
  expect(a.isAlliedWith(b)).toBe(true);
}

let home: number;
let far: number;

beforeEach(async () => {
  game = await setup(MAP, { fogOfWar: true }, [human("alice"), human("bob")]);
  alice = game.player("alice");
  bob = game.player("bob");
  home = 1;
  far = farFrom(home);
  conquerProvince(alice, home);
  conquerProvince(bob, far);
  fog = new FogOfWarExecution();
  game.addExecution(fog);
});

describe("fog of war", () => {
  test("everything is visible until the first update", () => {
    expect(game.fogOfWar()).toBeNull();
    fog.init(game);
    expect(game.fogOfWar()!.isStarted()).toBe(false);
    expect(vis(alice, far)).toBe(Visible);
    expect(game.fogOfWar()!.knowsPlayer(alice, bob)).toBe(true);
  });

  test("a player sees their provinces and the ones next to them", () => {
    startFog();
    expect(vis(alice, home)).toBe(Visible);
    for (const nb of neighbors(home)) expect(vis(alice, nb)).toBe(Visible);
    expect(vis(alice, far)).toBe(Unknown);
    expect(vis(bob, far)).toBe(Visible);
    expect(vis(bob, home)).toBe(Unknown);
  });

  test("a player is unknown until one of their tiles is seen", () => {
    startFog();
    const fogOfWar = game.fogOfWar()!;
    expect(fogOfWar.knowsPlayer(alice, bob)).toBe(false);
    expect(fogOfWar.knowsPlayer(alice, alice)).toBe(true);

    // Bob grabs a tile next to Alice: now she has seen him, for good.
    const [nb] = neighbors(home);
    bob.conquer(game.provinces().tilesOf(nb)[0]);
    updateFog();
    expect(fogOfWar.knowsPlayer(alice, bob)).toBe(true);

    for (const t of game.provinces().tilesOf(nb)) {
      if (game.owner(t) === bob) bob.relinquish(t);
    }
    updateFog();
    expect(fogOfWar.knowsPlayer(alice, bob)).toBe(true);
  });

  test("a province lost from sight is remembered as it was", () => {
    startFog();
    ally(alice, bob);
    const city = bob.buildUnit(
      UnitType.City,
      game.provinces().tilesOf(far)[0],
      {},
    );
    updateFog();
    expect(vis(alice, far)).toBe(Visible);

    game.addExecution(new BreakAllianceExecution(alice, bob.id()));
    updateFog();
    expect(vis(alice, far)).toBe(Remembered);
    const memory = game.fogOfWar()!.memory(alice, far)!;
    expect(memory.owner).toBe(bob.smallID());
    const remembered = {
      type: UnitType.City,
      tile: city.tile(),
      owner: bob.smallID(),
      level: 1,
    };
    expect(memory.structures).toContainEqual(remembered);

    // The city is gone, but Alice cannot see that.
    city.delete(false);
    updateFog();
    expect(game.fogOfWar()!.memory(alice, far)!.structures).toContainEqual(
      remembered,
    );
  });

  test("allies share vision, and a betrayal cuts it", () => {
    startFog();
    ally(alice, bob);
    updateFog();
    expect(vis(alice, far)).toBe(Visible);
    expect(vis(bob, home)).toBe(Visible);

    game.addExecution(new BreakAllianceExecution(alice, bob.id()));
    updateFog();
    expect(alice.isAlliedWith(bob)).toBe(false);
    expect(vis(alice, far)).toBe(Remembered);
    expect(vis(bob, home)).toBe(Remembered);
    expect(game.fogOfWar()!.memory(alice, far)!.owner).toBe(bob.smallID());
  });

  test("revealed provinces stay visible for the rest of the game", () => {
    startFog();
    game.fogOfWar()!.reveal(alice, far);
    updateFog();
    expect(vis(alice, far)).toBe(Visible);
    expect(game.fogOfWar()!.knowsPlayer(alice, bob)).toBe(true);
  });

  test("SAMs see the provinces around them", () => {
    const saved = FOG_SETTINGS.samVisionRange;
    FOG_SETTINGS.samVisionRange = 250;
    try {
      startFog();
      expect(vis(alice, far)).toBe(Unknown);
      alice.buildUnit(
        UnitType.SAMLauncher,
        game.provinces().tilesOf(home)[0],
        {},
      );
      updateFog();
      // The whole test map is within range.
      expect(vis(alice, far)).toBe(Visible);
    } finally {
      FOG_SETTINGS.samVisionRange = saved;
    }
  });

  test("only visibility changes are reported", () => {
    startFog();
    const first = fog.changes().filter((c) => c.viewer === alice.smallID());
    expect(first.map((c) => c.province).sort((a, b) => a - b)).toEqual(
      [home, ...neighbors(home)].sort((a, b) => a - b),
    );
    updateFog();
    expect(fog.changes()).toEqual([]);
  });

  test("the fog and what players remember survive a snapshot", async () => {
    startFog();
    ally(alice, bob);
    updateFog();
    game.addExecution(new BreakAllianceExecution(alice, bob.id()));
    const [spied] = neighbors(far);
    game.fogOfWar()!.reveal(alice, spied);
    updateFog();
    expect(vis(alice, far)).toBe(Remembered);
    expect(vis(alice, spied)).toBe(Visible);

    const restored = await expectSnapshotRoundTrip(game, MAP, 10);
    const restoredFog = restored.fogOfWar()!;
    const a = restored.player("alice");
    for (let p = 1; p <= game.provinces().count(); p++) {
      expect(restoredFog.visibility(a, p)).toBe(vis(alice, p));
    }
    expect(restoredFog.memory(a, far)).toEqual(
      game.fogOfWar()!.memory(alice, far),
    );
    expect(restoredFog.knowsPlayer(a, restored.player("bob"))).toBe(true);
  });
});
