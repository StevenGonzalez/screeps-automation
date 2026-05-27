# CPU Optimization

## Overview

ARCA manages CPU budget in `src/main.ts` using a simple threshold system. There are no external caching or profiling utilities — the orchestrators handle their own efficiency.

## Tick Budget System

Each tick, `main.ts` measures CPU consumed after the core systems run and skips expensive-but-optional systems when load is high.

```
CPU_WARN_THRESHOLD        = 0.85   (85%) — log a warning to console
CPU_SKIP_STRUCTURES_THRESHOLD = 0.70   (70%) — skip structure planner
CPU_SKIP_VISUALS_THRESHOLD    = 0.60   (60%) — skip room visuals
CPU_BUCKET_CRITICAL           = 2000  — skip non-core when bucket is depleted
```

### Execution Order

```
memory  → always runs
creeps  → always runs
spawning → always runs
--- CPU check: if <70% and bucket OK ---
structures → may skip (pathfinding-heavy)
links   → always runs
towers  → always runs
terminal → always runs
pixels  → always runs
--- CPU check: if <60% and bucket OK ---
visuals → may skip (cosmetic)
```

### High-CPU Warning

If total tick CPU exceeds 85% of `Game.cpu.limit`, a warning is printed:

```
[CPU] High usage: 17.3/20 (87%) bucket=9500
```

### Periodic Report

Every 100 ticks, a summary line is printed regardless of CPU level:

```
[CPU] tick=45200 used=12.4 limit=20 bucket=10000 creeps=31
```

## Error Isolation

Each orchestrator is wrapped in `runSafe()`, which catches and logs exceptions without crashing the tick:

```
[ERROR] System "spawning" threw: Cannot read properties of undefined...
```

This prevents a single bad orchestrator from taking down the entire loop.

## Optimization Tips

1. **Check the bucket** — `Game.cpu.bucket` in the periodic report indicates sustained load. A falling bucket means you're consistently over limit.
2. **Structure planning is the heaviest** — it runs road pathfinding. If CPU is tight, it's the first thing dropped.
3. **Visuals are free to skip** — they're cosmetic and have no gameplay effect.
4. **reusePath** — all creep movement uses `reusePath: 30–50` to avoid recalculating paths every tick.
5. **Memory caching** — source IDs, container IDs, and remote room data are stored in `Memory.rooms` so live `room.find()` calls are minimized.
