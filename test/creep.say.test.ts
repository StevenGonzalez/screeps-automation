import { describe, it, expect, vi } from "vitest";

// The townsfolk role pulls in services that extend game classes as they load.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  for (const name of ["Creep", "PowerCreep", "Room", "RoomPosition", "Structure"]) g[name] = class {};
});

import { FEAST_CALLS, PHASE_CALLS, SEASON_CALLS, STORM_CALLS } from "../src/roles/role.townsfolk";

describe("town calls", () => {
  it("fit in the 10 characters creep.say shows", () => {
    const lines = [
      ...Object.values(PHASE_CALLS).flat(),
      ...Object.values(SEASON_CALLS).flat(),
      ...STORM_CALLS,
      ...FEAST_CALLS,
    ];
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(10);
  });
});
