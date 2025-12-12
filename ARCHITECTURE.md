# Screeps Automation — Architecture

## Overview

This document captures a high-quality, CPU-conscious architecture for a TypeScript Screeps project focused on reuse, economy, and tactical defense. Key goals:

- Keep CPU usage low by using a memory-backed persistence layer and tick-spreading.
- Maximize code reuse: behavior primitives composed into roles.
- Automated, deterministic structure layouts with defensive considerations.
- Modular, testable design with clear responsibilities per module.

## Project Layout (recommended)

- `src/`
  - `main.ts` — entrypoint; minimal, calls `Kernel.tick()`.
  - `kernel/`
    - `kernel.ts` — per-tick orchestrator (initialization, job scheduling, flushes).
    - `scheduler.ts` — schedules background jobs across ticks.
  - `memory/`
    - `memoryManager.ts` — cache, batched writes, segment helpers.
    - `types.ts` — typed Memory interfaces (augment global Memory types here).
  - `creeps/`
    - `role.ts` — role interface & runner types.
    - `behaviors/` — small stateless behavior primitives (moveToSafe, harvest, withdraw, build, repair, etc.).
    - `roles/` — composed roles: `harvester.ts`, `builder.ts`, `upgrader.ts`, `porter.ts`, `claimer.ts`.
  - `structures/`
    - `planner.ts` — deterministic layout generator and placement logic.
    - `builder.ts` — builder that applies layout via a Memory-backed build queue.
  - `spawning/`
    - `spawnManager.ts` — spawn queue, population targets, priority handling.
    - `bodyFactory.ts` — energy-aware body composer for roles.
  - `economy/`
    - `logistics.ts` — hauling pipelines, link/terminal helpers.
    - `market.ts` — market-related heuristics/usage.
  - `utils/`
    - `profiler.ts`, `metrics.ts`, `constants.ts`, `vec2.ts`, `pathCache.ts`.
  - `tests/` — pure logic tests (layout generator, bodyFactory) using `vitest` or `jest`.

Keep each module small and single-responsibility. Wrap filesystem/build config in `rollup.config.js`, `tsconfig.json`, `screeps.json` for deploy.

## Core Components

- MemoryManager: authoritative Memory API (cache + batched writes).
- Kernel: per-tick lifecycle manager calling subsystems in deterministic order.
- Scheduler: background job spreader to avoid CPU spikes.
- Roles + Behavior primitives: small reusable functions composed into role runners.
- SpawnManager + BodyFactory: energy-aware spawning logic with queue and emergency fallbacks.
- StructurePlanner + Builder: deterministic layout generation and queued construction.
- Economy manager: per-room accounting, remote assignments, link/terminal pipelines.

## MemoryManager (Persistence Layer)

Purpose: minimize CPU and serialization cost by caching reads and batching writes. Treat `Memory` as persistence; update it in controlled batches.

Design principles:

- Read-through cache: first read loads into `MemoryManager`'s tick cache; subsequent reads are cheap.
- Dirty-tracking: `set` or `update` marks keys as dirty; at end-of-tick `flush()` writes only dirty keys.
- Shallow updates: avoid reserializing/rewriting huge objects; store per-entity small records.
- Segments: use `RawMemory.segments` (or `Memory.segments`) for large or rarely changing data like layout maps; compress if needed.
- TTL / versioning: store generatedAt/version so stale layouts can be regenerated.

API surface (suggested):

- `get<T>(path: string, fallback?: T): T`
- `set<T>(path: string, value: T): void` (marks dirty)
- `update<T>(path: string, mutator: (curr: T | undefined) => T): void`
- `flush(): void` — called once per tick by `Kernel` to push dirty entries to `Memory`.
- `readSegment(id: number): any` / `writeSegment(id: number, data: any): void` — helpers for large payloads.

Implementation notes:

- Represent keys as dotted paths, isolating subsystems, e.g. `rooms.W1N1.planner`.
- Cache only on-demand; avoid preloading entire Memory.
- Delay low-priority writes (e.g., stats) using `scheduleSave(path, delay)` when appropriate.

## Creep Behavior System

Design goals:

- Maximize reuse: implement small behavior primitives and compose them.
- Keep `creep.memory` minimal; rely on `MemoryManager` for cross-tick persistence.
- Use a Task or FSM model for complex sequences; prefer a task queue per creep when needed.

Patterns:

