# Autonomous Expansion System

## Overview

The **Reclaimation Council** provides fully automated colony expansion. When conditions are met, the system identifies optimal expansion targets, spawns claim/pioneer creeps, and bootstraps new colonies to become self-sufficient.

## Features

### 🎯 Intelligent Target Selection
- **Observer Integration**: Uses intel from ObserverNetwork to find viable rooms
- **Multi-Factor Scoring**: Evaluates sources, minerals, distance, and threats
- **Economic Readiness**: Only expands when parent colony is strong enough
- **GCL Management**: Respects Global Control Level limitations

### 🚀 Automated Claiming
- **Claimer Spawning**: Automatically spawns claimer creeps from nearest colony
- **Pioneer Deployment**: Sends 3 pioneer creeps to bootstrap infrastructure
- **Progress Monitoring**: Tracks expansion status and handles failures

### 🏗️ Colony Bootstrapping
- **Phase 1 - Claiming**: Claimer moves to target room and claims controller
- **Phase 2 - Infrastructure**: Pioneers build spawn, container, extensions
- **Phase 3 - Self-Sufficiency**: Once spawn is built, colony becomes autonomous

---

## How It Works

### 1. Expansion Evaluation (Every 1000 Ticks)

The system checks if expansion is viable:

```typescript
Conditions:
✓ No current expansion in progress
✓ GCL level supports more colonies
✓ At least one colony at RCL 5+
✓ At least one colony with 20k+ energy
```

### 2. Target Scoring Algorithm

Each candidate room is scored (0-100):

```typescript
Score Calculation:
+ 40 points: 2+ sources (essential)
+ 10 points: 1 source (poor)
+ 15-20 points: Valuable mineral (Catalyst = 20, others = 15)
+ 20 points: Adjacent to colony (distance 1)
+ 10 points: Close to colony (distance 2)
- 20 points: Too far (distance 5+)
- 5 per threat level: Dangerous rooms penalized
```

**Minimum Viable Score**: 50/100

### 3. Pioneer Lifecycle

**Claimer Creep** (Body: `[CLAIM, MOVE]`)
- Priority: 100 (highest)
- Task: Move to target room and claim controller
- Lifespan: 600 ticks (enough to reach and claim)

**Pioneer Creeps** (Body: `[WORK, CARRY, MOVE] x N`)
- Priority: 100 (highest)
- Count: 3 builders
- Max Cost: 1000 energy
- Tasks:
  1. Claim phase: Help claimer reach room
  2. Bootstrap phase: Build spawn, container, extensions
  3. Upgrade controller until spawn completes

### 4. Infrastructure Build Order

1. **Spawn** (priority 1) - Place near controller
2. **Container** (priority 2) - Place adjacent to source
3. **Extensions** (priority 3) - Place near spawn
4. **Controller Upgrade** (priority 4) - Continuous until spawn ready

---

## Expansion States

| State | Description | Duration |
|-------|-------------|----------|
| **Evaluating** | Scoring potential targets | 1000 ticks |
| **Claiming** | Claimer en route | ~50-500 ticks |
| **Bootstrapping** | Building spawn + infrastructure | ~5000-15000 ticks |
| **Established** | Spawn built, colony autonomous | Permanent |

**Timeout**: 50,000 ticks (expansion abandoned if not completed)

---

## Console Commands

### View Expansion Status
```javascript
Game.cov.expansion()
```

**Output:**
```
═══════════════════════════════════════════════════════
🚀 EXPANSION STATUS
═══════════════════════════════════════════════════════

📍 Current Target: W5N2
   Status: bootstrapping
   Score: 75/100
   Sources: 2
   Mineral: U
   Distance: 1 rooms
   Claiming from: W5N1
   Started: 5432 ticks ago

📜 Expansion History:
✅ W4N1 (25000 ticks ago)
✅ W6N1 (50000 ticks ago)
═══════════════════════════════════════════════════════
```

### Cancel Expansion
```javascript
Game.cov.cancelExpansion()
```

Immediately stops current expansion and allows system to evaluate new targets.

---

## Integration

### With Observer Network
```typescript
// Observer scans rooms → stores intel in Memory.intel
observerNetwork.getExpansionCandidates()
// → Returns unclaimed rooms with 2+ sources

// Reclaimation Council evaluates these candidates
reclaimationCouncil.run()
// → Scores and selects best target
```

### With HighCharity
```typescript
// Each HighCharity checks for expansion commands
buildPioneerArbiters()
// → If colony is nearest to target, spawn pioneers

// Pioneers coordinate through PioneerArbiter
pioneerArbiter.run()
// → Claim room, build infrastructure, upgrade controller
```

### With CommandTemple
```typescript
// Spawn queue prioritizes pioneers
priority: 100  // Highest priority
// Expansion creeps spawn before all others
```

---

## Configuration

### Economic Thresholds

Edit `ReclaimationCouncil.ts`:

```typescript
// Minimum colony strength
hasStrongColony: RCL 5+

// Minimum energy reserves
hasEnergy: 20,000 stored energy

// Maximum simultaneous expansions
maxExpansions: 1
```

### Scoring Weights

Edit `scoreExpansionTarget()`:

```typescript
// Adjust scoring priorities
sources >= 2: 40 points
mineral type: 10-20 points
distance: 10-20 points (closer better)
threat penalty: -5 per threat level
```

### Pioneer Configuration

Edit `PioneerArbiter.ts`:

```typescript
// Pioneer count
maxPioneers: 3

// Body cost cap
maxCost: 1000 energy

// Build priorities
1. STRUCTURE_SPAWN
2. STRUCTURE_CONTAINER
3. STRUCTURE_EXTENSION
```

---

## Decision Flow

