# 🔱 COVENANT Architecture

## 🎯 Overview

**"The will of the Prophets guides all"**

COVENANT is a powerful, Halo-inspired automation system for Screeps that manages colonies through a hierarchical command structure with unique theming and strategic implementation.

### Core Philosophy
- **Distributed Intelligence**: Each High Charity operates autonomously while coordinating with the Covenant
- **Hierarchical Command**: Arbiters manage specialized Elite teams for specific objectives
- **Dynamic Response**: Crusades allow flag-based strategic intervention
- **Efficient Execution**: Optimized three-phase execution (Build → Init → Run)

## 🏗️ COVENANT Architecture

### 🔱 Core Components

#### **Covenant** (`core/Covenant.ts`)
The central AI coordinator that manages all operations across the entire game world. Responsible for:
- Managing all High Charities (colonies)
- Coordinating Arbiters across rooms
- Processing Crusades (flag-based directives)
- Global statistics and performance monitoring

#### **High Charity** (`core/HighCharity.ts`)
Colony manager for a single owned room. Each High Charity:
- Manages room structures (spawns, towers, links, storage, etc.)
- Spawns and coordinates Arbiters
- Tracks economic and military statistics
- Determines operational phase (bootstrap, developing, mature, powerhouse)

#### **Arbiter** (`arbiters/Arbiter.ts`)
Specialized creep controllers that manage teams of Elites. Types include:
- **DroneArbiter** - Harvesting operations at sources
- **JackalArbiter** - Energy and resource logistics
- **EngineerArbiter** - Building and repairing
- **DevoteeArbiter** - Controller upgrading optimization
- **ZealotArbiter** - Defensive melee combat
- **ProphetArbiter** - Defensive healing support
- **VanguardArbiter** - Offensive combat operations
- **HunterArbiter** - Remote room defense and clearing

#### **Elite** (`elites/Elite.ts`)
Enhanced creep wrapper providing:
- Smart movement and pathfinding
- Task management system
- Boosting and combat utilities
- Simplified creep control interface

#### **Crusade** (`crusades/Crusade.ts`)
Flag-based directive system for dynamic strategic response:
- Room claiming and colonization
- Defense operations
- Resource extraction
- Strategic objectives

### 📂 Legacy Systems (Being Migrated)

The following systems are being gradually migrated to COVENANT architecture:

- **`room.orchestration.ts`** - Will be replaced by HighCharity
- **`room.spawning.ts`** - Will be replaced by Arbiter spawning logic
- **`creep.actions.ts`** - Will be replaced by Elite methods
- **Structure systems** - Will be replaced by Temple (HiveCluster) pattern

## 🔄 Execution Flow

COVENANT uses a three-phase execution model each tick:

### **Phase 1: Build** 
Construct the world state and object graph
- Clean up memory (dead creeps, removed flags)
- Create High Charity objects for each owned room
- Build Arbiters for each High Charity
- Parse flags into Crusades
- Refresh structure and creep references

### **Phase 2: Init**
Initialize all systems for execution
- High Charities initialize their Arbiters
- Arbiters refresh their Elite teams
- Arbiters calculate spawning needs
- Crusades initialize their objectives

### **Phase 3: Run**
Execute all operations
- High Charities run their operations
- Arbiters direct their Elites
- Crusades execute their strategies
- Structures perform automated tasks

### **Phase 4: End of Tick**
Performance monitoring and stats
- Update global statistics
- Generate visuals
- Report performance metrics
- Pixel generation

## 🎮 COVENANT Terminology

Inspired by Halo's Covenant faction:

| Component | Description |
|-----------|-------------|
| **Covenant** | Central AI coordinator |
| **High Charity** | Room/colony manager |
| **Arbiter** | Creep controller for specific roles |
| **Elite** | Enhanced creep wrapper |
| **Crusade** | Flag-based task system |
| **Temple** | Structure group (e.g., MiningTemple, PowerTemple) |
| **Prophets Will** | Resource distribution network |
| **War Council** | Combat target scanning and squad management |

### 🏛️ Core Temples

| Temple | Purpose | RCL Required |
|--------|---------|--------------|
| **MiningTemple** | Energy harvesting operations | 1 |
| **CommandTemple** | Spawn queue and colony commands | 1 |
| **IntelligenceTemple** | Remote room scanning | 3+ |
| **DefenseTemple** | Fortification management | 1 |
| **LabTemple** | Chemical reactions | 6+ |
| **BoostTemple** | Creep enhancement | 6+ |
| **PowerTemple** | PowerBank harvesting & processing | 8 |

### 🎨 Covenant Base Layout - Sacred Geometry

Our automatic structure placement uses **distinctive Covenant religious architecture**:

