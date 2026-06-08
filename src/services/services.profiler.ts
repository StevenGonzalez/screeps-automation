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
