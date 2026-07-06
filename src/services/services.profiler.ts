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
