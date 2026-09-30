import { SPY_SETTINGS } from "../configuration/ProvinceConfig";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import type { FogOfWar } from "./FogOfWar";
import { Game, MessageType, Player } from "./Game";
import { TileRef } from "./GameMap";
import { NO_PROVINCE } from "./Provinces";

// ProvinceVisibility values (not imported: FogOfWar imports this module).
const VISIBLE = 2;

/** Positions are kept in hundredths of a tile, as integers. */
const SCALE = 100;

export type SpyMission = "none" | "country" | "province";

export interface Spy {
  id: number;
  owner: number;
  /** Position and where it is heading, in hundredths of a tile. */
  x: number;
  y: number;
  destX: number;
  destY: number;
  mission: SpyMission;
  /** smallID of the country it spies on (country missions). */
  target: number;
  /** Province it is heading for or investigating (0 = none). */
  goal: number;
  investigating: boolean;
  /** Ticks left of the investigation. */
  ticksLeft: number;
}

/** Why a spy cannot be bought or sent (null: it can). */
export type SpyRefusal =
  | "no_land"
  | "max_spies"
  | "gold"
  | "unknown_player"
  | "no_spy";

/**
 * The spies of a fog-of-war game. A spy is bought on its owner's land and
 * then ordered around like a ship: it moves in a straight line at
 * SPY_SETTINGS.tilesPerTick, over land and sea, and its owner sees the
 * province it is in. Orders (see order()):
 *
 * - at a province its owner does not see live: explore it (go there,
 *   investigate for investigateTicks, reveal it for good);
 * - at a country: investigate, one by one, its provinces the owner cannot
 *   see, picking each time the one next to what the owner already knows
 *   (closest first) and working out the route itself;
 * - anywhere else: just move there.
 *
 * After each investigation it may be caught (detectionPerMille): it dies,
 * what it found stays found, and both players are told. With nothing left
 * to do it waits where it is for new orders.
 *
 * Deterministic: integer positions, and the catch roll is seeded from the
 * spy, province and tick.
 */
export class SpyNetwork {
  private spies: Spy[] = [];
  private nextID = 1;
  /** A tile near the middle of each province, and its coordinates. */
  private readonly centers: Int32Array;
  private readonly centerX: Int32Array;
  private readonly centerY: Int32Array;

