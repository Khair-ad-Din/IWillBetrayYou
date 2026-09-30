import { PlayerBuildableUnitType } from "../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /**
   * Fog of war: the spy button of the hotbar is on; the next click on the
   * player's own land buys a spy there.
   */
  spyPlacing?: boolean;
  /** Fog of war: the spy selected on the map; the next click orders it. */
  selectedSpy?: number | null;
}
