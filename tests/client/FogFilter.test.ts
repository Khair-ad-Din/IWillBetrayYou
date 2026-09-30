import { FogFilter, FogViewer } from "../../src/client/render/frame/FogFilter";
import type {
  FrameData,
  PlayerState,
  PlayerStatusData,
  UnitState,
} from "../../src/client/render/types";
import { ClientFog } from "../../src/client/view/ClientFog";
import { ProvinceVisibility } from "../../src/core/game/FogOfWar";
import { UnitType } from "../../src/core/game/Game";
import {
  FogOfWarUpdate,
  GameUpdateType,
} from "../../src/core/game/GameUpdates";

const { Unknown, Remembered, Visible } = ProvinceVisibility;

// 8x2 map: province 1 on the left half, province 2 on the right half.
const W = 8;
const H = 2;
const ids = new Uint16Array(W * H).map((_, t) => (t % W < 4 ? 1 : 2));
const LEFT = 0; // a tile of province 1
const RIGHT = 5; // a tile of province 2

const ME = 1;
const ENEMY = 2;

const viewer: FogViewer = {
  smallID: ME,
  isFriendly: (id) => id === ME,
  smallIDOf: (playerID) => ({ me: ME, enemy: ENEMY })[playerID],
};

function update(
  full: boolean,
  provinces: FogOfWarUpdate["provinces"],
  known: FogOfWarUpdate["known"] = [],
): FogOfWarUpdate {
  return { type: GameUpdateType.FogOfWar, full, provinces, known };
}

function unit(id: number, owner: number, pos: number, over = {}): UnitState {
  return {
    id,
    unitType: "Warship",
    ownerID: owner,
    lastOwnerID: null,
    pos,
    lastPos: pos,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    natural: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
    ...over,
  };
}

function frame(
  tileState: Uint16Array,
  changedTiles: number[] | null,
  units: UnitState[] = [],
  extra: Partial<FrameData> = {},
): FrameData {
  return {
    tick: 1,
    inSpawnPhase: false,
    tileState,
    trailState: new Uint16Array(W * H),
    railroadState: new Uint8Array(W * H),
    units: new Map(units.map((u) => [u.id, u])),
    players: new Map(),
    names: new Map([
      ["me", { playerID: "me", x: 1, y: 1, size: 10 }],
      ["enemy", { playerID: "enemy", x: 6, y: 1, size: 10 }],
    ]),
    events: { deadUnits: [], conquestEvents: [], bonusEvents: [] },
    changedTiles,
    railroadDirty: false,
    revealedRailTiles: [],
    trailDirtyRowMin: 1,
    trailDirtyRowMax: 0,
    spiralRibbons: [],
    playerStatus: new Map(),
    relationMatrix: new Uint8Array(0),
    relationSize: 0,
    relationsDirty: false,
    allianceClusters: new Map(),
    nukeTelegraphs: [],
    attackRings: [],
    structuresDirty: false,
    ...extra,
  } as FrameData;
}

/** Tiles: me on the left, the enemy on the right. */
function realTiles(): Uint16Array {
  return new Uint16Array(W * H).map((_, t) => (t % W < 4 ? ME : ENEMY));
}

let fog: ClientFog;
let filter: FogFilter;

beforeEach(() => {
  fog = new ClientFog();
  filter = new FogFilter(ids, W, H);
});