  constructor(
    private readonly game: Game,
    private readonly fog: FogOfWar,
    private readonly neighbors: readonly number[][],
  ) {
    const provinces = game.provinces();
    const map = game.map();
    const count = provinces.count();
    this.centers = new Int32Array(count + 1);
    this.centerX = new Int32Array(count + 1);
    this.centerY = new Int32Array(count + 1);
    for (let p = 1; p <= count; p++) {
      const tiles = provinces.tilesOf(p);
      if (tiles.length === 0) continue;
      let sx = 0;
      let sy = 0;
      for (const t of tiles) {
        sx += map.x(t);
        sy += map.y(t);
      }
      const cx = Math.floor(sx / tiles.length);
      const cy = Math.floor(sy / tiles.length);
      let best = tiles[0];
      let bestD = Infinity;
      for (const t of tiles) {
        const dx = map.x(t) - cx;
        const dy = map.y(t) - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      this.centers[p] = best;
      this.centerX[p] = map.x(best);
      this.centerY[p] = map.y(best);
    }
  }

  /** Gold `owner`'s next spy costs (it grows with the spies they have). */
  cost(owner: Player | number): bigint {
    const costs = SPY_SETTINGS.costs;
    const alive = this.aliveCount(owner);
    return BigInt(costs[Math.min(alive, costs.length - 1)]);
  }

  aliveCount(owner: Player | number): number {
    const id = smallIDOf(owner);
    return this.spies.filter((s) => s.owner === id).length;
  }

  /** The spies alive right now. */
  list(): readonly Spy[] {
    return this.spies;
  }

  /** The tile a spy stands on. */
  tileOf(spy: Spy): TileRef {
    return this.game.ref(Math.floor(spy.x / SCALE), Math.floor(spy.y / SCALE));
  }

  /** Provinces `owner` sees through their spies right now. */
  seenBy(owner: number): number[] {
    const provinces = this.game.provinces();
    const out: number[] = [];
    for (const s of this.spies) {
      if (s.owner !== owner) continue;
      const p = provinces.provinceOf(this.tileOf(s));
      if (p !== NO_PROVINCE) out.push(p);
    }
    return out;
  }

  canBuy(owner: Player, tile: TileRef): SpyRefusal | null {
    if (this.game.owner(tile) !== owner) return "no_land";
    if (this.aliveCount(owner) >= SPY_SETTINGS.costs.length) {
      return "max_spies";
    }
    if (owner.gold() < this.cost(owner)) return "gold";
    return null;
  }

  /** Buys a spy and places it on `tile`, if `owner` can. */
  buy(owner: Player, tile: TileRef): Spy | null {
    if (!owner.isAlive() || this.canBuy(owner, tile) !== null) return null;
    owner.removeGold(this.cost(owner));
    const x = this.game.x(tile) * SCALE + SCALE / 2;
    const y = this.game.y(tile) * SCALE + SCALE / 2;
    const spy: Spy = {
      id: this.nextID++,
      owner: owner.smallID(),
      x,
      y,
      destX: x,
      destY: y,
      mission: "none",
      target: 0,
      goal: NO_PROVINCE,
      investigating: false,
      ticksLeft: 0,
    };
    this.spies.push(spy);
    return spy;
  }

  /**
   * Orders `owner`'s spy `spyID` at `tile`: explore it if its province is
   * not seen live, spy on its country if it is someone else's land, or just
   * move there. Any mission under way is dropped.
   */
  order(owner: Player, spyID: number, tile: TileRef): void {
    const spy = this.spies.find(
      (s) => s.id === spyID && s.owner === owner.smallID(),
    );
    if (spy === undefined || !this.game.isValidRef(tile)) return;
    this.stop(spy);

    const p = this.game.provinces().provinceOf(tile);
    if (p !== NO_PROVINCE && this.fog.visibility(owner, p) !== VISIBLE) {
      spy.mission = "province";
      this.headFor(spy, p);
      return;
    }
    const tileOwner = this.game.owner(tile);
    if (
      tileOwner.isPlayer() &&
      tileOwner !== owner &&
      this.fog.knowsPlayer(owner, tileOwner)
    ) {
      spy.mission = "country";
      spy.target = tileOwner.smallID();
      if (this.nextGoal(spy)) return;
      this.stop(spy);
    }
    spy.destX = this.game.x(tile) * SCALE + SCALE / 2;
    spy.destY = this.game.y(tile) * SCALE + SCALE / 2;
  }

  /** Why `owner` cannot send a spy at `target` from a menu (null: can). */
  canSendAt(owner: Player, target: Player): SpyRefusal | null {
    if (!this.fog.knowsPlayer(owner, target) || target === owner) {
      return "unknown_player";
    }
    if (this.aliveCount(owner) === 0) return "no_spy";
    return null;
  }

  /**
   * Menus: sends `owner`'s closest spy (an idle one if any) to spy on
   * `target`. Returns whether one went.
   */
  sendAt(owner: Player, target: Player): boolean {
    if (this.canSendAt(owner, target) !== null) return false;
    const mine = this.spies.filter((s) => s.owner === owner.smallID());
    const idle = mine.filter((s) => s.mission === "none");
    const pool = idle.length > 0 ? idle : mine;
    const land = this.nearestTileOf(target, pool[0]);
    let best = pool[0];
    let bestD = Infinity;
    for (const s of pool) {
      const d = this.dist2To(s, land);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    this.stop(best);
    best.mission = "country";
    best.target = target.smallID();
    if (this.nextGoal(best)) return true;
    this.stop(best);
    return false;
  }

  /** Moves every spy on by one tick. */
  tick(): void {
    const tick = this.game.ticks();
    const dead = new Set<Spy>();
    for (const spy of this.spies) {
      const owner = this.game.playerBySmallID(spy.owner);
      if (!owner.isPlayer() || !owner.isAlive()) {
        dead.add(spy);
        continue;
      }
      if (spy.mission === "country") {
        const target = this.game.playerBySmallID(spy.target);
        if (!target.isPlayer() || !target.isAlive()) {
          this.finish(spy, owner, target.isPlayer() ? target : null);
          continue;
        }
      }

      if (spy.investigating) {
        if (--spy.ticksLeft > 0) continue;
        spy.investigating = false;
        if (this.caught(spy, tick)) {
          this.reportCaught(spy, owner);
          dead.add(spy);
          continue;
        }
        this.fog.reveal(spy.owner, spy.goal);
        if (spy.mission === "country" && this.nextGoal(spy)) continue;
        const target = this.game.playerBySmallID(spy.target);
        if (spy.mission === "country") {
          this.finish(spy, owner, target.isPlayer() ? target : null);
        } else {
          this.stop(spy);
        }
        continue;
      }

      if (this.step(spy) && spy.goal !== NO_PROVINCE) {
        spy.investigating = true;
        spy.ticksLeft = SPY_SETTINGS.investigateTicks;
      }
    }
    if (dead.size > 0) this.spies = this.spies.filter((s) => !dead.has(s));
  }

  /** State for snapshots. */
  state(): { spies: Spy[]; nextID: number } {
    return { spies: this.spies.map((s) => ({ ...s })), nextID: this.nextID };
  }

  restore(state: { spies: Spy[]; nextID: number }): void {
    this.spies = state.spies.map((s) => ({ ...s }));
    this.nextID = state.nextID;
  }

  /** Moves toward the destination; true on the tick it arrives. */
  private step(spy: Spy): boolean {
    const dx = spy.destX - spy.x;
    const dy = spy.destY - spy.y;
    if (dx === 0 && dy === 0) return false;
    const speed = Math.round(SPY_SETTINGS.tilesPerTick * SCALE);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= speed) {
      spy.x = spy.destX;
      spy.y = spy.destY;
      return true;
    }
    spy.x += Math.round((dx * speed) / d);
    spy.y += Math.round((dy * speed) / d);
    return false;
  }

  /** Drops any mission: the spy waits where it is. */
  private stop(spy: Spy): void {
    spy.mission = "none";
    spy.target = 0;
    spy.goal = NO_PROVINCE;
    spy.investigating = false;
    spy.ticksLeft = 0;
    spy.destX = spy.x;
    spy.destY = spy.y;
  }

  private headFor(spy: Spy, province: number): void {
    spy.goal = province;
    spy.destX = this.centerX[province] * SCALE + SCALE / 2;
    spy.destY = this.centerY[province] * SCALE + SCALE / 2;
  }

  /** A country mission is over: nothing left to find, or it is gone. */
  private finish(spy: Spy, owner: Player, target: Player | null): void {
    this.stop(spy);
    this.game.displayMessage(
      "events_display.spy_finished",
      MessageType.SPY_REPORT,
      owner.id(),
      undefined,
      { name: target?.displayName() ?? "" },
    );
  }

  private reportCaught(spy: Spy, owner: Player): void {
    // The victim is whoever holds the province it was investigating.
    const holder = this.mainOwner(spy.goal);
    const victim = holder === 0 ? null : this.game.playerBySmallID(holder);
    if (victim !== null && victim.isPlayer()) {
      this.game.displayMessage(
        "events_display.spy_caught_victim",
        MessageType.SPY_CAUGHT,
        victim.id(),
        undefined,
        { name: owner.displayName() },
        undefined,
        owner.id(),
      );
    }
    this.game.displayMessage(
      "events_display.spy_caught_owner",
      MessageType.SPY_CAUGHT,
      owner.id(),
      undefined,
      {
        name: victim !== null && victim.isPlayer() ? victim.displayName() : "",
      },
    );
  }

  private caught(spy: Spy, tick: number): boolean {
    const rand = new PseudoRandom(
      simpleHash(`spy:${spy.id}:${spy.goal}:${tick}`),
    );
    return rand.nextInt(0, 1000) < SPY_SETTINGS.detectionPerMille;
  }

  /**
   * Country missions: heads for the target's next province to investigate;
   * false when none is left that the owner does not already see.
   */
  private nextGoal(spy: Spy): boolean {
    const candidates = this.targetProvinces(spy);
    if (candidates.length === 0) return false;

    // Grow from what the owner already knows, like a front.
    const frontier = candidates.filter((p) =>
      this.neighbors[p].some((q) => this.fog.visibility(spy.owner, q) !== 0),
    );
    const pool = frontier.length > 0 ? frontier : candidates;
    let goal = pool[0];
    let bestD = Infinity;
    for (const p of pool) {
      const d = this.dist2To(spy, this.centers[p] as TileRef);
      if (d < bestD || (d === bestD && p < goal)) {
        goal = p;
        bestD = d;
      }
    }
    this.headFor(spy, goal);
    return true;
  }

  /**
   * The target's provinces (it holds the most tiles there) its owner can
   * neither see live nor has revealed yet.
   */
  private targetProvinces(spy: Spy): number[] {
    const best = this.mainOwners();
    const revealed = this.fog.revealedBy(spy.owner);
    const out: number[] = [];
    for (const [p, owner] of best) {
      if (
        owner === spy.target &&
        !revealed.has(p) &&
        this.fog.visibility(spy.owner, p) !== VISIBLE
      ) {
        out.push(p);
      }
    }
    return out.sort((a, b) => a - b);
  }

  private mainOwners(): Map<number, number> {
    const best = new Map<number, { owner: number; tiles: number }>();
    this.game.provinces().forEachOwnerCount((p, owner, tiles) => {
      const b = best.get(p);
      if (
        b === undefined ||
        tiles > b.tiles ||
        (tiles === b.tiles && owner < b.owner)
      ) {
        best.set(p, { owner, tiles });
      }
    });
    return new Map([...best].map(([p, b]) => [p, b.owner]));
  }

  private mainOwner(province: number): number {
    return this.mainOwners().get(province) ?? 0;
  }

  /** A tile of `target` near `spy` (the center of its closest province). */
  private nearestTileOf(target: Player, spy: Spy): TileRef {
    let best = this.centers[1] as TileRef;
    let bestD = Infinity;
    for (const [p, owner] of this.mainOwners()) {
      if (owner !== target.smallID()) continue;
      const d = this.dist2To(spy, this.centers[p] as TileRef);
      if (d < bestD) {
        bestD = d;
        best = this.centers[p] as TileRef;
      }
    }
    return best;
  }

  /** Squared distance, in tiles, from a spy to a tile. */
  private dist2To(spy: Spy, tile: TileRef): number {
    const dx = Math.floor(spy.x / SCALE) - this.game.x(tile);
    const dy = Math.floor(spy.y / SCALE) - this.game.y(tile);
    return dx * dx + dy * dy;
  }
}

function smallIDOf(p: Player | number): number {
  return typeof p === "number" ? p : p.smallID();
}
