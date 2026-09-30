import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { Cell } from "../../../core/game/Game";
import type { SpyView } from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

const spyIcon = assetUrl("images/NinjaIconWhite.svg");
const SIZE = 58;
const ICON = 28;

interface Marker {
  spy: SpyView;
  /** Drawn position (tiles), easing toward the spy's real one. */
  x: number;
  y: number;
}

/**
 * Fog of war: the local player's spies on the map, as purple markers with a
 * ring that fills while they investigate. Clicking one selects it; the next
 * click on the map orders it there (ClientGameRunner.orderSpyAt). Only its
 * owner ever sees a spy.
 */
@customElement("spy-markers")
export class SpyMarkers extends LitElement implements Controller {
  public game: GameView;
  public transformHandler: TransformHandler;
  public uiState: UIState;

  private markers = new Map<number, Marker>();
  private raf = 0;
  private lastFrame = 0;

  createRenderRoot() {
    return this;
  }

  init() {
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      // Ease toward the last reported position (reports come every tick).
      const k = Math.min(1, dt * 12);
      for (const m of this.markers.values()) {
        m.x += (m.spy.x - m.x) * k;
        m.y += (m.spy.y - m.y) * k;
      }
      if (this.markers.size > 0) this.requestUpdate();
    };
    this.raf = requestAnimationFrame(frame);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf);
  }

  tick() {
    const spies = this.game?.mySpies() ?? [];
    const seen = new Set<number>();
    for (const spy of spies) {
      seen.add(spy.id);
      const m = this.markers.get(spy.id);
      if (m === undefined) {
        this.markers.set(spy.id, { spy, x: spy.x, y: spy.y });
      } else {
        m.spy = spy;
      }
    }
    for (const id of [...this.markers.keys()]) {
      if (!seen.has(id)) this.markers.delete(id);
    }
    if (
      this.uiState?.selectedSpy !== undefined &&
      this.uiState.selectedSpy !== null &&
      !seen.has(this.uiState.selectedSpy)
    ) {
      this.uiState.selectedSpy = null;
    }
    this.requestUpdate();
  }

  private toggleSelect(id: number) {
    this.uiState.spyPlacing = false;
    this.uiState.ghostStructure = null;
    this.uiState.selectedSpy = this.uiState.selectedSpy === id ? null : id;
    this.requestUpdate();
  }

  render() {
    if (this.transformHandler === undefined || this.markers.size === 0) {
      return html``;
    }
    return html`${[...this.markers.values()].map((m) => {
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(m.x, m.y),
      );
      const selected = this.uiState?.selectedSpy === m.spy.id;
      const progress = m.spy.progress;
      // Drawn like a structure: the owner's structure colors, light fill
      // with a dark outline and icon.
      const colors = this.game.myPlayer()?.structureColors();
      const light = colors?.light.toRgbString() ?? "#d8b4fe";
      const dark = colors?.dark.toRgbString() ?? "#3b0764";
      // A purple ring fills around it while it investigates.
      const ring =
        progress === null
          ? "transparent"
          : `conic-gradient(#c084fc ${progress}%, rgba(46, 16, 101, 0.55) 0)`;
      return html`<div
        class="fixed z-[900] cursor-pointer rounded-full flex items-center justify-center"
        style="left:${p.x - SIZE / 2}px; top:${p.y - SIZE / 2}px;
          width:${SIZE}px; height:${SIZE}px; background:${ring};
          filter:${selected
          ? "drop-shadow(0 0 6px #fff) drop-shadow(0 0 3px #fff)"
          : "drop-shadow(0 1px 2px rgba(0,0,0,0.6))"};"
        title=${translateText("spy.marker_title")}
        @click=${(e: MouseEvent) => {
          e.stopPropagation();
          this.toggleSelect(m.spy.id);
        }}
        @mousedown=${(e: MouseEvent) => e.stopPropagation()}
        @mouseup=${(e: MouseEvent) => e.stopPropagation()}
        @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
        @pointerup=${(e: PointerEvent) => e.stopPropagation()}
      >
        <div
          class="rounded-full flex items-center justify-center"
          style="width:${SIZE - 12}px; height:${SIZE - 12}px;
            background:${light}; border:3px solid ${dark};
            box-sizing:border-box;"
        >
          <div
            style="width:${ICON}px; height:${ICON}px; background:${dark};
              -webkit-mask:url(${spyIcon}) center / contain no-repeat;
              mask:url(${spyIcon}) center / contain no-repeat;"
          ></div>
        </div>
      </div>`;
    })}`;
  }
}
