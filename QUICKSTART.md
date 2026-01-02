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
- **Covenant**: Main AI coordinator with 3-phase execution (Build → Init → Run)
- **High Charity**: Colony management with adaptive phase detection
- **MiningArbiter**: Automated energy harvesting with container support
- **HaulerArbiter**: Energy logistics and distribution system
- **WorkerArbiter**: Controller upgrading with smart energy collection
- **BuilderArbiter**: Construction and repair management
- **DefenseArbiter**: Military defense with tower coordination
- **Elite**: Enhanced creep wrapper with smart movement
- **Crusade Base**: Flag-based directive framework

### 🎮 Core Gameplay Loop
1. **MiningArbiters** harvest energy from sources
2. **HaulerArbiters** transport energy to spawns and extensions
3. **WorkerArbiters** upgrade the controller for RCL progression
4. **BuilderArbiters** construct buildings and repair damage
5. **DefenseArbiters** spawn defenders when hostiles are detected

### 🚧 Coming Soon
- **Temples**: Structure cluster management (HiveClusters)
- **Prophets Will**: Global logistics network
- **Bootstrap Crusade**: Emergency recovery from catastrophic failure
- **Colonize Crusade**: Expansion to new rooms
- **Scout Crusade**: Room exploration and intel gathering
- **Advanced Combat**: Ranged defenders, healers, and squads

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
