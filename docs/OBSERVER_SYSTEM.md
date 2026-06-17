# Intelligence & Observer System

## Overview

Two separate things gather information here:

- **Ranger scouts** (`role.scout.ts`) survey adjacent rooms and record source
  positions + hostile status — the data the expansion and remote-mining systems
  rank candidates from.
- The **Observer** (`orchestrator.observer.ts`), at RCL 8, scans distant **highway**
  rooms looking for **power banks** and **deposits**, and also drives power-spawn
  processing.

Enemy-room threat scoring (`Memory.intel`, used for offensive targeting) is **not**
done here — it's gathered by the WarCouncil in `orchestrator.military.ts` from
rooms the bot can currently see (including rooms an observer just scanned). See
[MILITARY_GUIDE.md](MILITARY_GUIDE.md).

---

## Ranger Scouts (`role.scout.ts`)

### What They Do

1. Travel to `creep.memory.targetRoom`.
2. Survey the room: count sources, detect hostiles and Source Keepers.
3. Write results into `Memory.rooms[homeRoom].remoteRooms`.
4. Remove the room from `homeRoomMemory.pendingScoutRooms`.
5. Return home (or suicide if no path back).

### Hostile Detection

- **Source Keepers**: flagged but recorded so outriders avoid them.
- **Player creeps**: any non-Source-Keeper, non-Invader creep marks the room hostile
  for **2,000 ticks** (`hostileUntil`).
- Hostile rooms are skipped both when selecting remote-mining targets and when
  ranking expansion candidates.

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

Body: `[MOVE]` — minimal cost, just needs to enter and read the room.

---

## Remote Room Pipeline

```
pendingScoutRooms[] → ranger surveys → remoteRooms[]
                                              ↓
                               outriders mine sources
                               peddlers haul energy home
                               heralds reserve the controller
                               (expander ranks them as colony candidates)
```

### Invader contention

When an outrider/peddler sees an **Invader creep** in its remote it flags the room
(`invaderUntil`, 1,500 ticks) and waits at home; the spawner raises one knight
(`spawnRemoteDefender`) to clear it. The same flag is raised by an **Invader Core**
(`findInvaderCore`) — the NPC structure that reserves the room for "Invader" and
periodically re-spawns defenders. Because the core is a *structure*, the defending
knight engages hostile creeps first and then **attacks the core itself**; it only lifts
the flag once the room holds neither creeps nor a core. Without this the knight would
kill the spawned creeps, declare the room clear, and leave the core to re-reserve and
re-spawn indefinitely — the remote stays bricked. A **player** creep instead marks the
room hostile and we abandon it rather than send a lone knight.

---

## Observer (`orchestrator.observer.ts`, RCL 8)

When a room has an observer, each tick it scans the next highway room in a shuffled
queue (built within ~10 rooms of home). It also opportunistically checks any highway
room already in vision. The goal is **power banks**:

- A bank with ≥ 2,000 power and ≥ 3,000 ticks-to-decay spawns a `PowerBankOp`
  (`Memory.powerOps`), funded by the closest owned room, with a scaled squad
  (2 attackers / 3 healers / up to 6 carriers).
- The op runs through `forming → cracking → collecting → done` (see
  `Game.arca.power()` for status).

The same orchestrator also runs each room's **power spawn**: it calls
`processPower()` whenever the spawn holds power and ≥ 50 energy.

Highway-room detection is purely positional (a room whose X or Y coordinate is a
multiple of 10).

---

## Deposit Mining (`orchestrator.observer.ts`, RCL 8)

The same highway scan that hunts power banks also looks for **deposits** — the raw
highway resources (silicon / metal / biomass / mist) that the factory compresses into
tier-2 commodities (WIRE / CELL / ALLOY / CONDENSATE). Without this, those commodities
can only be made from market-bought raw materials. See [FACTORY_SYSTEM.md](FACTORY_SYSTEM.md).

- A fresh-ish deposit (`lastCooldown ≤ 100`) with ≥ 3,000 ticks-to-decay spawns a
  `DepositOp` (`Memory.depositOps`), funded by the closest owned room.
- **No combat squad** — deposits are unguarded, so the op is just miners + haulers
  (unlike the power-bank squad). One WORK-heavy **quarrier** works the deposit and one
  or two **carters** ferry the resource home to storage. A single big miner is used on
  purpose: harvesting triggers a *deposit-wide* cooldown, so one large body out-yields
  several small ones. The quarrier accumulates into its CARRY buffer and drops the load
  when full so harvesting never stalls; carters collect the dropped piles.
- The op runs `mining → done`. It ends when the deposit decays, when its harvest
  cooldown climbs past 100 (`DEPOSIT_MAX_COOLDOWN` — no longer worth hauling), or after
  a 20,000-tick hard timeout if it never makes contact. Check status with
  `Game.arca.deposits()`.

Deposits live in the same highway rooms as power banks, so they share the observer scan,
the closest-owned-room funding rule, and the positional highway detection.
