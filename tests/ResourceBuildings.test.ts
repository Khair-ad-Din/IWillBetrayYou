import { RESOURCE_SETTINGS } from "../src/core/configuration/ProvinceConfig";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { ResourceSiteExecution } from "../src/core/execution/ResourceSiteExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { ResourceType } from "../src/core/game/ResourceSites";
import { setup } from "./util/Setup";

let game: Game;
let owner: Player;
let rival: Player;
let sites: ResourceSiteExecution;

const ownerInfo = new PlayerInfo("owner", PlayerType.Human, "owner", "owner");
const rivalInfo = new PlayerInfo("rival", PlayerType.Human, "rival", "rival");

function siteOf(type: ResourceType) {
  const site = sites.resourceSites().find((s) => s.type === type);
  if (site === undefined) throw new Error(`no ${type} site on the test map`);
  return site;
}

function unitAt(player: Player, type: UnitType, tile: number) {
  return player.units(type).find((u) => u.tile() === tile);
}

beforeEach(async () => {
  game = await setup("plains", {}, [ownerInfo, rivalInfo]);
  owner = game.player("owner");
  rival = game.player("rival");
  sites = new ResourceSiteExecution(1234);
  game.addExecution(sites);
  game.executeNextTick();
});

describe("resource sites", () => {
  test("start unclaimed and announce themselves to the client", () => {
    expect(sites.resourceSites().length).toBeGreaterThan(0);
    for (const s of sites.resourceSites()) expect(s.state).toBe("unclaimed");

    const fresh = new ResourceSiteExecution(1234);
    game.addExecution(fresh);
    const updates = game.executeNextTick();
    const sent = updates[GameUpdateType.ResourceSites];
    expect(sent.length).toBeGreaterThan(0);
  });

  test("hand their building to whoever conquers the site", () => {
    const farm = siteOf(ResourceType.Farm);
    owner.conquer(farm.tile);
    game.executeNextTick();
    expect(unitAt(owner, UnitType.Farm, farm.tile)).toBeDefined();
    expect(sites.resourceSites().find((s) => s === farm)?.state).toBe(
      "claimed",
    );
  });

  test("cannot be built by players", () => {
    const farm = siteOf(ResourceType.Farm);
    owner.conquer(farm.tile);
    expect(owner.canBuild(UnitType.Farm, farm.tile)).toBe(false);
    expect(owner.canBuild(UnitType.Mine, farm.tile)).toBe(false);
  });

  test("a nuke destroys a resource for good", () => {
    const mine = siteOf(ResourceType.Mine);
    owner.conquer(mine.tile);
    game.executeNextTick();
    const unit = unitAt(owner, UnitType.Mine, mine.tile)!;

    // What a detonation does: destroy the unit, clear the tile, leave fallout.
    unit.delete(true, rival);
    owner.relinquish(mine.tile);
    game.setFallout(mine.tile, true);
    game.executeNextTick();
    expect(mine.state).toBe("destroyed");

    rival.conquer(mine.tile);
    game.executeNextTick();
    expect(unitAt(rival, UnitType.Mine, mine.tile)).toBeUndefined();
  });

  test("tell the game which provinces hold a live resource", () => {
    const all = new Set(sites.resourceSites().map((s) => s.province));
    expect(new Set(game.resourceProvinces())).toEqual(all);

    const mine = siteOf(ResourceType.Mine);
    owner.conquer(mine.tile);
    game.executeNextTick();
    unitAt(owner, UnitType.Mine, mine.tile)!.delete(true, rival);
    owner.relinquish(mine.tile);
    game.setFallout(mine.tile, true);
    game.executeNextTick();
    expect(game.resourceProvinces().has(mine.province)).toBe(false);
  });

  test("a building lost without a nuke frees the site again", () => {
    const mine = siteOf(ResourceType.Mine);
    owner.conquer(mine.tile);
    game.executeNextTick();
    unitAt(owner, UnitType.Mine, mine.tile)!.delete(false);
    game.executeNextTick();
    expect(mine.state).toBe("unclaimed");

    game.executeNextTick();
    expect(unitAt(owner, UnitType.Mine, mine.tile)).toBeDefined();
  });
});

describe("farm", () => {
  test("counts the owner's tiles in its province twice for the troop cap", () => {
    const farm = siteOf(ResourceType.Farm);
    const tiles = game.provinces().tilesOf(farm.province);
    for (const t of tiles) owner.conquer(t);
    const capBefore = game.config().maxTroops(owner);
    expect(owner.bonusTroopTiles()).toBe(0);

    game.executeNextTick();
    expect(unitAt(owner, UnitType.Farm, farm.tile)).toBeDefined();
    expect(owner.bonusTroopTiles()).toBe(
      tiles.length * (RESOURCE_SETTINGS.farmTileMultiplier - 1),
    );
    expect(game.config().maxTroops(owner)).toBeGreaterThan(capBefore);
  });
});

describe("mine", () => {
  test("pays gold every tick and levels up while held", () => {
    const mine = siteOf(ResourceType.Mine);
    owner.conquer(mine.tile);
    game.executeNextTick();
    const unit = unitAt(owner, UnitType.Mine, mine.tile)!;
    expect(unit.level()).toBe(1);

    const before = owner.gold();
    game.executeNextTick();
    expect(owner.gold() - before).toBe(
      BigInt(RESOURCE_SETTINGS.mineGoldPerLevel),
    );

    for (let i = 0; i < RESOURCE_SETTINGS.mineLevelUpTicks; i++) {
      game.executeNextTick();
    }
    expect(unit.level()).toBe(2);
    const beforeL2 = owner.gold();
    game.executeNextTick();
    expect(owner.gold() - beforeL2).toBe(
      BigInt(2 * RESOURCE_SETTINGS.mineGoldPerLevel),
    );
  });

  test("drops back to level 1 when captured", () => {
    const mine = siteOf(ResourceType.Mine);
    owner.conquer(mine.tile);
    game.addExecution(new PlayerExecution(owner));
    game.executeNextTick();
    const unit = unitAt(owner, UnitType.Mine, mine.tile)!;
    for (let i = 0; i <= RESOURCE_SETTINGS.mineLevelUpTicks; i++) {
      game.executeNextTick();
    }
    expect(unit.level()).toBe(2);

    rival.conquer(mine.tile);
    game.executeNextTick(); // the owner's PlayerExecution hands it over
    game.executeNextTick();
    expect(unit.owner()).toBe(rival);
    expect(unit.level()).toBe(1);
  });
});

describe("natural harbor", () => {
  test("is a free port that cannot be upgraded and does not raise port costs", () => {
    const tile = game.provinces().tilesOf(1)[0];
    owner.conquer(tile);
    owner.addGold(10_000_000n);
    const portCost = game.unitInfo(UnitType.Port).cost(game, owner);
    const goldBefore = owner.gold();

    const port = owner.grantUnit(UnitType.Port, tile, { natural: true });
    expect(port.isNatural()).toBe(true);
    expect(owner.gold()).toBe(goldBefore);
    expect(owner.canUpgradeUnit(port)).toBe(false);
    expect(game.unitInfo(UnitType.Port).cost(game, owner)).toBe(portCost);
  });
});
