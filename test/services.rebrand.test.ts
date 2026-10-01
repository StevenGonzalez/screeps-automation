import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrateRoleNames } from "../src/services/services.rebrand";
import * as roles from "../src/config/config.roles";
import {
  ROLE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
} from "../src/config/config.roles";

const g = globalThis as Record<string, unknown>;

describe("migrateRoleNames", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("renames live creeps with MU class names and carries in-flight squad counts across", () => {
    g.Memory = {
      creeps: {
        a: { role: "wanderer" },
        b: { role: "fairyelf" },
        c: { role: "ragefighter" },
        d: { role: "blademaster" },
        e: { role: "museelf" },
        f: { role: "porter" },
      },
      militaryQueue: [{ requiredBiters: 4, requiredLickers: 2, requiredChewers: 1 }],
      defenseOps: { W1N1: { requiredBiters: 2, requiredSpitters: 1, requiredLickers: 1 } },
    };

    migrateRoleNames();

    const mem = g.Memory as any;
    expect(mem.creeps.a.role).toBe(ROLE_REMOTE_MINER);
    expect(mem.creeps.b.role).toBe(ROLE_CLERIC);
    expect(mem.creeps.c.role).toBe(ROLE_SIEGER);
    expect(mem.creeps.d.role).toBe(ROLE_POWER_ATTACKER);
    expect(mem.creeps.e.role).toBe(ROLE_POWER_HEALER);
    expect(mem.creeps.f.role).toBe(ROLE_HAULER);
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

  it("maps every dropped name onto a distinct current role", () => {
    const dropped = ["wanderer", "fairyelf", "ragefighter", "blademaster", "museelf"];
    g.Memory = { creeps: Object.fromEntries(dropped.map((r) => [r, { role: r }])) };

    migrateRoleNames();

    const current = new Set(
      Object.entries(roles)
        .filter(([k]) => k.startsWith("ROLE_") && k !== "ROLE_TITLES")
        .map(([, v]) => v)
    );
    const migrated = dropped.map((r) => (g.Memory as any).creeps[r].role);
    expect(new Set(migrated).size).toBe(dropped.length);
    for (const role of migrated) expect(current.has(role)).toBe(true);
  });
});
