import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { mineGoldPerTick } from "../../../core/configuration/ProvinceConfig";
import { UnitType } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";

/** Game ticks per game minute (10 ticks per second). */
const TICKS_PER_MINUTE = 600;
/** Lumpy sources (ships, trains, conquests) are averaged over this window. */
const WINDOW_TICKS = TICKS_PER_MINUTE;
/** Below this much history the windowed sources are not shown yet. */
const MIN_WINDOW_TICKS = 50;

export interface IncomeSample {
  tick: number;
  /** Cumulative counters, as the player view reports them. */
  earned: number;
  trade: number;
  train: number;
  piracy: number;
}

export interface IncomeRates {
  /** Gold per game minute, by source. */
  base: number;
  mines: number;
  trade: number;
  trains: number;
  piracy: number;
  /** Conquests, donations and anything else not broken out. */
  other: number;
  total: number;
  /** Whether enough history exists for the windowed sources. */
  warmedUp: boolean;
}

/**
 * Turns the player's cumulative income counters into gold per minute by
 * source. Steady sources (base income, mines) are exact from their current
 * per-tick rate; lumpy ones (trade ships, trains, piracy, conquests) are the
 * gold they paid over the last game minute.
 */
export class IncomeTracker {
  private samples: IncomeSample[] = [];
  // Cumulative base + mine gold, integrated from their per-tick rates, so the
  // remainder of goldEarned can be attributed to "other".
  private steadyAccrued: { tick: number; value: number }[] = [];
  private accrued = 0;
  private lastTick = -1;

  reset(): void {
    this.samples = [];
    this.steadyAccrued = [];
    this.accrued = 0;
    this.lastTick = -1;
  }

  /** Records the state at `sample.tick`; steady rates are gold per tick. */
  record(sample: IncomeSample, baseRate: number, mineRate: number): void {
    if (sample.tick <= this.lastTick) return;
    if (this.lastTick >= 0) {
      this.accrued += (baseRate + mineRate) * (sample.tick - this.lastTick);
    }
    this.lastTick = sample.tick;
    this.samples.push(sample);
    this.steadyAccrued.push({ tick: sample.tick, value: this.accrued });
    const cutoff = sample.tick - WINDOW_TICKS;
    while (this.samples.length > 1 && this.samples[1].tick <= cutoff) {
      this.samples.shift();
      this.steadyAccrued.shift();
    }
  }

  rates(baseRate: number, mineRate: number): IncomeRates {
    const base = baseRate * TICKS_PER_MINUTE;
    const mines = mineRate * TICKS_PER_MINUTE;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const span = first && last ? last.tick - first.tick : 0;
    if (span < MIN_WINDOW_TICKS) {
      return {
        base,
        mines,
        trade: 0,
        trains: 0,
        piracy: 0,
        other: 0,
        total: base + mines,
        warmedUp: false,
      };
    }
    const perMinute = (delta: number) => (delta * TICKS_PER_MINUTE) / span;
    const dTrade = last.trade - first.trade;
    const dTrain = last.train - first.train;
    const dPiracy = last.piracy - first.piracy;
    const dSteady =
      this.steadyAccrued[this.steadyAccrued.length - 1].value -
      this.steadyAccrued[0].value;
    const dOther = Math.max(
      0,
      last.earned - first.earned - dTrade - dTrain - dPiracy - dSteady,
    );
    const trade = perMinute(dTrade);
    const trains = perMinute(dTrain);
    const piracy = perMinute(dPiracy);
    const other = perMinute(dOther);
    return {
      base,
      mines,
      trade,
      trains,
      piracy,
      other,
      total: base + mines + trade + trains + piracy + other,
      warmedUp: true,
    };
  }
}

/**
 * Top-right HUD panel: the local player's live gold per minute, broken down
 * by source, so players can judge where their money comes from. Click the
 * title to collapse it.
 */
@customElement("gold-income-panel")
export class GoldIncomePanel extends LitElement implements Controller {
  public game: GameView;

  @state() private visible = false;
  @state() private collapsed = false;
  @state() private rates: IncomeRates | null = null;

  private tracker = new IncomeTracker();
  private tickCount = 0;

  createRenderRoot() {
    return this; // Enable Tailwind CSS
  }

  init() {
    try {
      this.collapsed =
        window.localStorage.getItem("goldIncomePanel.collapsed") === "true";
    } catch {
      // Storage may be unavailable; start expanded.
    }
  }

  tick() {
    const me = this.game?.myPlayer();
    if (!me || !me.isAlive() || this.game.inSpawnPhase()) {
      this.visible = false;
      this.tracker.reset();
      return;
    }
    const baseRate = Number(this.game.config().goldAdditionRate(me));
    const mineRate = me
      .units(UnitType.Mine)
      .reduce((sum, mine) => sum + mineGoldPerTick(mine.level()), 0);
    this.tracker.record(
      {
        tick: this.game.ticks(),
        earned: me.goldEarned(),
        trade: me.tradeGold(),
        train: me.trainGold(),
        piracy: me.piracyGold(),
      },
      baseRate,
      mineRate,
    );
    this.visible = true;
    // Re-render about once a second, not every tick.
    if (this.tickCount++ % 10 === 0) {
      this.rates = this.tracker.rates(baseRate, mineRate);
    }
  }

  private toggle() {
    this.collapsed = !this.collapsed;
    try {
      window.localStorage.setItem(
        "goldIncomePanel.collapsed",
        String(this.collapsed),
      );
    } catch {
      // Storage may be unavailable; the toggle still works for this session.
    }
  }

  render() {
    if (!this.visible || this.rates === null) return html``;
    const r = this.rates;
    const rows: [string, number, string][] = [
      ["gold_income.base", r.base, "bg-yellow-300"],
      ["gold_income.mines", r.mines, "bg-amber-600"],
      ["gold_income.trade", r.trade, "bg-sky-400"],
      ["gold_income.trains", r.trains, "bg-emerald-400"],
      ["gold_income.piracy", r.piracy, "bg-rose-400"],
      ["gold_income.other", r.other, "bg-gray-400"],
    ];
    return html`
      <div
        class="min-w-44 p-2 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-l-lg text-white text-sm"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <button
          class="w-full flex items-center justify-between gap-3 font-bold cursor-pointer"
          @click=${this.toggle}
        >
          <span translate="no">${translateText("gold_income.title")}</span>
          <span class="text-yellow-300">${renderNumber(r.total)}</span>
        </button>
        ${this.collapsed
          ? html``
          : html`
              <div class="mt-1 flex flex-col gap-0.5">
                ${rows
                  .filter(([, value]) => value > 0)
                  .map(
                    ([key, value, color]) => html`
                      <div class="flex items-center justify-between gap-3">
                        <span class="flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full ${color}"></span>
                          ${translateText(key)}
                        </span>
                        <span>${renderNumber(value)}</span>
                      </div>
                    `,
                  )}
                ${r.warmedUp
                  ? html``
                  : html`<div class="text-xs text-gray-400">
                      ${translateText("gold_income.warming_up")}
                    </div>`}
              </div>
            `}
      </div>
    `;
  }
}
