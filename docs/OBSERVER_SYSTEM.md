# Observer Network - Intelligence System

## Overview

The Observer Network provides **automatic room scanning and intelligence gathering** to support strategic decision-making across combat, expansion, and trade operations.

## Features

### 🔍 Automatic Scanning
- Scans rooms continuously using available observers
- Prioritizes: flagged rooms → adjacent rooms → observer range rooms
- Rescans rooms every 1,000 ticks to keep intel fresh
- Runs every 5 ticks for minimal CPU impact

### 📊 Intel Collection
Gathers comprehensive room data:
- **Owner & Level**: Controller ownership and RCL
- **Resources**: Source positions, mineral type/amount
- **Military**: Hostile creeps, towers, ramparts count
- **Structures**: Spawns, extensions, labs, storage, terminal
- **Strategic Scores**: Room value (0-100), threat level (0-10)

### 🎯 Strategic Analysis
- **Room Score**: Calculates expansion/raid potential
- **Threat Level**: Assesses military danger
- **Expansion Candidates**: Identifies unclaimed 2+ source rooms
- **Threat Detection**: Flags high-threat enemy rooms

## Console Commands

### View Intel
```javascript
Game.kha.intel()           // Top 10 scanned rooms
Game.kha.intel('W1N1')     // Specific room detail
```

**Output Example:**
```
═══════════════════════════════════════════════════════
🔍 INTELLIGENCE REPORT
═══════════════════════════════════════════════════════

📍 W2N3
  Scanned: 45 ticks ago
  Owner: PlayerName (RCL 7)
  Sources: 2
  Mineral: H (280000)
  Structures: 3 spawns, 60 ext, 10 labs
  Defense: 6 towers, 128 ramparts
  Economy: ✓ storage, ✓ terminal
  Score: 60/100
  Threat: 8/10
```

### Find Expansion Rooms
```javascript
Game.kha.expand()
```

Shows top 10 unclaimed rooms with 2+ sources, sorted by strategic value.

**Output:**
```
═══════════════════════════════════════════════════════
🏗️ EXPANSION CANDIDATES
═══════════════════════════════════════════════════════

1. W5N2 (Score: 70)
   Sources: 2
   Mineral: U
   Threat: 2/10

2. W4N1 (Score: 60)
   Sources: 2
   Mineral: K
   Threat: 0/10
```

### Detect Threats
```javascript
Game.kha.threats()
```

Shows rooms with threat level ≥ 5.

**Output:**
```
═══════════════════════════════════════════════════════
⚔️ DETECTED THREATS
═══════════════════════════════════════════════════════

⚠️ W1N2 - Threat Level: 8/10
   Owner: EnemyPlayer (RCL 8)
   Hostiles: 12 creeps
   Defense: 6 towers, 250 ramparts
```

## How It Works

### 1. Observer Discovery
```typescript
// Finds all observers in owned rooms
constructor() {
  for (const roomName in Game.rooms) {
    const observers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_OBSERVER
    });
    this.observers.push(...observers);
  }
}
```

### 2. Scan Queue Building
Priority order:
1. **Flagged rooms** - Rooms with any flags
2. **Adjacent rooms** - All rooms bordering owned rooms
3. **Observer range** - Rooms within 10 range not scanned in 1000 ticks

```typescript
buildScanQueue() {
  // Priority 1: Flags
  for (const flag in Game.flags) {
    scanQueue.push(flag.pos.roomName);
  }
  
  // Priority 2: Adjacent
  for (const myRoom of ownedRooms) {
    scanQueue.push(...getAdjacentRooms(myRoom));
  }
  
  // Priority 3: Range
  for (const myRoom of ownedRooms) {
    const inRange = getRoomsInRange(myRoom, 10);
    for (const room of inRange) {
      if (!scannedRecently(room)) {
        scanQueue.push(room);
      }
    }
  }
}
```

### 3. Scanning & Analysis
```typescript
scanRoom(observer, roomName) {
  observer.observeRoom(roomName);
  const room = Game.rooms[roomName];
  
  // Gather data
  const intel = {
    owner: room.controller?.owner?.username,
    level: room.controller?.level,
    sources: room.find(FIND_SOURCES),
    hostiles: room.find(FIND_HOSTILE_CREEPS),
    // ... more data
  };
  
  // Calculate scores
  intel.score = calculateRoomScore(intel);
  intel.threat = calculateThreatLevel(intel);
  
  // Store in Memory.intel
  Memory.intel[roomName] = intel;
}
```

### 4. Score Calculation