**SACRED CORE** (Cross Pattern):
- Storage at holy anchor (High Charity's heart) 
- Terminal, Factory, Power Spawn form cross pattern (religious symbolism)

**HIERARCHS' THRONES** (Triangular Formation):
- 3 spawns arranged in triangle representing the 3 Prophets
- North: Prophet of Truth, SW: Prophet of Regret, SE: Prophet of Mercy

**RINGS OF HIGH CHARITY** (6-Fold Sacred Geometry):
- Extensions arranged in hexagonal mandala pattern
- Concentric rings representing tiers of the holy city
- 6-fold symmetry (ceremonial/religious significance)
- Inner sanctum → Middle tiers → Outer tiers progression

**GUARDIAN SENTINELS** (Defensive Hexagon):
- 6 towers form protective ring around core
- Overlapping fields of fire
- Positioned at cardinal hexagonal points

**RESEARCH SANCTUM** (Lab Cluster):
- Labs arranged in tight flower pattern
- Optimized for reaction chains
- Central reagent sources with surrounding reaction labs

**Visualization**: Toggle with `Game.cov.showPlan()` to see:
- Golden cross pattern at sacred core
- Purple concentric hexagons (Rings of High Charity)
- Magenta triangle connecting Hierarchs' Thrones
- Red hexagon connecting Guardian Sentinels
- Tier-colored extensions showing city layers

### ⚔️ Military Systems

- **War Council**: Scans nearby rooms for attack targets, evaluates threat levels
- **VanguardArbiter**: Coordinates attack/healer squads for offensive operations
- **ZealotArbiter**: Defensive melee combat operations
- **ProphetArbiter**: Defensive healing support (pairs with Zealots during high-threat scenarios)
- **PowerHarvesterArbiter**: Manages PowerBank assault and collection operations

## � File Structure Overview

```
📁 src/
├── 🎯 main.ts                      # Entry point orchestration
├── 🌐 global.memory.ts             # Global memory management
├── 🤖 creep.actions.ts             # Creep behavior system
├── 🎭 creep.personality.ts         # Entertainment & spawn phrases
├── 🏰 Room Systems:
│   ├── room.orchestration.ts       # Room coordination
│   ├── room.intelligence.ts        # Room analysis & intelligence
│   ├── room.economy.ts             # Economic planning
│   ├── room.construction.ts        # Construction prioritization
│   ├── room.defense.ts             # Defense coordination
│   ├── room.spawning.ts            # Spawning management
│   └── room.structures.ts          # Structure orchestration
└── 🏗️ Structure Systems:
    ├── structure.tower.ts          # Tower automation
    ├── structure.link.ts           # Link energy distribution
    ├── structure.extension.ts      # Extension management
    └── structure.spawn.ts          # Spawn monitoring
```

## �🔄 Execution Flow

```
1. Memory Management (cleanup, initialization, stats)
2. Room Processing (intelligence → planning → execution)
3. Global Operations (market, logistics, monitoring)
4. Performance Monitoring (CPU, bucket, metrics)
```

## 🎭 Features

### Intelligence System

- Room phase analysis (Early, Developing, Mature, Powerhouse)
- Economic efficiency scoring
- Threat assessment and safety scoring
- Source analysis and harvesting efficiency

### Economic Planning

- Dynamic creep composition based on room state
- Optimal body part calculations
- Energy flow analysis and optimization
- Economic health monitoring

### Construction Planning

- Priority-based construction queues
- Infrastructure need analysis
- Critical vs optional structure identification

### Defense System

- Automatic threat detection and response
- Tower coordination with priority targeting
- Defense creep spawning on demand
- Safety score calculation

### Advanced Spawning

- Multi-priority spawn queues (Defense → Emergency → Economy → Construction)
- Dynamic body optimization based on available energy
- Role-based memory assignment
- Spawn announcement system

### Structure Automation

- Intelligent tower targeting (attack, heal, repair)
- Link energy distribution system
- Auto-repair with priority structure protection
- Extension and spawn energy monitoring

### Creep Management

- Enhanced role-based behavior system
- Source assignment for harvesters
- Link-aware upgraders
- Construction priority building
- Defensive patrol patterns

## 🎨 Code Quality Features

### Modular Design

- Single responsibility per module
- Clean separation of concerns
- Testable pure functions
- TypeScript strict typing

### Performance Optimization

- CPU monitoring and alerting
- Memory cleanup automation
- Efficient pathfinding
- Smart energy distribution

### Entertainment System

- Role-based spawn phrases
- Celebration messages
- Status icons and emojis
- Performance metrics logging

## 🚀 Usage

The system automatically handles everything - just deploy and watch it dominate! The modular architecture makes it easy to extend and customize specific behaviors without affecting the entire system.

## 📈 Scalability

- Handles multiple rooms efficiently
- CPU-conscious design with performance monitoring
- Memory-efficient with automatic cleanup
- Scales from RCL 1 single room to massive multi-room empires

---

_This automation system represents the pinnacle of Screeps bot architecture - beautiful, efficient, and unstoppable!_
