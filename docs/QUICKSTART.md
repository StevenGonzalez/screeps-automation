# 🔱 KHALA Quick Start Guide

Welcome to **KHALA** - A Halo-inspired Screeps AI system!

## 🎮 What is KHALA?

KHALA is a powerful automation system for Screeps with unique Halo theming and strategic implementation. It manages your colonies through a hierarchical command structure with autonomous agents.

## 🏗️ Architecture Overview

```
KHALA (Main AI)
    ├── Nexus (Colony 1)
    │   ├── Arbiter: Mining
    │   │   └── Warrior (Miner 1)
    │   │   └── Warrior (Miner 2)
    │   ├── Arbiter: Worker
    │   └── Arbiter: Defense
    └── Nexus (Colony 2)
        └── ...
```

### Core Components

- **🔱 KHALA**: Central AI that coordinates everything
- **🏛️ Nexus**: Manages a single room/colony
- **⚔️ Arbiter**: Controls groups of creeps for specific tasks
- **👾 Warrior**: Enhanced creep wrapper with smart abilities
- **🚩 Campaign**: Flag-based strategic directives

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

### 3. Watch Your KHALA Awaken

The system will automatically:
- Create Nexuses for each owned room
- Spawn MiningArbiters for each energy source
- Direct Warriors to harvest efficiently
- Report status every 100 ticks

## 📊 Status Reports

Every 100 ticks, you'll see a status report:

```
╔════════════════════════════════════════════════════════╗
║           🔱 KHALA STATUS REPORT 🔱                 ║
╠════════════════════════════════════════════════════════╣
║ GCL: 2 (45.3%)
║ Nexuses: 2
║ Arbiters: 4
║ Active Campaigns: 0
║ CPU: 15.2/50 (Bucket: 9500)
║ Credits: 1,234
╚════════════════════════════════════════════════════════╝
```

## 🎯 Current Features

### ✅ Fully Implemented

**Core Systems:**
- **KHALA**: Main AI coordinator with 3-phase execution (Build → Init → Run)
- **Nexus**: Colony management with adaptive phase detection
- **Warrior**: Enhanced creep wrapper with smart movement
- **AutoPlanner**: Automatic structure placement with Protoss Architecture patterns
- **RoadBuilder**: Traffic-based intelligent road network construction

**Economy & Logistics:**
- **ProbeArbiter**: Energy harvesting at sources with container support
- **AdeptArbiter**: Energy logistics and distribution (haulers)
- **SentryArbiter**: Controller upgrading optimization
- **EngineerArbiter**: Construction and repair management
- **ExcavatorArbiter**: Mineral mining (RCL 6+)

**RCL 6+ Advanced Systems:**
- **LinkGateway**: Instant energy transfer network (3 links at RCL 6)
- **LabGateway**: Automatic compound production with reaction chains
- **TerminalArbiter**: Per-colony market operations and trading
- **TerminalNetwork**: Empire-wide resource distribution and balancing

**Military & Defense:**
- **ZealotArbiter**: Defensive melee combat
- **High TemplarArbiter**: Defensive healing support
- **DefenseGateway**: Tower coordination and fortification management
- **WarCouncil**: Combat target scanning and threat assessment
- **SafeModeManager**: Automatic safe mode activation

**Intelligence & Operations:**
- **ObserverNetwork**: Automatic room scanning and intel gathering
- **ReclaimationCouncil**: Autonomous colony expansion system
- **RemoteOperations**: Remote mining management
- **DepositOperations**: Deposit harvesting (powerhouse colonies)

### 🎮 Core Gameplay Loop
1. **ProbeArbiters** harvest energy from sources → containers/links
2. **LinkGateway** transfers energy instantly (source → storage → controller)
3. **AdeptArbiters** distribute energy to spawns, extensions, labs, towers
4. **SentryArbiters** upgrade the controller for RCL progression
5. **EngineerArbiters** construct buildings and repair damage
6. **ExcavatorArbiters** mine minerals → containers → storage (RCL 6+)
7. **LabGateway** produces boost compounds automatically (RCL 6+)
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
import { Nexus } from '../core/Nexus';

export class WorkerArbiter extends Arbiter {
  workers: Warrior[];
  
  constructor(Nexus: Nexus) {
    super(Nexus, 'worker', ArbiterPriority.economy.upgrading);
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

### Creating a New Campaign

```typescript
import { Campaign } from './Campaign';
import { Nexus } from '../core/Nexus';

export class DefenseCampaign extends Campaign {
  static CampaignName = 'defense';
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
| **KHALA** | The alien alliance |
| **Nexus** | Holy city of the High Templars |
| **Arbiter** | Warrior military commanders |
| **Warrior** | Sangheili warriors |
| **Campaign** | Holy missions |
| **Gateway** | Religious structures |
| **High Templars Will** | Divine mandate |

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
- Campaigns for strategic operations
- Gateways for structure management
- Advanced combat algorithms
- Economic optimizations

## 🔱 May the High Templars guide your journey!

---

*"For Aiur awaits, and none shall deny us our rightful place in the divine beyond."*
