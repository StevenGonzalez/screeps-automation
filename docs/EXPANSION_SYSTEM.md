# Expansion System

> **Status**: Implemented. `orchestrators/orchestrator.expansion.ts` does GCL-driven
> autonomous claiming, drives the full bootstrap lifecycle, runs safety checks for
> contested rooms, and manages a multi-target expansion **queue**. Remote mining
> (stringers + mules + collectors) feeds the candidate data.

---

## Remote Mining Pipeline (the foundation)

The bot exploits adjacent rooms without claiming them, and the scout data this
produces is exactly what the expander ranks candidates from:

1. **Lookouts** survey adjacent rooms and record source positions + hostile status
   into `Memory.rooms[home].remoteRooms`.
2. **Stringers** travel to remote rooms and mine sources into containers.
3. **Mules** haul that energy back to the home colony.
4. **Collectors** reserve the remote controller, doubling source regen.

---

## Autonomous Claiming

Two ways an expansion starts:
- **Auto** (`Memory.autoExpand`, toggled by `Game.arca.autoexpand(true)`,
  **off by default**): every 50 ticks the orchestrator ranks scouted candidates and
  enqueues the best ones whose funding room is healthy, up to GCL headroom and a
  max queue depth of 3.
- **Manual**: `Game.arca.claim('W5N5')` sets the active expansion directly, or
  `Game.arca.queueExpand('W5N5')` lines one up in the queue.

Either way the lifecycle below runs every tick, so a manual claim finishes
correctly too.

### Candidate ranking

`rankExpansionCandidates()` scores each non-owned, non-contested scouted remote:

```
score = sources × 40 − distance × 5
```

Contested rooms are skipped — both from scout data (`hostile` / `hostileUntil`
flags) and from a live check (owned/reserved by another player, or hostiles
present right now).

### Funding-home gate

A room may only seed a colony when it is healthy:
- RCL ≥ 4 (storage + ≥1300 energy capacity),
- storage energy ≥ 50,000,
- not itself under threat.

The CPU bucket must also be ≥ 5,000 before a multi-hundred-tick op starts.

### Phases (`Memory.expansion`)

`claiming → bootstrapping → established`

1. **Claiming** — a **capo** travels to the target and claims the controller.
   Aborts cleanly if the room turns out to be owned by another player or fresh
   scout intel flags it hostile.
2. **Bootstrapping** — **transplants** establish the spawn and economy. During this
   phase the orchestrator:
   - **Pauses** transplant spawning for ~200 ticks and flags `needsDefender` if the
     child room is invaded (transplants retreat; a home spawn rule raises a defender).
   - **Times out** after 6,000 ticks if the bootstrap never completes.
3. **Established** — declared self-sufficient (see completion criteria), kept around
   ~1,000 ticks for inspection, then cleared so the next queued target can start.

### Bootstrap-completion criteria

A child room becomes **established** only when **all** of these hold (checked while
the room is visible):

1. We own its controller.
2. It has at least one **built** own spawn (not just a construction site).
3. Controller RCL ≥ 3.
4. Its economy can sustain itself: a working digger + hauler pair native to the
   room, **or** its own storage holds ≥ 10,000 energy.

---

## Expansion Queue (multi-target pipeline)

Only **one** expansion is active at a time. The queue (`Memory.expansionQueue`)
holds further targets and auto-advances: when the active expansion completes or
aborts, the next viable queued target begins claiming — no further console input
needed. The advance step skips already-owned or contested entries and any target
with no healthy funding room (re-queuing it to try later).

---

## Console Commands

```javascript
Game.arca.expand()                  // show ranked candidates from scout data
Game.arca.claim('W5N5')             // claim now (closest healthy home funds it)
Game.arca.queueExpand('W5N5')       // add to the expansion pipeline
Game.arca.queueExpand('W5N5','W1N1')// ...preferring a specific funding home
Game.arca.dequeueExpand('W5N5')     // remove a queued target
Game.arca.autoexpand(true)          // toggle / inspect auto-expansion
Game.arca.status()                  // active expansion + the queued pipeline
Game.arca.cancel()                  // abort the active expansion
Game.arca.ops()                     // overview of all pipelines (expansion + offensive + SK)
```

The family's territory grows — block by block, room by room.