- Behavior primitives: pure or side-effect-limited functions returning status `{ done: boolean, target?: Id }`.
- Roles: small coordinator functions `run(creep: Creep, ctx: RoleContext)` that request tasks or compose behaviors.
- TaskManager: optional centralized manager assigning room-level tasks: `repair`, `build`, `transfer`, `upgrade`.
- Priority-based decisions: numeric priorities to pick what to do next.

Example flow for `harvester` role:

1. Rehydrate lightweight state from `creep.memory` using `MemoryManager` helpers.
2. If assigned source has a container, withdraw/transfer tasks are used; otherwise harvest directly.
3. When full, choose `deliver` target (container/storage/terminal) based on `RoomEconomy` priorities.
4. If no high priority tasks, help with construction/repair using Behavior primitives.

Keep each behavior small so it can be reused by `porter`, `builder`, `upgrader`, etc.

## SpawnManager & BodyFactory

- `SpawnManager` maintains desired counts per role with dynamic scaling by available energy and priority.
- `BodyFactory` composes the best body given available energy and role constraints; returns an ordered `BodyPartConstant[]` and energy cost.
- Maintain a spawn queue stored via `MemoryManager` and processed each tick; use emergency cheap-body fallbacks when spawn backlog exists.

Rules:

- Always ensure at least one emergency harvester (cheap body) if energy collection is at risk.
- Reserve some CPU/energy margin for emergency spawns when `Game.cpu.bucket` is low.

## Structure Planner & Auto-Placement

Goals:

- Deterministic layout generation based on `anchor`, `roomName`, and `controller.level`.
- Defense-first: overlapping tower coverage, layered ramparts, chokepoint-aware walls.
- Economy-aware: minimal hauling distance, link placement near miners, clustered extensions.

Planner responsibilities:

- Compute `anchor` (center of base) and zone masks: `core`, `extensions`, `sources`, `remotes`.
- Place core assets: `storage`, `spawn(s)`, `terminal`, `lab(s)`, `link(s)`.
- Plan extension clusters: grouped in compact blocks to minimize roads.
- Plan towers: place towers with overlapping coverage; avoid single-point-of-failure placement.
- Plan ramparts/walls with rings (inner for critical assets, outer for extension clusters).
- Generate road graph connecting sources, controller, storage, spawns, exits.

Builder responsibilities:

- Convert layout plan to a prioritized `buildQueue` stored in `MemoryManager`.
- Spread construction site creation across ticks using `Scheduler` to avoid CPU spikes and the construction site cap.
- Re-check planner on RCL up or when anchor changes.

Tactical defense details:

- Towers placed with overlapping ranges so single tower loss doesn't remove all defensive coverage.
- Keep critical assets behind ramparts; place spawn and storage in such a way that ramparts can be prioritized for repairs.
- Use chokepoint detection to concentrate walls where invaders will funnel.

## Economy & Logistics

- Track energy inflows/outflows in `RoomEconomy` (Memory-backed) for smarter spawn/body decisions.
- Link & terminal placement: place links at miners and near storage to reduce hauling.
- Remote mining: `RemoteManager` assigns remote sources and spawns porters only as needed; account for travel and bucket gains.
- Market usage: basic heuristics for selling surplus and buying rare resources.

## CPU & Performance Strategies

- Scheduler: `schedule(jobId, fn, interval)` to run heavy tasks every N ticks.
- CPU-aware throttling: when `Game.cpu.bucket` low, reduce frequency of non-critical jobs (e.g., layout recompute, market decisions).
- Cache paths and destinations; use `PathFinder.search` with tuned options.
- Path caching with TTL stored in segments or memory to avoid re-computation.
- Use `screeps-profiler` or an integrated lightweight profiler to measure per-role CPU and prioritize optimization.

## Testing, Tooling & Deployment

- TypeScript `strict` mode on; keep types in `src/memory/types.ts` and augment the global `Memory` interface.
- Lint with `ESLint` and format with `Prettier`.
- Unit tests for pure logic (layout generator, bodyFactory) with `vitest` or `jest`.
- Use `rollup` for bundling (see `rollup.config.js`).
- Deploy with `screeps` npm tool or CI-run `npm run deploy` which calls `rollup` and `screeps`.

## Next Steps & Scaffolding Options

Pick one of the following and I will scaffold it next:

- Option A — `MemoryManager` scaffold + unit tests (recommended): includes `src/memory/memoryManager.ts` and `src/memory/types.ts` with sample tests.
- Option B — `harvester` role + `BodyFactory` scaffold: example `src/creeps/roles/harvester.ts` plus `src/spawning/bodyFactory.ts`.
- Option C — `StructurePlanner` prototype for a single room: `src/structures/planner.ts` with deterministic layout generation for a given anchor.

