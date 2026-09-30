import { SPY_SETTINGS } from "../configuration/ProvinceConfig";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import type { FogOfWar } from "./FogOfWar";
import { Game, MessageType, Player } from "./Game";
import { TileRef } from "./GameMap";
import { NO_PROVINCE } from "./Provinces";

export type SpyPhase = "travel" | "investigate";

export interface Spy {
  id: number;
  /** smallIDs of the spy's owner and of the player it spies on. */
  owner: number;
  target: number;
  /** Province the spy is in. */
  province: number;
  /** Provinces still to cross before reaching `goal`. */
  path: number[];
  /** Province it is heading for or investigating. */
  goal: number;
  phase: SpyPhase;
  /** Ticks left in the current hop or investigation, out of phaseTicks. */
  ticksLeft: number;
  phaseTicks: number;
}

/** Why a spy cannot be sent (null: it can). */
export type SpyRefusal =
  | "no_fog"
  | "self"
  | "dead"
  | "unknown_player"
  | "no_land"
  | "max_spies"
  | "gold";

/**
 * The spies of a fog-of-war game. A spy starts from its owner's province
 * closest to the target and works on its own: it picks the target's province
 * next to what its owner already knows (closest first), walks there province
 * by province (or crosses the sea when no land route exists), investigates it
 * for SPY_SETTINGS.investigateTicks and reveals it to its owner for good.
 * Its owner also sees whatever province it is in while it is there.
 *
 * At the end of each investigation it may be caught (detectionPerMille): it
 * dies, what it found stays found, and both players are told. When nothing
 * is left to investigate, or the target is gone, it goes home.
 *
 * Deterministic: the catch roll is seeded from the spy, province and tick.
 */
export class SpyNetwork {
  private spies: Spy[] = [];
  /** Spies each player has sent so far (their price grows with it). */
  private sent = new Map<number, number>();
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

  /** Gold the next spy of `owner` costs. */
  cost(owner: Player | number): bigint {
    const sent = this.sent.get(smallIDOf(owner)) ?? 0;
    return BigInt(SPY_SETTINGS.baseCost + SPY_SETTINGS.costStep * sent);
  }

  activeCount(owner: Player | number): number {
    const id = smallIDOf(owner);
    return this.spies.filter((s) => s.owner === id).length;
  }

  /** The spies out right now. */
  list(): readonly Spy[] {
    return this.spies;
  }

  /** Spies sent so far, per owner smallID. */
  sentCounts(): ReadonlyMap<number, number> {
    return this.sent;
  }

  /** A tile near the middle of a province (where spies are drawn). */
  centerOf(province: number): TileRef {
    return this.centers[province] as TileRef;
  }

  /** Provinces `owner` sees through their spies right now. */
  seenBy(owner: number): number[] {
    return this.spies.filter((s) => s.owner === owner).map((s) => s.province);
  }

  canSend(owner: Player, target: Player): SpyRefusal | null {
    if (owner === target) return "self";
    if (!owner.isAlive() || !target.isAlive()) return "dead";
    if (!this.fog.knowsPlayer(owner, target)) return "unknown_player";
    if (this.startProvince(owner, target) === NO_PROVINCE) return "no_land";
    if (this.activeCount(owner) >= SPY_SETTINGS.maxActive) return "max_spies";
    if (owner.gold() < this.cost(owner)) return "gold";
    return null;
  }

  /** Sends a spy at `target` if `owner` can; returns whether it went. */
  send(owner: Player, target: Player): boolean {
    if (this.canSend(owner, target) !== null) return false;
    owner.removeGold(this.cost(owner));
    this.sent.set(owner.smallID(), (this.sent.get(owner.smallID()) ?? 0) + 1);
    const spy: Spy = {
      id: this.nextID++,
      owner: owner.smallID(),
      target: target.smallID(),
      province: this.startProvince(owner, target),
      path: [],
      goal: NO_PROVINCE,
      phase: "travel",
      ticksLeft: 0,
      phaseTicks: 0,
    };
    this.spies.push(spy);
    this.nextGoal(spy);
    return true;
  }

  /** Moves every spy on by one tick. */
  tick(): void {
    const tick = this.game.ticks();
    const done = new Set<Spy>();
    for (const spy of this.spies) {
      const owner = this.game.playerBySmallID(spy.owner);
      const target = this.game.playerBySmallID(spy.target);
      if (!owner.isPlayer() || !owner.isAlive()) {
        done.add(spy);
        continue;
      }
      if (!target.isPlayer() || !target.isAlive()) {
        this.finish(owner, target.isPlayer() ? target : null);
        done.add(spy);
        continue;
      }
      if (--spy.ticksLeft > 0) continue;

      if (spy.phase === "travel") {
        spy.province = spy.path.shift() ?? spy.goal;
        if (spy.path.length > 0) {
          this.startHop(spy, spy.path[0]);
        } else {
          spy.phase = "investigate";
          spy.ticksLeft = spy.phaseTicks = SPY_SETTINGS.investigateTicks;
        }
        continue;
      }

      // Investigation over: caught, or the province is revealed for good.
      if (this.caught(spy, tick)) {
        this.game.displayMessage(
          "events_display.spy_caught_victim",
          MessageType.SPY_CAUGHT,
          target.id(),
          undefined,
          { name: owner.displayName() },
          undefined,
          owner.id(),
        );
        this.game.displayMessage(
          "events_display.spy_caught_owner",
          MessageType.SPY_CAUGHT,
          owner.id(),
          undefined,
          { name: target.displayName() },
          undefined,
          target.id(),
        );
        done.add(spy);
        continue;
      }
      this.fog.reveal(spy.owner, spy.goal);
      if (!this.nextGoal(spy)) {
        this.finish(owner, target);
        done.add(spy);
      }
    }
    if (done.size > 0) this.spies = this.spies.filter((s) => !done.has(s));
  }

