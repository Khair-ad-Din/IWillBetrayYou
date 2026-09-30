import { PlayerBuildableUnitType } from "../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /**
   * Fog of war: the spy button of the hotbar is on; the next click on
   * another player's land sends them a spy.
   */
  spyTargeting?: boolean;
}
