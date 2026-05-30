# Intelligence System

## Overview

ARCA gathers room intelligence through **ranger scouts** — lightweight creeps dispatched to survey adjacent rooms. Rangers record source positions and hostile status in the home room's memory, then return home.

A full Observer Network using RCL 8 Observer structures is planned but not yet implemented.

---

## Ranger Scouts (`role.scout.ts`)

### What They Do

1. Travel to `creep.memory.targetRoom`
2. Survey the room: count sources, detect hostiles and Source Keepers
3. Write results into `Memory.rooms[homeRoom].remoteRooms`
4. Remove the room from `homeRoomMemory.pendingScoutRooms`
5. Return home (or suicide if no path back)

### Hostile Detection

- **Source Keepers**: flagged but not treated as player-hostile — rangers note them for outriders to avoid
- **Player creeps**: any non-Source Keeper, non-Invader creep marks the room hostile for **2,000 ticks** (`hostileUntil`)
- Hostile rooms are skipped when selecting remote mining targets

### Memory Structure

```typescript
Memory.rooms[homeRoom].remoteRooms = [
  {
    roomName: string;
    sources: [{ sourceId: Id<Source>; containerId?: Id<StructureContainer> }];
    lastSeen: number;       // Game.time when last surveyed
    hostile: boolean;
    hostileUntil?: number;  // tick when hostile flag expires
  }
]
```

### Spawn Conditions

Rangers are spawned by `orchestrator.spawning.ts` when:
- A room is in `pendingScoutRooms` with no ranger already assigned to it
- The room is not already in `remoteRooms` (or hasn't been seen recently)

Body: `[MOVE]` — minimal cost, just needs to enter the room and read it.

---

## Remote Room Pipeline

```
pendingScoutRooms[] → ranger surveys → remoteRooms[]
                                              ↓
                               outriders mine sources
                               peddlers haul energy home
                               heralds reserve the controller
```

---

## Planned: Observer Network _(RCL 8)_

When an Observer structure is available, ARCA will scan rooms automatically without dispatching creeps:

- Scan adjacent and in-range rooms every 1,000 ticks
- Collect owner, RCL, tower count, hostile creeps, source count, mineral type
- Calculate expansion score and threat level
- Expose results via `Game.arca.intel()`, `Game.arca.expand()`, `Game.arca.threats()`

This replaces the ranger scouting pipeline for rooms within observer range (10 rooms).