```
┌─────────────────────────────────────────┐
│    Expansion Evaluation (1000 ticks)    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │  Conditions Met?     │
        │  ✓ GCL available     │
        │  ✓ RCL 5+ colony     │
        │  ✓ 20k+ energy       │
        └─────────┬────────────┘
                  │ YES
                  ▼
        ┌─────────────────────┐
        │ Get Candidates from  │
        │  Observer Network    │
        └─────────┬────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │  Score Each Room     │
        │  (0-100 algorithm)   │
        └─────────┬────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │   Best Score ≥ 50?   │
        └─────────┬────────────┘
                  │ YES
                  ▼
        ┌─────────────────────┐
        │ Initiate Expansion   │
        │  Set target active   │
        └─────────┬────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │  Nearest Colony      │
        │  Spawns Pioneers     │
        └─────────┬────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │  Claiming Phase               │
   │  - Claimer moves to room      │
   │  - Claims controller          │
   └──────────────┬────────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │  Bootstrap Phase              │
   │  - Build spawn                │
   │  - Build container            │
   │  - Build extensions           │
   │  - Upgrade controller         │
   └──────────────┬────────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │  Established                  │
   │  - Spawn operational          │
   │  - Colony self-sufficient     │
   │  - Clear expansion target     │
   └───────────────────────────────┘
```

---

## Best Practices

### 1. Prepare Parent Colony
- Reach RCL 5+ before expanding
- Accumulate 50k+ energy for safety
- Ensure stable remote mining income

### 2. Scout Ahead
- Use observers to scan potential targets
- Wait 1000+ ticks for full intel
- Check threat levels manually if concerned

### 3. Monitor Progress
- Check `Game.cov.expansion()` regularly
- Watch for timeout warnings
- Cancel stalled expansions manually if needed

### 4. Protect New Colonies
- Remote rooms adjacent to new colony are prioritized
- Keep energy flowing from parent colony initially
- Consider placing ramparts early if threats appear

---

## Troubleshooting

### Expansion Not Starting

**Check:**
- `Game.cov.expansion()` - View conditions
- `Game.gcl.level` - Do you have GCL capacity?
- `Game.cov.intel()` - Are rooms being scanned?
- Storage energy - Is it above 20k?

**Solution:**
```javascript
// Force re-evaluation
Memory.expansion.lastEvaluation = 0;
```

### Pioneers Not Spawning

**Check:**
- Is nearest colony the one you expect?
- Check spawn queue with spawn visuals
- Verify pioneer priority (should be 100)

**Solution:**
```javascript
// Check which colony should spawn
const target = Game.cov.expansion().currentTarget;
console.log(target.claimingFrom); // Should be nearest colony
```

### Bootstrap Stalled

**Check:**
- Are pioneers alive? Check creep count
- Is room accessible? Check pathing
- Are construction sites placed?

**Solution:**
```javascript
// Cancel and retry
Game.cov.cancelExpansion();
// System will re-evaluate in 1000 ticks
```

### Room Claimed But No Progress

**Check:**
- Do pioneers have WORK parts?
- Is source accessible?
- Are hostiles blocking?

**Solution:**
```javascript
// Manually spawn more pioneers from nearest colony
// Use console to check room visuals
```

---

## Performance

- **CPU Impact**: ~0.2 CPU per 1000 ticks (evaluation only)
- **Active Expansion**: ~1-2 CPU per tick (3 pioneers + 1 claimer)
- **Memory Usage**: ~500 bytes per expansion target
- **Timeout**: 50,000 ticks maximum per expansion

---

## Future Enhancements

- [ ] Multi-room expansions (claim 2+ rooms simultaneously)
- [ ] Highway room claiming (for thoroughfares)
- [ ] Ally coordination (expand together)
- [ ] Defensive expansions (claim to block enemies)
- [ ] Automatic room abandonment (if unprofitable)
- [ ] Re-claim fallen colonies automatically

---

## Example Expansion

```
Tick 1000: Evaluation triggers
  ✓ GCL 2/3 (can expand)
  ✓ W5N1 at RCL 6 (parent colony strong)
  ✓ 45000 energy stored (sufficient)

Tick 1001: Target selected
  → W5N2 scored 75/100
  → 2 sources, Catalyst mineral, 1 room away, threat 0

Tick 1002-1005: Spawning
  → W5N1 spawns claimer "Claimer_W5N2_002"
  → W5N1 spawns pioneers (queued)

Tick 1050: Claimer arrives
  → Claims W5N2 controller
  → Status: "claiming" → "bootstrapping"

Tick 1100: Pioneers arrive
  → Begin harvesting from sources
  → Place spawn construction site

Tick 5000: Spawn progressing
  → 80% complete (40000/50000 progress)
  → Container built, 5 extensions up

Tick 7500: Spawn complete!
  → Status: "bootstrapping" → "established"
  → W5N2 now autonomous
  → Expansion history updated: ✅ W5N2

Tick 8500: Next evaluation
  → System ready for another expansion
```

---

## Console Integration

Add to your Screeps console shortcuts:

```javascript
// Quick status
alias exp="Game.cov.expansion()"

// Cancel expansion
alias cancel="Game.cov.cancelExpansion()"

// View candidates
alias targets="Game.cov.intel()"
```

---

## Summary

The Autonomous Expansion System provides **zero-maintenance colony growth**. Simply build observers, gather intel, and watch as your empire expands automatically when conditions are right.

**Key Benefits:**
- ✅ No manual claiming required
- ✅ Intelligent target selection
- ✅ Automated infrastructure bootstrapping  
- ✅ Self-healing (timeouts prevent stuck expansions)
- ✅ Full console visibility and control

**The Great Journey continues...**
