# 🗡️ Advanced Military System - Quick Reference

## Overview
The Advanced Military System provides squad-based combat with formation movement, tactical behaviors, and intelligent target prioritization.

## Key Features
- **Squad Coordinator**: Advanced tactical coordination with 4 formations and 5 tactics
- **Formation Movement**: Units maintain positions relative to squad leader
- **Intelligent Targeting**: Priority-based target selection (spawns > towers > labs > terminals)
- **Role-Based Combat**: Attacker, Healer, Ranged, Tank, and Dismantler roles
- **Dynamic Adaptation**: Auto-retreat at 40% health, ranged units kite automatically
- **Console Control**: Real-time command and control via console

## Console Commands

### Launch Attack
```javascript
Game.cov.attack('W2N1', 'box', 'assault');
// Parameters:
//   targetRoom: Room name to attack
//   formation: 'line', 'box', 'wedge', or 'scatter'
//   tactic: 'assault', 'siege', 'raid', 'defend', or 'retreat'
```

### Check Squad Status
```javascript
Game.cov.squads();
// Shows:
//   - Squad size and composition
//   - Current formation and tactic
//   - Average health percentage
//   - Whether squad has reached target room
```

### Change Formation (Mid-Battle)
```javascript
Game.cov.formation('wedge');
// Available: line, box, wedge, scatter
```

### Change Tactic (Mid-Battle)
```javascript
Game.cov.tactic('siege');
// Available: assault, siege, raid, defend, retreat
```

### Recall All Units
```javascript
Game.cov.recall();
// Returns all combat units to home
```

## Formations

### Line Formation
```
  ◯ ◯ ◯ ◯ ◯
  ◯ ◯ ◯ ◯ ◯
```
- Best for: Corridor fighting, narrow passages
- Units spread horizontally in lines

### Box Formation (Default)
```
  🛡 🛡 🛡    (Tanks front)
  💚 💚 💚    (Healers center)
  🏹 🏹 🏹    (Ranged back)
```
- Best for: Balanced combat, most situations
- Protective formation with tanks absorbing damage

### Wedge Formation
```
      ⚔️       (Leader)
    ⚔️  ⚔️
  ⚔️  💚  ⚔️
⚔️  💚  💚  ⚔️
```
- Best for: Aggressive pushes, breaking defenses
- V-shape with leader at point for maximum pressure

### Scatter Formation
```
  ◯   ◯       ◯
      ◯   ◯
  ◯       ◯   ◯
```
- Best for: Area control, avoiding splash damage
- Random spread prevents concentration of fire

## Tactics

### Assault
- **Purpose**: Aggressive push into enemy room
- **Behavior**: Units advance in formation, engage all hostiles
- **Best For**: Destroying enemy rooms with spawns

### Siege
- **Purpose**: Dismantle structures methodically
- **Behavior**: Dismantlers target buildings, others provide support
- **Best For**: Breaking heavily fortified positions

### Raid
- **Purpose**: Hit and run on specific targets
- **Behavior**: Lock onto target, strike, pull back to rally point
- **Best For**: Quick strikes on high-value targets

### Defend
- **Purpose**: Hold position around rally point
- **Behavior**: Stay within 3 tiles of rally, engage nearby hostiles
- **Best For**: Protecting a position or resource

### Retreat
- **Purpose**: Fall back to safety
- **Behavior**: All units return to rally point
- **Auto-Triggered**: When squad health drops below 40%

## Combat Roles

### Attacker (⚔️)
- Melee combat specialist
- Engages hostiles at close range
- Body: TOUGH + MOVE + ATTACK parts

### Healer (💚)
- Support specialist
- Heals injured allies within range 3
- Prioritizes lowest health percentage targets
- Body: MOVE + HEAL parts

### Ranged (🏹)
- Ranged combat specialist
- Kites enemies (moves back if too close)
- Uses rangedMassAttack when 3+ enemies nearby
- Body: MOVE + RANGED_ATTACK parts

### Tank (🛡️)
- Damage absorber
- Draws enemy fire by engaging directly
- Heavy TOUGH parts for survivability
- Body: TOUGH + MOVE + ATTACK parts

