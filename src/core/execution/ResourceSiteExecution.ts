import { z } from "zod";
import { RESOURCE_SETTINGS } from "../configuration/ProvinceConfig";
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType, ResourceSiteState } from "../game/GameUpdates";
import {
  generateResourceSites,
  ResourceSite,
  ResourceType,
} from "../game/ResourceSites";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zRef, zTile } from "../snapshot/SnapshotType";
import { PortExecution } from "./PortExecution";

interface SiteRecord extends ResourceSite {
  state: ResourceSiteState;
  /** The building handed out for this site while it is claimed. */
  unit: Unit | null;
  /** smallID of the building's owner when last seen (0 = none). */
  owner: number;
  /** Tick the current owner got the building (mine levels count from it). */
  heldSince: number;
}

/**
 * Runs the game's resource sites (farm, mine, natural harbor):
 *
 * - Places them when the game starts, seeded from the game id.
 * - Hands the site's building to whoever first conquers its tile. From then
 *   on it is a normal structure: captured with its tile by the capturing
 *   player's PlayerExecution.
 * - A building destroyed by a nuke (fallout, or the tile sunk) takes the
 *   site with it for good; one lost any other way (its tile left unowned)
 *   frees the site again.
 * - Mines gain a level every mineLevelUpTicks with one owner, back to level 1
 *   when captured, and pay mineGoldPerLevel gold per level every tick.
 *
 * Farms have no per-tick work: their troop bonus is read by Config.maxTroops.
 */
export class ResourceSiteExecution implements Execution {
  private mg: Game | null = null;
  private active = true;
  private sites: SiteRecord[] = [];
  // Not snapshotted: a restored game resends the sites on its first tick.
  private dirty = true;

  constructor(private seed: number) {}

  init(mg: Game): void {
    this.mg = mg;
    if (this.sites.length > 0) return;
    this.sites = generateResourceSites(
      mg.map(),
      mg.provinces().map(),
      this.seed,
    ).map((s) => ({
      ...s,
      state: "unclaimed",
      unit: null,
      owner: 0,
      heldSince: 0,
    }));
    this.publishProvinces();
  }

  /** Tells the game which provinces still hold a resource (for the AI). */
  private publishProvinces(): void {
    this.mg!.setResourceProvinces(
      new Set(
        this.sites
          .filter((s) => s.state !== "destroyed")
          .map((s) => s.province),
      ),
    );
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    for (const site of this.sites) {
      switch (site.state) {
        case "destroyed":
          break;
        case "claimed":
          this.tickClaimed(mg, site, ticks);
          break;
        case "unclaimed":
          this.tryClaim(mg, site, ticks);
          break;
      }
    }
    if (this.dirty) {
      this.dirty = false;
      this.publishProvinces();
      mg.addUpdate({
        type: GameUpdateType.ResourceSites,
        sites: this.sites.map((s) => ({
          type: s.type,
          tile: s.tile,
          state: s.state,
        })),
      });
    }
  }

  private tryClaim(mg: Game, site: SiteRecord, ticks: number): void {
    const owner = mg.owner(site.tile);
    if (!owner.isPlayer()) return;
    let unit: Unit;
    switch (site.type) {
      case ResourceType.Farm:
        unit = owner.grantUnit(UnitType.Farm, site.tile, {});
        break;
      case ResourceType.Mine:
        unit = owner.grantUnit(UnitType.Mine, site.tile, {});
        break;
      case ResourceType.NaturalHarbor:
        unit = owner.grantUnit(UnitType.Port, site.tile, { natural: true });
        mg.addExecution(new PortExecution(unit));
        break;
    }
    site.state = "claimed";
    site.unit = unit;
    site.owner = owner.smallID();
    site.heldSince = ticks;
    this.dirty = true;
  }

  private tickClaimed(mg: Game, site: SiteRecord, ticks: number): void {
    const unit = site.unit;
    if (unit === null || !unit.isActive()) {
      // Nukes leave fallout (or sink the tile); anything else only means the
      // tile was left unowned, and the site is up for grabs again.
      const nuked = mg.hasFallout(site.tile) || !mg.isLand(site.tile);
      site.state = nuked ? "destroyed" : "unclaimed";
      site.unit = null;
      site.owner = 0;
      this.dirty = true;
      return;
    }

    const owner = unit.owner();
    if (owner.smallID() !== site.owner) {
      site.owner = owner.smallID();
      site.heldSince = ticks;
    }
    if (site.type !== ResourceType.Mine) return;

    const level =
      1 +
      Math.floor((ticks - site.heldSince) / RESOURCE_SETTINGS.mineLevelUpTicks);
    while (unit.level() < level) unit.increaseLevel();
    while (unit.level() > level) unit.decreaseLevel();
    const gold = BigInt(RESOURCE_SETTINGS.mineGoldPerLevel * level);
    // No tile: a tile would pop a "+gold" bonus effect on the mine every tick.
    owner.addGold(gold);
    mg.stats().goldWork(owner, gold);
  }

  /** The sites and their states, for tests and the AI. */
  resourceSites(): readonly Readonly<SiteRecord>[] {
    return this.sites;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    // Players may still move their spawn: sites are handed out afterwards.
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ResourceSiteExecutionSnapshot.write({
      seed: this.seed,
      sites: this.sites.map((s) => ({
        type: s.type,
        province: s.province,
        tile: s.tile,
        state: s.state,
        // A building lost after this execution ticked is resolved on the
        // restored game's first tick, exactly as it would have been here.
        unit: s.unit !== null && s.unit.isActive() ? w.unit(s.unit) : null,
        owner: s.owner,
        heldSince: s.heldSince,
      })),
    });
  }

  restoreSnapshot(s: ResourceSiteState_, r: SnapshotReader): void {
    this.mg = r.game;
    this.active = true;
    this.seed = s.seed;
    this.sites = s.sites.map((site) => ({
      type: site.type,
      province: site.province,
      tile: site.tile as TileRef,
      state: site.state,
      unit: r.unitOrNull(site.unit),
      owner: site.owner,
      heldSince: site.heldSince,
    }));
    this.dirty = true;
    this.publishProvinces();
  }
}

const ResourceSiteStateSchema = z.object({
  seed: zInt(),
  sites: z.array(
    z.object({
      type: z.enum(ResourceType),
      province: zInt(),
      tile: zTile(),
      state: z.enum(["unclaimed", "claimed", "destroyed"]),
      unit: zRef().nullable(),
      owner: zInt(),
      heldSince: zInt(),
    }),
  ),
});
type ResourceSiteState_ = z.infer<typeof ResourceSiteStateSchema>;

export const ResourceSiteExecutionSnapshot = execSnapshotType({
  name: "ResourceSite",
  version: 1,
  schema: ResourceSiteStateSchema,
  cls: () => ResourceSiteExecution,
});
