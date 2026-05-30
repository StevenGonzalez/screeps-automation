# Expansion System _(planned)_

> **Status**: Planned. Remote mining (outriders + peddlers + heralds) is implemented; autonomous room claiming is not.

---

## What Exists: Remote Mining Pipeline

ARCA already exploits adjacent rooms without claiming them:

1. **Rangers** survey adjacent rooms and record source positions + hostile status
2. **Outriders** travel to remote rooms and mine sources into containers
3. **Peddlers** haul that energy back to the home colony
4. **Heralds** reserve the remote room controller, doubling source regen (3,000 → 6,000 per source)

This is the foundation the expansion system will build on.

---

## Planned: Autonomous Claiming

When a colony reaches "powerhouse" phase and GCL allows, ARCA will:

### 1. Target Selection
- Pull candidate rooms from the ranger scouting record
- Score rooms by: sources (weight 40), mineral presence (weight 20), proximity (weight 20), low threat (weight 20)
- Require: 2+ sources, no player owner, threat level < 3, within 5 rooms

### 2. Claiming
- Spawn a **conqueror** creep with `[CLAIM, MOVE, MOVE, MOVE, MOVE]`
- Conqueror travels to the target and calls `claimController()`

### 3. Bootstrapping
- Spawn 3 **settler** creeps (harvester + builder hybrid) to establish the spawn
- Once spawn is built, colony becomes autonomous and begins its own spawn loop

### 4. Progress Monitoring
- Track claiming status in `Memory.expansion`
- Abort and retry if conqueror dies or gets stuck
- Notify console when colony reaches self-sufficiency

---

## Planned: Console Commands _(planned)_

```javascript
Game.arca.expand()          // Show top expansion candidates from scout data
Game.arca.claim('W3N2')    // Manually trigger claim operation on a room
```

---

The kingdom of Lorencia expands — dungeon by dungeon, room by room.