describe("ClientFog", () => {
  test("fogs nothing before the simulation sends the fog", () => {
    expect(fog.started()).toBe(false);
    expect(fog.tracks(ME)).toBe(false);
    expect(fog.visibility(ME, 2)).toBe(Visible);
    expect(fog.knows(ME, ENEMY)).toBe(true);
  });

  test("tracks visibility, memory and known players per viewer", () => {
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    expect(fog.tracks(ME)).toBe(true);
    expect(fog.visibility(ME, 1)).toBe(Visible);
    expect(fog.visibility(ME, 2)).toBe(Unknown);
    expect(fog.knows(ME, ENEMY)).toBe(false);

    const memory = { owner: ENEMY, tick: 5, structures: [] };
    fog.apply(
      update(
        false,
        [{ viewer: ME, province: 2, visibility: Remembered, memory }],
        [{ viewer: ME, player: ENEMY }],
      ),
    );
    expect(fog.visibility(ME, 2)).toBe(Remembered);
    expect(fog.memory(ME, 2)).toEqual(memory);
    expect(fog.knows(ME, ENEMY)).toBe(true);
    expect(fog.remembered(ME)).toEqual([2]);
  });

  test("a full update replaces everything", () => {
    fog.apply(
      update(
        true,
        [{ viewer: ME, province: 2, visibility: Visible }],
        [{ viewer: ME, player: ENEMY }],
      ),
    );
    fog.drainChanges(ME);
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    expect(fog.visibility(ME, 2)).toBe(Unknown);
    expect(fog.knows(ME, ENEMY)).toBe(false);
    const drained = fog.drainChanges(ME);
    expect(drained.reset).toBe(true);
    expect(drained.provinces.sort()).toEqual([1, 2]);
  });
});