## Example snippets & API references

MemoryManager usage example:

```ts
// read
const roomPlan = MemoryManager.get('rooms.' + room.name + '.plan', null);

// update
MemoryManager.update('rooms.' + room.name + '.plan', (p) => {
  p = p || {};
  p.generatedAt = Game.time;
  return p;
});

// flush called by Kernel at end of tick
MemoryManager.flush();
```

Role runner example pattern (pseudocode):

```ts
export function run(creep: Creep, ctx: RoleContext) {
  const task = TaskManager.getTaskFor(creep) ?? assignDefaultTask(creep, ctx);
  const result = performTask(creep, task);
  if (result.done) TaskManager.complete(task);
}
```

StructurePlanner flow (high level):

1. Compute anchor and accessible tiles.
2. Generate zones (core, ext clusters, sources).
3. Place critical assets and towers with overlapping coverage.
4. Generate road graph and rampart rings.
5. Persist layout to `MemoryManager` (segment or room memory) with `generatedAt`.

## Maintenance & Evolution

- Keep behaviors tiny and well-tested. Replace policy decisions in higher-level managers, not in behavior primitives.
- When optimizing CPU, profile first. Target high-cost roles or frequent operations.
- Keep layout generator deterministic and versioned so you can migrate stored layouts safely.

---

If you want, I can now scaffold the `MemoryManager` (Option A) into `src/memory/memoryManager.ts` and add a small unit test. Which option should I implement next?

## Current Implementations (repo)

This project already includes a number of concrete implementations that follow the architecture above. Use this section as a quick map to the code and as a place to find tunable thresholds.

- **MemoryManager**: `src/memory/memoryManager.ts`
  - Read-through cache, dirty-tracking, `reset()`, `flush()` lifecycle.
  - Helpers: `get`, `set`, `update`, `has`, `remove`, `scheduleSave(path, delayTicks)`.
  - Segment helpers: `readSegment(id)` / `writeSegment(id, data)` use `RawMemory.segments`.

- **Kernel & Scheduler**: `src/kernel/kernel.ts`, `src/kernel/scheduler.ts`
  - `Kernel.tick()` lifecycle: `MemoryManager.reset()` → run subsystems → `Scheduler.run()` → `MemoryManager.flush()`.
  - A diagnostics job is scheduled to log per-room spawn queue and creep counts every 100 ticks.

- **SpawnManager & Spawn Queue**: `src/spawning/spawnManager.ts`
  - Memory-backed queue at `rooms.<room>.spawnQueue`.
  - Spawn request shape: `{ role, body?, priority?, requestedAt, fallbackAfter? }`.
  - Queue processing sorts by `priority` then age. If a request is older than `fallbackAfter` and energy is insufficient, an emergency cheaper body is attempted.
  - Emergency immediate spawn for harvesters if no harvesters exist and queue is empty.
  - Auto-enqueue logic for `upgrader` role in early RCL rooms (works without storage):
    - If `room.energyCapacityAvailable >= 300` enqueue 1 upgrader; if >= 550 enqueue 2 (tunable thresholds in `spawnManager`).

- **BodyFactory**: `src/spawning/bodyFactory.ts`
  - Pattern-based body composition with programmatic part costs.
  - Harvester pattern: `[WORK, WORK, CARRY, MOVE]` repeated to fit energy and part limits.
  - Upgrader pattern: `[WORK, CARRY, MOVE]` repeated.
  - Provides sensible fallbacks when energy is very low.

- **Creeps & Behaviors**
  - `src/creeps/behaviors/energy.ts`: `acquireEnergy(creep, opts)` used by multiple roles.
    - Priority: pickup dropped energy → withdraw from structures → harvest assigned/nearest source.
  - `src/creeps/sourceManager.ts`: assigns sources to creeps and persists assignments in room memory.

- **Roles**
  - `src/creeps/roles/harvester.ts`: uses `acquireEnergy(..., { preferHarvest: true })`; delivers energy (transfer to spawn/storage/or controller fallback).
  - `src/creeps/roles/upgrader.ts`: uses `acquireEnergy(..., { preferHarvest: false })`; upgrades controller.
  - `src/creeps/creepManager.ts`: dispatches creeps to roles each tick.

