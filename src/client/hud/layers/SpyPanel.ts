import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import type { SpyView } from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { GoToPositionEvent } from "../../TransformHandler";
import { SendSpyAutoIntentEvent } from "../../Transport";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * Fog of war: the local player's spies at a glance, under the gold panel.
 * Each row says what the spy is doing, and has a button to center the
 * camera on it and one to let it explore on its own. Clicking a row selects
 * the spy, so the next click on the map orders it (like clicking its
 * marker).
 */
@customElement("spy-panel")
export class SpyPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state() private spies: SpyView[] = [];
  @state() private collapsed = false;

  createRenderRoot() {
    return this;
  }

  init() {
    try {
      this.collapsed =
        window.localStorage.getItem("spyPanel.collapsed") === "true";
    } catch {
      // Storage can be unavailable (private windows); keep it open.
    }
  }

  tick() {
    this.spies = this.game?.mySpies() ?? [];
    this.requestUpdate();
  }

  private toggle = () => {
    this.collapsed = !this.collapsed;
    try {
      window.localStorage.setItem("spyPanel.collapsed", String(this.collapsed));
    } catch {
      // Not remembered then.
    }
  };

  private select(spy: SpyView) {
    this.uiState.spyPlacing = false;
    this.uiState.ghostStructure = null;
    this.uiState.selectedSpy =
      this.uiState.selectedSpy === spy.id ? null : spy.id;
    this.requestUpdate();
  }

  /** What the spy is doing, in words. */
  private status(spy: SpyView): string {
    const target =
      spy.mission === "country" ? this.game.playerBySmallID(spy.target) : null;
    const name =
      target !== null && target.isPlayer() ? target.displayName() : "";
    if (spy.progress !== null) {
      return spy.mission === "country"
        ? translateText("spy_panel.spying_investigating", {
            name,
            progress: spy.progress,
          })
        : translateText("spy_panel.exploring", { progress: spy.progress });
    }
    if (spy.moving) {
      if (spy.mission === "country") {
        return translateText("spy_panel.spying_travelling", { name });
      }
      return translateText(
        spy.mission === "province"
          ? "spy_panel.to_province"
          : "spy_panel.moving",
      );
    }
    return translateText(
      spy.auto ? "spy_panel.auto_searching" : "spy_panel.waiting",
    );
  }

  render() {
    if (this.spies.length === 0) return html``;
    return html`
      <div
        class="min-w-44 max-w-72 p-2 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-l-lg text-white text-sm"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <button
          class="w-full flex items-center justify-between gap-3 font-bold cursor-pointer"
          @click=${this.toggle}
        >
          <span translate="no">${translateText("spy_panel.title")}</span>
          <span class="text-purple-300">${this.spies.length}</span>
        </button>
        ${this.collapsed
          ? html``
          : html`<div class="mt-1 flex flex-col gap-1">
              ${this.spies.map((spy, i) => this.renderRow(spy, i))}
            </div>`}
      </div>
    `;
  }

  private renderRow(spy: SpyView, index: number) {
    const selected = this.uiState?.selectedSpy === spy.id;
    return html`
      <div
        class="rounded px-1.5 py-1 cursor-pointer ${selected
          ? "bg-purple-600/50 ring-1 ring-purple-300"
          : "hover:bg-white/10"}"
        title=${translateText("spy_panel.select_hint")}
        @click=${() => this.select(spy)}
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-purple-200">
            ${translateText("spy_panel.name", { n: index + 1 })}
          </span>
          <span class="flex gap-1">
            <button
              class="px-1.5 rounded text-xs bg-gray-600 hover:bg-gray-500"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.eventBus.emit(new GoToPositionEvent(spy.x, spy.y));
              }}
            >
              ${translateText("spy_panel.center")}
            </button>
            <button
              class="px-1.5 rounded text-xs ${spy.auto
                ? "bg-purple-500 hover:bg-purple-400"
                : "bg-gray-600 hover:bg-gray-500"}"
              title=${translateText("spy_panel.auto_hint")}
              @click=${(e: Event) => {
                e.stopPropagation();
                this.eventBus.emit(
                  new SendSpyAutoIntentEvent(spy.id, !spy.auto),
                );
              }}
            >
              ${translateText("spy_panel.auto")}
            </button>
          </span>
        </div>
        <div class="text-xs text-gray-300">${this.status(spy)}</div>
      </div>
    `;
  }
}
