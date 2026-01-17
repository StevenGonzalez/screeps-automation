# 🔱 COVENANT Quick Start Guide

Welcome to **COVENANT** - A Halo-inspired Screeps AI system!

## 🎮 What is COVENANT?

COVENANT is a powerful automation system for Screeps with unique Halo theming and strategic implementation. It manages your colonies through a hierarchical command structure with autonomous agents.

## 🏗️ Architecture Overview

```
COVENANT (Main AI)
    ├── High Charity (Colony 1)
    │   ├── Arbiter: Mining
    │   │   └── Elite (Miner 1)
    │   │   └── Elite (Miner 2)
    │   ├── Arbiter: Worker
    │   └── Arbiter: Defense
    └── High Charity (Colony 2)
        └── ...
```

### Core Components

- **🔱 Covenant**: Central AI that coordinates everything
- **🏛️ High Charity**: Manages a single room/colony
- **⚔️ Arbiter**: Controls groups of creeps for specific tasks
- **👾 Elite**: Enhanced creep wrapper with smart abilities
- **🚩 Crusade**: Flag-based strategic directives

## 🚀 Getting Started

### 1. Build the Code

```bash
yarn build
```

### 2. Deploy to Screeps

```bash
yarn deploy        # Deploy to MMO
yarn deploy:sim    # Deploy to simulation
```

### 3. Watch Your COVENANT Awaken

The system will automatically:
- Create High Charities for each owned room
- Spawn MiningArbiters for each energy source
- Direct Elites to harvest efficiently
- Report status every 100 ticks

## 📊 Status Reports

Every 100 ticks, you'll see a status report:

```
╔════════════════════════════════════════════════════════╗
║           🔱 COVENANT STATUS REPORT 🔱                 ║
╠════════════════════════════════════════════════════════╣
║ GCL: 2 (45.3%)
║ High Charities: 2
║ Arbiters: 4
║ Active Crusades: 0
║ CPU: 15.2/50 (Bucket: 9500)
║ Credits: 1,234
╚════════════════════════════════════════════════════════╝
```

## 🎯 Current Features

### ✅ Fully Implemented

**Core Systems:**
- **Covenant**: Main AI coordinator with 3-phase execution (Build → Init → Run)
- **High Charity**: Colony management with adaptive phase detection
- **Elite**: Enhanced creep wrapper with smart movement
- **AutoPlanner**: Automatic structure placement with sacred geometry patterns
- **RoadBuilder**: Traffic-based intelligent road network construction

**Economy & Logistics:**
- **DroneArbiter**: Energy harvesting at sources with container support
- **JackalArbiter**: Energy logistics and distribution (haulers)
- **DevoteeArbiter**: Controller upgrading optimization
- **EngineerArbiter**: Construction and repair management
- **ExcavatorArbiter**: Mineral mining (RCL 6+)

**RCL 6+ Advanced Systems:**
- **LinkTemple**: Instant energy transfer network (3 links at RCL 6)
- **LabTemple**: Automatic compound production with reaction chains
- **TerminalArbiter**: Per-colony market operations and trading
- **TerminalNetwork**: Empire-wide resource distribution and balancing

**Military & Defense:**
- **ZealotArbiter**: Defensive melee combat
- **ProphetArbiter**: Defensive healing support
- **DefenseTemple**: Tower coordination and fortification management
- **WarCouncil**: Combat target scanning and threat assessment
- **SafeModeManager**: Automatic safe mode activation

**Intelligence & Operations:**
- **ObserverNetwork**: Automatic room scanning and intel gathering
- **ReclaimationCouncil**: Autonomous colony expansion system
- **RemoteOperations**: Remote mining management
- **DepositOperations**: Deposit harvesting (powerhouse colonies)

### 🎮 Core Gameplay Loop
1. **DroneArbiters** harvest energy from sources → containers/links
2. **LinkTemple** transfers energy instantly (source → storage → controller)
3. **JackalArbiters** distribute energy to spawns, extensions, labs, towers
4. **DevoteeArbiters** upgrade the controller for RCL progression
5. **EngineerArbiters** construct buildings and repair damage
6. **ExcavatorArbiters** mine minerals → containers → storage (RCL 6+)
7. **LabTemple** produces boost compounds automatically (RCL 6+)
8. **TerminalNetwork** shares resources between colonies (RCL 6+)

### 🚀 Advanced Features
- **Automatic Expansion**: Finds and claims new rooms autonomously
- **Lab Auto-Production**: Plans and executes multi-tier compound chains
- **Resource Balancing**: Distributes minerals and boosts across empire
- **Power Processing**: Harvests PowerBanks and processes power (RCL 8)
- **Factory Production**: Commodity manufacturing (RCL 7+)
- **Military Squads**: Formation-based combat with tactics system

## 🔧 Extending the System

### Creating a New Arbiter

```typescript
import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';

export class WorkerArbiter extends Arbiter {
  workers: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'worker', ArbiterPriority.economy.upgrading);
    this.workers = [];
  }
  
  init(): void {
    this.refresh();
    // Request spawns if needed
  }
  
  run(): void {
    for (const worker of this.workers) {
      // Direct worker behavior
    }
  }
}
```

### Creating a New Crusade

```typescript
import { Crusade } from './Crusade';
import { HighCharity } from '../core/HighCharity';

export class DefenseCrusade extends Crusade {
  static crusadeName = 'defense';
  static color = COLOR_RED;
  static secondaryColor = COLOR_RED;
  
  spawnArbiters(): void {
    // Create defense arbiters
  }
  
  init(): void {
    this.alert('Defense operation initiated');
  }
  
  run(): void {
    // Execute defense logic
  }
}
```

## 🎮 Halo Theme Reference

| Component | Halo Reference |
|-----------|----------------|
| **Covenant** | The alien alliance |
| **High Charity** | Holy city of the Prophets |
| **Arbiter** | Elite military commanders |
| **Elite** | Sangheili warriors |
| **Crusade** | Holy missions |
| **Temple** | Religious structures |
| **Prophets Will** | Divine mandate |

## 📚 Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed system architecture
- [RCL6_QUICK_REFERENCE.md](RCL6_QUICK_REFERENCE.md) - RCL 6 structures and systems
- [RCL6_SYSTEMS_VERIFICATION.md](RCL6_SYSTEMS_VERIFICATION.md) - Complete system verification
- [LAB_SYSTEM.md](LAB_SYSTEM.md) - Lab automation and compound production
- [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md) - Resource sharing and trading
- [EXPANSION_SYSTEM.md](EXPANSION_SYSTEM.md) - Autonomous expansion
- [Screeps API Docs](https://docs.screeps.com/) - Game mechanics

## 🤝 Contributing

This is your personal AI! Extend it with:
- New Arbiter types for specialized tasks
- Crusades for strategic operations
- Temples for structure management
- Advanced combat algorithms
- Economic optimizations

## 🔱 May the Prophets guide your journey!

---

*"The Great Journey awaits, and none shall deny us our rightful place in the divine beyond."*