**Room Score (0-100):**
- +10 per source (up to 20)
- +10 if mineral present
- +30 if unclaimed (expansion value)
- +20 if low level owned (raid value)
- +20 if has terminal (trade value)
- +10 if has storage

**Threat Level (0-10):**
- +1 per 3 hostile creeps (max 3)
- +1.5 per tower (max 3)
- +2 if RCL 7+
- -3 if safe mode active
- +1 per 50 ramparts (max 2)

## Integration

### With WarCouncil
```typescript
// Find high-threat rooms to target
const threats = observerNetwork.getThreats(7);
for (const threat of threats) {
  warCouncil.planAttack(threat.roomName);
}
```

### With Expansion Planning
```typescript
// Find best room to claim
const candidates = observerNetwork.getExpansionCandidates();
if (candidates.length > 0) {
  const best = candidates[0];
  Game.spawns['Sanctum'].spawnClaimer(best.roomName);
}
```

### With Market Manager
```typescript
// Find rooms with terminals for trading
const intel = observerNetwork.getAllIntel();
const tradingRooms = intel.filter(i => i.terminal && !i.owner);
// Set up trade routes
```

## Memory Structure

```typescript
interface RoomIntel {
  roomName: string;
  scannedAt: number;
  
  // Basic info
  owner?: string;
  level?: number;
  safeMode?: number;
  
  // Resources
  sources?: { id: string; pos: { x: number; y: number } }[];
  mineral?: { type: MineralConstant; amount: number };
  
  // Military
  hostileCreeps?: number;
  hostileTowers?: number;
  ramparts?: number;
  
  // Structures
  spawns?: number;
  extensions?: number;
  labs?: number;
  storage?: boolean;
  terminal?: boolean;
  
  // Strategic value
  score?: number; // 0-100
  threat?: number; // 0-10
}

// Stored in Memory.intel[roomName]
```

## Performance

- **CPU Impact**: ~0.1-0.3 CPU per room scanned
- **Scan Frequency**: Every 5 ticks
- **Rooms per Scan**: 1 per observer (up to ~6 observers typical)
- **Memory Usage**: ~200 bytes per room (500 rooms = 100KB)
- **Intel Retention**: 10,000 ticks (auto-cleanup)

## Scanning Patterns

### Spiral Pattern (Adjacent Priority)
```
        N
    W   X   E
        S

Your Room: X
Adjacent: N, S, E, W (scanned first)
```

### Range Pattern (Observer Range)
```
Observer Range: 10 rooms in any direction

    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . X . . . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
    
    X = Your room with observer
    . = Scannable rooms (within 10 range)
```

## Best Practices

1. **Build observers early** (RCL 8) for strategic advantage
2. **Place flags** in key rooms to prioritize scanning
3. **Check `Game.kha.intel()` regularly** for threats
4. **Use `Game.kha.expand()`** before claiming new rooms
5. **Monitor threat detection** with `Game.kha.threats()`

## Automation Examples

### Auto-Defend Against Threats
```typescript
// In your defense system
const threats = Cov.observerNetwork.getThreats(8);
for (const threat of threats) {
  if (isNearby(threat.roomName)) {
    spawnDefenders(threat.roomName);
  }
}
```

### Auto-Expand to Best Room
```typescript
// When ready to expand
if (Game.gcl.level > currentColonies) {
  const candidates = Cov.observerNetwork.getExpansionCandidates();
  if (candidates.length > 0) {
    const best = candidates[0];
    Game.flags['Expand'].setPosition(new RoomPosition(25, 25, best.roomName));
  }
}
```

### Scout Before Attack
```typescript
// Before launching attack
const intel = Cov.observerNetwork.getIntel(targetRoom);
if (intel && intel.threat < 7) {
  warCouncil.attack(targetRoom);
} else {
  console.log(`⚠️ ${targetRoom} too dangerous (threat: ${intel?.threat})`);
}
```

## Visualization

The observer network doesn't draw visuals by default (to save CPU), but you can enable room-specific visuals in the console:

```javascript
// Show what rooms are being scanned
Game.rooms['W1N1'].visual.text(
  `Scanning: ${Memory.intel ? Object.keys(Memory.intel).length : 0} rooms`,
  1, 1,
  { align: 'left', color: '#00FF00' }
);
```

## Future Enhancements

- [ ] Pathfinding cost maps from intel data
- [ ] Automatic threat notifications via Game.notify
- [ ] Power bank detection and auto-harvest
- [ ] Deposit tracking for commodity farming
- [ ] Historical intel tracking (trends over time)
- [ ] Multi-room attack coordination based on intel
