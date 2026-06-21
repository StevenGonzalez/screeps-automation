const EMA_ALPHA = 0.1;

interface CpuStat {
  ema: number;
  last: number;
  peak: number;
}

const stats: Record<string, CpuStat> = {};

export function recordCpu(name: string, used: number): void {
  const s = stats[name] ?? (stats[name] = { ema: used, last: used, peak: used });
  s.last = used;
  s.ema = s.ema * (1 - EMA_ALPHA) + used * EMA_ALPHA;
  if (used > s.peak) s.peak = used;
}

export function getCpuStats(): Record<string, CpuStat> {
  return stats;
}

// ── Per-role CPU accounting ───────────────────────────────────────────────────
//
// Optional, opt-in accounting of CPU spent per creep role, so the expensive role is
// visible alongside the per-system stats above. It is OFF the hot path: nothing here
// runs unless the dispatch loop chooses to call recordRole, and recordRole itself is a
// cheap map lookup + EMA update (the same shape as recordCpu) — no getUsed() of its own,
// so it costs nothing on ticks where it isn't called.
//
// WIRING (one-line hook, intentionally left for an out-of-scope file): the per-creep
// dispatch loop lives in src/orchestrators/orchestrator.creep.ts, which is out of scope
// for this change. To populate these stats, wrap each creep's role execution there with:
//     const t = Game.cpu.getUsed();
//     <run the creep's role>
//     recordRole(creep.memory.role, Game.cpu.getUsed() - t);
// Until that hook is added, getRoleStats() simply reports nothing — the API is harmless
// and inert when unused.

const roleStats: Record<string, CpuStat> = {};

export function recordRole(role: string, used: number): void {
  const s = roleStats[role] ?? (roleStats[role] = { ema: used, last: used, peak: used });
  s.last = used;
  s.ema = s.ema * (1 - EMA_ALPHA) + used * EMA_ALPHA;
  if (used > s.peak) s.peak = used;
}

export function getRoleStats(): Record<string, CpuStat> {
  return roleStats;
}

// Console-surfacing helper: log per-system and per-role CPU side by side, sorted by EMA
// so the heaviest entries come first. Call from the console (e.g. via a command) on
// demand — it's not wired into the loop so it never costs CPU unless invoked.
export function reportCpu(): void {
  const fmt = (label: string, table: Record<string, CpuStat>): void => {
    const rows = Object.entries(table).sort((a, b) => b[1].ema - a[1].ema);
    if (rows.length === 0) {
      console.log(`[CPU] ${label}: (no data)`);
      return;
    }
    console.log(`[CPU] ${label} (ema | last | peak):`);
    for (const [name, s] of rows) {
      console.log(
        `  ${name}: ${s.ema.toFixed(2)} | ${s.last.toFixed(2)} | ${s.peak.toFixed(2)}`
      );
    }
  };
  fmt("by system", stats);
  fmt("by role", roleStats);
}
