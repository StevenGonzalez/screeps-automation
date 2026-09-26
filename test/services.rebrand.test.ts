import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrateRoleNames } from "../src/services/services.rebrand";
import { ROLE_HAULER, ROLE_KNIGHT, ROLE_POWER_CARRIER } from "../src/config/config.roles";

const g = globalThis as Record<string, unknown>;

describe("migrateRoleNames", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("renames live bug-era creeps and carries in-flight squad counts across", () => {
    g.Memory = {
      creeps: {
        a: { role: "dragger" },
        b: { role: "biter" },
        c: { role: "lugger" },
      },
      militaryQueue: [{ requiredBiters: 4, requiredLickers: 2, requiredChewers: 1 }],
      defenseOps: { W1N1: { requiredBiters: 2, requiredSpitters: 1, requiredLickers: 1 } },
    };

    migrateRoleNames();

    const mem = g.Memory as any;
    expect(mem.creeps.a.role).toBe(ROLE_HAULER);
    expect(mem.creeps.b.role).toBe(ROLE_KNIGHT);
    expect(mem.creeps.c.role).toBe(ROLE_POWER_CARRIER);
    expect(mem.militaryQueue[0]).toEqual({ requiredMelee: 4, requiredHealers: 2, requiredSiege: 1 });
    expect(mem.defenseOps.W1N1).toEqual({ requiredMelee: 2, requiredRanged: 1, requiredHealers: 1 });
  });

  it("runs once per theme, so a creep spawned under the new theme is left alone", () => {
    g.Memory = { creeps: {} };
    migrateRoleNames();

    (g.Memory as any).creeps.x = { role: ROLE_HAULER };
    migrateRoleNames();

    expect((g.Memory as any).creeps.x.role).toBe(ROLE_HAULER);
  });
});
