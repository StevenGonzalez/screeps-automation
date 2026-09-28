import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrateRoleNames } from "../src/services/services.rebrand";
import * as roles from "../src/config/config.roles";
import { ROLE_HAULER, ROLE_KNIGHT, ROLE_POWER_CARRIER } from "../src/config/config.roles";

const g = globalThis as Record<string, unknown>;

describe("migrateRoleNames", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("renames live corporate-era creeps and carries in-flight squad counts across", () => {
    g.Memory = {
      creeps: {
        a: { role: "courier" },
        b: { role: "hr" },
        c: { role: "treasury" },
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

  it("maps every corporate title onto a distinct current role", () => {
    const corporate = [
      "intern", "associate", "courier", "admin", "consultant", "facilities", "helpdesk",
      "procurement", "research", "recruiter", "freelancer", "logistics", "legal", "hr",
      "compliance", "wellness", "auditor", "pr", "regional", "onboarding", "downsizer",
      "benefits", "treasury", "offshore", "shipping", "security", "overtime", "payroll",
      "bizdev", "liquidator",
    ];
    g.Memory = { creeps: Object.fromEntries(corporate.map((r) => [r, { role: r }])) };

    migrateRoleNames();

    const current = Object.entries(roles)
      .filter(([k]) => k.startsWith("ROLE_"))
      .map(([, v]) => v);
    const migrated = corporate.map((r) => (g.Memory as any).creeps[r].role);
    expect(new Set(migrated).size).toBe(corporate.length);
    expect([...migrated].sort()).toEqual([...current].sort());
  });
});
