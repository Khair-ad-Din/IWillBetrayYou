import { describe, expect, it } from "vitest";
import { IncomeTracker } from "../../src/client/hud/layers/GoldIncomePanel";

const BASE = 100; // gold per tick
const MINE = 300; // gold per tick

/** Plays `ticks` ticks of steady income plus optional lump payments. */
function play(
  tracker: IncomeTracker,
  ticks: number,
  lumps: Record<
    number,
    Partial<{ trade: number; train: number; other: number }>
  > = {},
) {
  let earned = 0;
  let trade = 0;
  let train = 0;
  for (let t = 0; t <= ticks; t++) {
    if (t > 0) earned += BASE + MINE;
    const lump = lumps[t];
    if (lump) {
      trade += lump.trade ?? 0;
      train += lump.train ?? 0;
      earned += (lump.trade ?? 0) + (lump.train ?? 0) + (lump.other ?? 0);
    }
    tracker.record({ tick: t, earned, trade, train, piracy: 0 }, BASE, MINE);
  }
}

describe("IncomeTracker", () => {
  it("reports steady sources exactly, from their per-tick rate", () => {
    const tracker = new IncomeTracker();
    play(tracker, 10);
    const r = tracker.rates(BASE, MINE);
    expect(r.base).toBe(BASE * 600);
    expect(r.mines).toBe(MINE * 600);
    expect(r.warmedUp).toBe(false);
    expect(r.total).toBe((BASE + MINE) * 600);
  });

  it("averages lump payments over the last game minute", () => {
    const tracker = new IncomeTracker();
    play(tracker, 600, { 300: { trade: 60_000, train: 30_000 } });
    const r = tracker.rates(BASE, MINE);
    expect(r.warmedUp).toBe(true);
    expect(r.trade).toBeCloseTo(60_000, 0);
    expect(r.trains).toBeCloseTo(30_000, 0);
    expect(r.other).toBeCloseTo(0, 0);
  });

  it("attributes income no counter explains to other", () => {
    const tracker = new IncomeTracker();
    play(tracker, 600, { 200: { other: 45_000 } });
    expect(tracker.rates(BASE, MINE).other).toBeCloseTo(45_000, 0);
  });

  it("forgets payments older than a minute", () => {
    const tracker = new IncomeTracker();
    play(tracker, 1500, { 100: { trade: 60_000 } });
    expect(tracker.rates(BASE, MINE).trade).toBe(0);
  });
});