- **Structure Automation**: `src/structures/`
  - **StructureManager**: `src/structures/structureManager.ts`
    - Orchestrates all automated structure planning and building systems.
    - Runs every tick, managing road planning and construction for all owned rooms.
    - Extensible design for future structure types (towers, extensions, walls, ramparts).
  
  - **RoadPlanner**: `src/structures/roadPlanner.ts`
    - Generates optimal road networks connecting spawn → sources → controller.
    - Uses `PathFinder.search` with intelligent cost matrices:
      - Existing roads cost 1 (encourages reuse).
      - Plains cost 2, swamps cost 10 (optimizes for natural terrain).
      - Structures (except roads/containers) cost 255 (avoids blocking).
    - Generates pairwise paths between all key locations to create an efficient mesh network.
    - Plans are cached in Memory at `rooms.<room>.roadPlan` and invalidated on RCL changes.
    - Filters out positions that already have non-road structures to prevent conflicts.
  
  - **RoadBuilder**: `src/structures/roadBuilder.ts`
    - Executes road plans by creating construction sites incrementally.
    - Build throttling: creates max 5 construction sites per check interval (every 10 ticks).
    - Automatic cleanup (every 50 ticks):
      - Destroys roads under non-road structures (spawn, extensions, towers, etc.).
      - Removes obsolete roads not in current plan (unless within 3 tiles of key locations).
      - Cancels road construction sites blocked by other structures.
    - Maintains build state per room in Memory at `rooms.<room>.roadBuildState`.

  - **RampartPlanner**: `src/structures/rampartPlanner.ts`
    - Identifies critical structures requiring rampart protection based on priority system.
    - Protection priorities (highest to lowest):
      1. Spawns (always protected)
      2. Storage and Terminal (critical economy)
      3. Towers (defensive structures)
      4. Links (RCL 5+)
      5. Labs (RCL 6+)
      6. Extensions (RCL 7+ and >20 extensions)
    - Plans cached in Memory at `rooms.<room>.rampartPlan` and invalidated on RCL changes or after 1000 ticks.
    - Returns position strings for rampart placement on top of existing structures.
  
  - **RampartBuilder**: `src/structures/rampartBuilder.ts`
    - Executes rampart plans by creating construction sites incrementally.
    - Build throttling: creates max 3 rampart sites per check interval (every 20 ticks).
    - Automatic cleanup (every 100 ticks):
      - Destroys ramparts not in current plan (if no important structure underneath).
      - Cancels obsolete rampart construction sites.
    - Maintains build state per room in Memory at `rooms.<room>.rampartBuildState`.
    - Respects game construction site limits to avoid errors.

  **Design philosophy**:
  - CPU-conscious: spreads construction site creation across ticks to avoid spikes.
  - Self-healing: automatically adapts to structure placement and removes conflicts.
  - Memory-efficient: only stores position strings and minimal state per room.
  - Extensible: StructureManager designed to add more structure types as needed.

  **Future extensions** (architecture ready):
  - Wall ring generation for perimeter defense.
  - Advanced rampart layering (inner/outer rings).
  - Chokepoint detection and wall placement optimization.

## Tuning & Where To Change

- Spawn tuning and role thresholds: `src/spawning/spawnManager.ts` and `src/config.ts`.
- Body composition patterns: `src/spawning/bodyFactory.ts`.
- Energy acquisition behavior: `src/creeps/behaviors/energy.ts` and source assignment in `src/creeps/sourceManager.ts`.
- Memory persistence behavior and delayed writes: `src/memory/memoryManager.ts`.
- Road planning intervals and construction throttling: `src/structures/roadBuilder.ts` (`BUILD_CHECK_INTERVAL`, `CLEANUP_CHECK_INTERVAL`, `MAX_SITES_PER_TICK`).
- PathFinder cost tuning: `src/structures/roadPlanner.ts` (`plainCost`, `swampCost` in `findOptimalPath`).
- Rampart protection priorities and RCL thresholds: `src/structures/rampartPlanner.ts` (extension protection starts at RCL 7, labs at RCL 6).
- Rampart build throttling: `src/structures/rampartBuilder.ts` (`BUILD_CHECK_INTERVAL=20`, `MAX_SITES_PER_CHECK=3`, `CLEANUP_CHECK_INTERVAL=100`).

If you want, I can (A) extract delivery behavior to `creeps/behaviors/deliver.ts`, (B) write unit tests for `bodyFactory`, or (C) add tower/extension placement logic to structure automation. Which would you prefer? 
