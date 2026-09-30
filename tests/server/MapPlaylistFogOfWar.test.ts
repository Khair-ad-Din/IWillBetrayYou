import { describe, expect, it, vi } from "vitest";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// Every game the server publishes on its own has fog of war on.
describe("MapPlaylist fog of war", () => {
  it.each(["ffa", "team", "special"] as const)(
    "turns fog of war on in %s lobbies",
    async (kind) => {
      const config = await new MapPlaylist().gameConfig(kind);
      expect(config.fogOfWar).toBe(true);
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
    },
  );

  it("turns fog of war on in ranked games", () => {
    const playlist = new MapPlaylist();
    expect(playlist.get1v1Config().fogOfWar).toBe(true);
    expect(playlist.get2v2Config().fogOfWar).toBe(true);
  });
});