describe("FogFilter", () => {
  test("passes frames through while the player is not fogged", () => {
    const f = frame(realTiles(), null);
    expect(filter.filter(f, fog, viewer)).toBe(f);
  });

  test("unknown provinces look unclaimed, visible ones live", () => {
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    const out = filter.filter(frame(realTiles(), []), fog, viewer);
    expect(out.changedTiles).toBeNull(); // first fogged frame: full upload
    expect(out.tileState[LEFT]).toBe(ME);
    expect(out.tileState[RIGHT]).toBe(0);
  });

  test("a remembered province stays as it was last seen", () => {
    fog.apply(
      update(true, [
        { viewer: ME, province: 1, visibility: Visible },
        { viewer: ME, province: 2, visibility: Visible },
      ]),
    );
    const real = realTiles();
    filter.filter(frame(real, []), fog, viewer);

    fog.apply(
      update(false, [
        {
          viewer: ME,
          province: 2,
          visibility: Remembered,
          memory: { owner: ENEMY, tick: 1, structures: [] },
        },
      ]),
    );
    // Someone else takes a tile there: the player cannot see it.
    real[RIGHT] = 3;
    const out = filter.filter(frame(real, [RIGHT]), fog, viewer);
    expect(out.tileState[RIGHT]).toBe(ENEMY);
    expect(out.changedTiles).not.toContain(RIGHT);

    // A tile of a visible province still updates live.
    real[LEFT] = 0;
    const next = filter.filter(frame(real, [LEFT]), fog, viewer);
    expect(next.tileState[LEFT]).toBe(0);
    expect(next.changedTiles).toContain(LEFT);
  });

  test("after a reload, remembered provinces show the remembered owner", () => {
    fog.apply(
      update(true, [
        { viewer: ME, province: 1, visibility: Visible },
        {
          viewer: ME,
          province: 2,
          visibility: Remembered,
          memory: { owner: 7, tick: 1, structures: [] },
        },
      ]),
    );
    const out = filter.filter(frame(realTiles(), null), fog, viewer);
    expect(out.tileState[RIGHT]).toBe(7);
    expect(filter.provincesShown(Remembered)).toEqual([2]);
  });

  test("hides what the player cannot see and ghosts remembered buildings", () => {
    fog.apply(
      update(true, [
        { viewer: ME, province: 1, visibility: Visible },
        {
          viewer: ME,
          province: 2,
          visibility: Remembered,
          memory: {
            owner: ENEMY,
            tick: 1,
            structures: [
              { type: UnitType.City, tile: RIGHT + W, owner: ENEMY, level: 2 },
            ],
          },
        },
      ]),
    );
    const out = filter.filter(
      frame(
        realTiles(),
        [],
        [
          unit(1, ME, RIGHT), // own units are always seen
          unit(2, ENEMY, LEFT), // in sight
          unit(3, ENEMY, RIGHT), // out of sight
          unit(4, ENEMY, RIGHT, { unitType: "Atom Bomb", targetTile: LEFT }),
          unit(5, ENEMY, RIGHT, { unitType: "City" }), // real city, unseen
        ],
      ),
      fog,
      viewer,
    );
    const shown = [...out.units.values()];
    expect(shown.map((u) => u.id).filter((id) => id > 0)).toEqual([1, 2, 4]);
    const ghost = shown.find((u) => u.id < 0)!;
    expect(ghost).toMatchObject({
      unitType: "City",
      pos: RIGHT + W,
      ownerID: ENEMY,
      level: 2,
      underConstruction: true,
    });
  });

  test("hides the names of players never seen", () => {
    fog.apply(
      update(true, [
        { viewer: ME, province: 1, visibility: Visible },
        { viewer: ME, province: 2, visibility: Visible },
      ]),
    );
    let out = filter.filter(frame(realTiles(), []), fog, viewer);
    expect([...out.names.keys()]).toEqual(["me"]);

    fog.apply(update(false, [], [{ viewer: ME, player: ENEMY }]));
    out = filter.filter(frame(realTiles(), []), fog, viewer);
    expect([...out.names.keys()]).toEqual(["me", "enemy"]);
  });

  test("resource markers are hidden in unknown provinces", () => {
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    filter.filter(frame(realTiles(), []), fog, viewer);
    expect(filter.tileKnown(LEFT)).toBe(true);
    expect(filter.tileKnown(RIGHT)).toBe(false);
  });

  test("tracks what the player knows of each other player", () => {
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    const players = new Map([
      [ENEMY, { smallID: ENEMY, troops: 500 } as PlayerState],
    ]);
    // The enemy holds a tile in the visible province: seen live.
    const real = realTiles();
    real[1] = ENEMY;
    filter.filter(frame(real, [], [], { players }), fog, viewer);
    let intel = filter.intel(ENEMY);
    expect(intel).toMatchObject({ tiles: 1, live: true, troops: 500 });

    // Out of sight: the last figure stays, with the tick it was seen.
    real[1] = ME;
    const later = { ...frame(real, [1], [], { players }), tick: 9 };
    filter.filter(later, fog, viewer);
    intel = filter.intel(ENEMY);
    expect(intel).toMatchObject({
      tiles: 0,
      live: false,
      troops: 500,
      troopsTick: 1,
    });
  });

  test("names show troops as last seen, ?? (-1) if never, and no crown", () => {
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    const players = new Map([
      [ME, { smallID: ME, troops: 100 } as PlayerState],
      [ENEMY, { smallID: ENEMY, troops: 500 } as PlayerState],
    ]);
    const playerStatus = new Map([
      [ENEMY, { crown: true } as PlayerStatusData],
      [ME, { crown: true } as PlayerStatusData],
    ]);
    const out = filter.filter(
      frame(realTiles(), [], [], { players, playerStatus }),
      fog,
      viewer,
    );
    expect(out.players.get(ME)!.troops).toBe(100);
    expect(out.players.get(ENEMY)!.troops).toBe(-1);
    expect(out.playerStatus.get(ENEMY)!.crown).toBe(false);
    expect(out.playerStatus.get(ME)!.crown).toBe(true);
  });

  test("trails and railroads only show where the player sees or knows", () => {
    fog.apply(update(true, [{ viewer: ME, province: 1, visibility: Visible }]));
    const trailState = new Uint16Array(W * H).fill(3);
    const railroadState = new Uint8Array(W * H).fill(1);
    const out = filter.filter(
      frame(realTiles(), null, [], { trailState, railroadState }),
      fog,
      viewer,
    );
    expect(out.trailState[LEFT]).toBe(3);
    expect(out.trailState[RIGHT]).toBe(0);
    expect(out.railroadState[LEFT]).toBe(1);
    expect(out.railroadState[RIGHT]).toBe(0);
    expect(out.railroadDirty).toBe(true);
  });

  test("a known farm doubles its owner's known tiles there for the estimate", () => {
    fog.apply(
      update(true, [
        { viewer: ME, province: 1, visibility: Visible },
        { viewer: ME, province: 2, visibility: Visible },
      ]),
    );
    // The enemy holds all 8 tiles of province 2, with a farm in it.
    filter.filter(
      frame(realTiles(), [], [unit(9, ENEMY, RIGHT, { unitType: "Farm" })]),
      fog,
      viewer,
    );
    expect(filter.intel(ENEMY)).toMatchObject({ tiles: 8, bonusTiles: 8 });
  });
});