  /** State for snapshots. */
  state(): { spies: Spy[]; sent: [number, number][]; nextID: number } {
    return {
      spies: this.spies.map((s) => ({ ...s, path: [...s.path] })),
      sent: [...this.sent.entries()],
      nextID: this.nextID,
    };
  }

  restore(state: {
    spies: Spy[];
    sent: [number, number][];
    nextID: number;
  }): void {
    this.spies = state.spies.map((s) => ({ ...s, path: [...s.path] }));
    this.sent = new Map(state.sent);
    this.nextID = state.nextID;
  }

  /** A spy comes home: nothing left to find, or its target is gone. */
  private finish(owner: Player, target: Player | null): void {
    this.game.displayMessage(
      "events_display.spy_finished",
      MessageType.SPY_REPORT,
      owner.id(),
      undefined,
      { name: target?.displayName() ?? "" },
    );
  }

  private caught(spy: Spy, tick: number): boolean {
    const rand = new PseudoRandom(
      simpleHash(`spy:${spy.id}:${spy.goal}:${tick}`),
    );
    return rand.nextInt(0, 1000) < SPY_SETTINGS.detectionPerMille;
  }

  /**
   * Picks the next province to investigate and sets the spy on its way;
   * false when the target has nothing left it has not revealed.
   */
  private nextGoal(spy: Spy): boolean {
    const candidates = this.targetProvinces(spy);
    if (candidates.length === 0) return false;

    // Grow from what the owner already knows, like a front.
    const frontier = candidates.filter((p) =>
      this.neighbors[p].some(
        // 0 = ProvinceVisibility.Unknown (not imported: FogOfWar owns us).
        (q) => this.fog.visibility(spy.owner, q) !== 0,
      ),
    );
    const pool = frontier.length > 0 ? frontier : candidates;
    let goal = pool[0];
    let bestD = Infinity;
    for (const p of pool) {
      const d = this.distance2(spy.province, p);
      if (d < bestD || (d === bestD && p < goal)) {
        goal = p;
        bestD = d;
      }
    }

    spy.goal = goal;
    if (goal === spy.province) {
      spy.path = [];
      spy.phase = "investigate";
      spy.ticksLeft = spy.phaseTicks = SPY_SETTINGS.investigateTicks;
      return true;
    }
    spy.path = this.route(spy.province, goal) ?? [goal];
    spy.phase = "travel";
    this.startHop(spy, spy.path[0]);
    return true;
  }

  /** Starts crossing into `next`: a province over, or across the sea. */
  private startHop(spy: Spy, next: number): void {
    const overLand = this.neighbors[spy.province].includes(next);
    const ticks = overLand
      ? SPY_SETTINGS.travelTicksPerProvince
      : Math.ceil(
          Math.sqrt(this.distance2(spy.province, next)) *
            SPY_SETTINGS.seaTicksPerTile,
        );
    spy.ticksLeft = spy.phaseTicks = Math.max(1, ticks);
  }

  /** Target provinces (it holds the most tiles there) not yet revealed. */
  private targetProvinces(spy: Spy): number[] {
    const provinces = this.game.provinces();
    const best = new Map<number, { owner: number; tiles: number }>();
    provinces.forEachOwnerCount((p, owner, tiles) => {
      const b = best.get(p);
      if (
        b === undefined ||
        tiles > b.tiles ||
        (tiles === b.tiles && owner < b.owner)
      ) {
        best.set(p, { owner, tiles });
      }
    });
    const revealed = this.fog.revealedBy(spy.owner);
    const out: number[] = [];
    for (const [p, b] of best) {
      if (b.owner === spy.target && !revealed.has(p)) out.push(p);
    }
    return out.sort((a, b) => a - b);
  }

  /** Provinces to cross from `from` to `to` over neighbors (null: none). */
  private route(from: number, to: number): number[] | null {
    const prev = new Map<number, number>([[from, NO_PROVINCE]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (p === to) break;
      for (const q of this.neighbors[p]) {
        if (prev.has(q)) continue;
        prev.set(q, p);
        queue.push(q);
      }
    }
    if (!prev.has(to)) return null;
    const path: number[] = [];
    for (let p = to; p !== from; p = prev.get(p)!) path.push(p);
    return path.reverse();
  }

  /** The owner's province closest to the target's nearest one. */
  private startProvince(owner: Player, target: Player): number {
    const provinces = this.game.provinces();
    const mine: number[] = [];
    const theirs: number[] = [];
    provinces.forEachOwnerCount((p, id) => {
      if (id === owner.smallID()) mine.push(p);
      if (id === target.smallID()) theirs.push(p);
    });
    if (mine.length === 0 || theirs.length === 0) return NO_PROVINCE;
    mine.sort((a, b) => a - b);
    theirs.sort((a, b) => a - b);
    let best = NO_PROVINCE;
    let bestD = Infinity;
    for (const m of mine) {
      for (const t of theirs) {
        const d = this.distance2(m, t);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  private distance2(a: number, b: number): number {
    const dx = this.centerX[a] - this.centerX[b];
    const dy = this.centerY[a] - this.centerY[b];
    return dx * dx + dy * dy;
  }
}

function smallIDOf(p: Player | number): number {
  return typeof p === "number" ? p : p.smallID();
}
