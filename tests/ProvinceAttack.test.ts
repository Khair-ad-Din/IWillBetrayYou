import { AttackExecution } from "../src/core/execution/AttackExecution";
import { TribeSpawner } from "../src/core/execution/TribeSpawner";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { NO_PROVINCE } from "../src/core/game/Provinces";
import { ProvinceState } from "../src/core/game/ProvinceState";
import { setup } from "./util/Setup";

let game: Game;
let attacker: Player;
let defender: Player;

const attackerInfo = new PlayerInfo(
  "attacker",
  PlayerType.Human,
  "attacker",
  "attacker",
);
const defenderInfo = new PlayerInfo(
  "defender",
  PlayerType.Human,
  "defender",
  "defender",
);

/** Provinces sharing a land border with `province`, in id order. */
function neighborProvinces(game: Game, province: number): number[] {
  const provinces = game.provinces();
  const found = new Set<number>();
  for (const t of provinces.tilesOf(province)) {
    for (const nb of game.neighbors(t)) {
      const p = provinces.provinceOf(nb);
      if (p !== NO_PROVINCE && p !== province) found.add(p);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function give(player: Player, province: number) {
  for (const t of game.provinces().tilesOf(province)) player.conquer(t);
}

function tilesOwnedIn(player: Player, province: number): number {
  return game.provinces().ownedBy(province, player.smallID());
}

function runAttack(exec: AttackExecution) {
  game.addExecution(exec);
  do {
    game.executeNextTick();
  } while (attacker.outgoingAttacks().length > 0);
}

/** A province with at least two land neighbors, and those neighbors. */
function pickLayout(): { home: number; neighbors: number[] } {
  const provinces = game.provinces();
  for (let p = 1; p <= provinces.count(); p++) {
    const neighbors = neighborProvinces(game, p);
    if (neighbors.length >= 2) return { home: p, neighbors };
  }
  throw new Error("test map has no province with two neighbors");
}

describe("province-bound attacks", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteTroops: true }, [
      attackerInfo,
      defenderInfo,
    ]);
    attacker = game.player("attacker");
    defender = game.player("defender");
    attacker.addTroops(1_000_000);
    defender.addTroops(1_000);
  });

  test("the test map is split into several provinces", () => {
    expect(game.provinces().count()).toBeGreaterThan(3);
  });

  test("an attack only takes the province that was aimed at", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    for (const p of neighbors) give(defender, p);
    const [aimed, ...others] = neighbors;
    const othersBefore = others.map((p) => tilesOwnedIn(defender, p));

    const aimedTile = game.provinces().tilesOf(aimed)[0];
    runAttack(
      new AttackExecution(
        500_000,
        attacker,
        defender.id(),
        null,
        true,
        aimedTile,
      ),
    );

    expect(tilesOwnedIn(defender, aimed)).toBe(0);
    expect(tilesOwnedIn(attacker, aimed)).toBe(game.provinces().size(aimed));
    expect(others.map((p) => tilesOwnedIn(defender, p))).toEqual(othersBefore);
    expect(others.map((p) => tilesOwnedIn(attacker, p))).toEqual(
      others.map(() => 0),
    );
  });

  test("without a tile, the province with the longest shared border is attacked", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    for (const p of neighbors) give(defender, p);

    // Count, per neighbor, the defender tiles touching the attacker.
    const provinces = game.provinces();
    const contact = new Map<number, number>();
    for (const t of provinces.tilesOf(home)) {
      for (const nb of game.neighbors(t)) {
        const p = provinces.provinceOf(nb);
        if (game.owner(nb) === defender) {
          contact.set(p, (contact.get(p) ?? 0) + 1);
        }
      }
    }
    const expected = [...contact.entries()].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )[0][0];

    game.addExecution(new AttackExecution(500_000, attacker, defender.id()));
    game.executeNextTick();
    expect(attacker.outgoingAttacks()[0].province()).toBe(expected);
  });

  test("attacks on different provinces stay separate, same province merges", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    for (const p of neighbors) give(defender, p);
    const [a, b] = neighbors;
    const tileA = game.provinces().tilesOf(a)[0];
    const tileB = game.provinces().tilesOf(b)[0];

    game.addExecution(
      new AttackExecution(100, attacker, defender.id(), null, true, tileA),
      new AttackExecution(100, attacker, defender.id(), null, true, tileB),
    );
    game.executeNextTick();
    expect(
      attacker
        .outgoingAttacks()
        .map((x) => x.province())
        .sort(),
    ).toEqual([a, b].sort());

    game.addExecution(
      new AttackExecution(100, attacker, defender.id(), null, true, tileA),
    );
    game.executeNextTick();
    const onA = attacker.outgoingAttacks().filter((x) => x.province() === a);
    expect(onA).toHaveLength(1);
  });

  test("taking most of a province captures the rest of it at once", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    const target = neighbors[0];
    give(defender, target);
    // A defender enclave the front can never reach through the province:
    // it still flips when the province is captured.
    const provinces = game.provinces();
    const tiles = provinces.tilesOf(target);
    const enclave: TileRef = tiles[tiles.length - 1];

    runAttack(
      new AttackExecution(
        500_000,
        attacker,
        defender.id(),
        null,
        true,
        tiles[0],
      ),
    );
    expect(game.owner(enclave)).toBe(attacker);
    expect(tilesOwnedIn(defender, target)).toBe(0);
  });

  test("expanding into unclaimed land takes one province", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    const aimed = neighbors[0];
    const before = attacker.numTilesOwned();

    runAttack(
      new AttackExecution(
        500_000,
        attacker,
        game.terraNullius().id(),
        null,
        true,
        game.provinces().tilesOf(aimed)[0],
      ),
    );

    expect(tilesOwnedIn(attacker, aimed)).toBe(game.provinces().size(aimed));
    expect(attacker.numTilesOwned()).toBe(
      before + game.provinces().size(aimed),
    );
  });

  test("canAttack needs a border with the tile's province", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    const provinces = game.provinces();
    // A province that touches neither home nor its neighbors.
    const near = new Set([home, ...neighbors]);
    let far = NO_PROVINCE;
    for (let p = 1; p <= provinces.count() && far === NO_PROVINCE; p++) {
      if (!near.has(p) && !neighborProvinces(game, p).includes(home)) far = p;
    }
    expect(far).not.toBe(NO_PROVINCE);

    expect(attacker.canAttack(provinces.tilesOf(neighbors[0])[0])).toBe(true);
    expect(attacker.canAttack(provinces.tilesOf(far)[0])).toBe(false);
  });

  test("rebuilt owner counts match the incremental ones", () => {
    const { home, neighbors } = pickLayout();
    give(attacker, home);
    for (const p of neighbors) give(defender, p);
    runAttack(new AttackExecution(500_000, attacker, defender.id()));

    const incremental = game.provinces();
    const rebuilt = new ProvinceState(incremental.map(), game.map());
    for (let p = 1; p <= incremental.count(); p++) {
      for (const smallID of [0, attacker.smallID(), defender.smallID()]) {
        expect(rebuilt.ownedBy(p, smallID)).toBe(
          incremental.ownedBy(p, smallID),
        );
      }
    }
  });
});

describe("tribes and provinces", () => {
  test("random tribes spawn at most one per province", async () => {
    const game = await setup(
      "plains",
      { bots: 50 },
      [],
      undefined,
      undefined,
      false,
    );
    const provinceCount = game.provinces().count();
    const execs = new TribeSpawner(game, "game_id").spawnTribes(50);
    expect(execs.length).toBeLessThanOrEqual(provinceCount);
    game.addExecution(...execs);
    game.executeNextTick();
    game.executeNextTick();

    const provinces = game.provinces();
    const seen = new Set<number>();
    for (const bot of game.allPlayers()) {
      const spawn = bot.spawnTile();
      if (spawn === undefined) continue;
      const p = provinces.provinceOf(spawn);
      expect(seen.has(p)).toBe(false);
      seen.add(p);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