### Dismantler (🔧)
- Structure destroyer
- Focuses on dismantling buildings
- Body: MOVE + WORK parts

### Prophet (➕)
- Defensive healer specialist
- Supports Zealots and friendlies during home defense
- Heals adjacent units and uses rangedHeal at range 3
- Prioritizes lowest health percentage targets
- Auto-spawns during high-threat scenarios (>200 threat)
- Body: HEAL + MOVE parts (max 25 pairs)
- **Best For**: Power bank defense, SK lair ops, sustained defensive actions

## Target Priority System

### Creeps
1. **Healers** (Priority: -20) - Eliminate support first
2. **Attackers** (Priority: -15) - Neutralize threats
3. **Ranged** (Priority: -15) - Remove distance damage
4. **Weak Creeps** (Priority: -10) - Easy kills
5. **Close Creeps** (Priority: +range) - Proximity matters

### Structures
1. **Spawns** (Priority: 10) - Stop reinforcements
2. **Towers** (Priority: 15) - Reduce defensive fire
3. **Nuker** (Priority: 20) - Prevent nuclear strike
4. **Terminal** (Priority: 25) - Cut off resources
5. **Storage** (Priority: 35) - Secondary resource target
6. **Lab** (Priority: 30) - Disable boosts
7. **Power Spawn** (Priority: 40)
8. **Extensions** (Priority: 60)
9. **Links** (Priority: 70)

## Example Usage

### Basic Attack
```javascript
// Launch a basic assault on an enemy room
Game.cov.attack('W2N1');
```

### Siege Operation
```javascript
// Launch a siege to dismantle structures
Game.cov.attack('W2N1', 'box', 'siege');
```

### Hit and Run
```javascript
// Quick raid on enemy spawn
Game.cov.attack('W2N1', 'scatter', 'raid');
```

### Monitor and Adjust
```javascript
// Check status
Game.cov.squads();

// If taking too much damage, change tactic
Game.cov.tactic('retreat');

// Once healed, change formation and resume
Game.cov.formation('wedge');
Game.cov.tactic('assault');
```

### Emergency Recall
```javascript
// Abort mission and return home
Game.cov.recall();
```

## Integration with Existing Systems

### Spawn Queue
- Military creeps use **Military priority tier (6)**
- Only spawn when colony has 100% energy (powerhouse phase)
- 4 attackers + 2 healers for standard assault squads

### WarCouncil
- Scans nearby rooms for threats
- Evaluates room threat levels (0-10 scale)
- Prioritizes targets for VanguardArbiter
- Currently auto-launches attacks every 1000 ticks (can be disabled)

### ZealotArbiter
- Manages defensive melee combat in home room
- Spawns Zealots on-demand when threats detected
- Works with towers for coordinated defense
- Spawns 1-5 defenders based on threat level (cap at 5)

### ProphetArbiter
- Manages defensive healing support
- Spawns 1-2 healers during high-threat scenarios (>200 threat)
- Automatically supports Zealots and injured friendlies
- Uses both heal() and rangedHeal() for maximum coverage
- Integrates with BoostManager for enhanced healing

### VanguardArbiter
- Manages all offensive combat operations
- Spawns and tracks combat creeps (4 attackers + 2 healers)
- Integrates with SquadCoordinator for tactical control
- Fallback to simple coordination if squad not initialized

## Tips

1. **Start Small**: Begin with box/assault for standard attacks
2. **Monitor Health**: Watch squad health percentage - auto-retreats at 40%
3. **Adapt Tactics**: Change formation/tactic mid-battle as needed
4. **Formation Matters**: Use wedge for offense, box for defense
5. **Retreat Early**: Don't wait for auto-retreat - recall if losing badly
6. **Scout First**: Use observer network to assess threats before attacking
7. **Energy Reserve**: Ensure home has 50k+ energy before launching attacks

## Future Enhancements
- Boost integration for enhanced combat
- Siege dismantler squads with WORK parts
- Scout role for vision and intel
- Multi-room coordinated attacks
- Dynamic squad composition based on enemy defenses
- Rally point selection algorithm
- Path-finding for squad movement
