# Screeps Automation Architecture

## 🎯 Overview

This is a beautiful, high-quality Screeps automation system designed to win from RCL 1 to max level. It uses a modular, domain-driven architecture that separates concerns and provides maximum maintainability.

## 🏗️ Architecture

### Core Entry Point

- **`main.ts`** - Clean orchestration of all systems with performance monitoring

### Global Systems

- **`global.memory.ts`** - Centralized memory cleanup, initialization, and global statistics

### Room Systems

- **`room.orchestration.ts`** - Orchestrates all room-level operations and creep coordination
- **`room.intelligence.ts`** - Pure functional room analysis and intelligence gathering
- **`room.economy.ts`** - Economic planning and optimization
- **`room.construction.ts`** - Intelligent construction prioritization
- **`room.defense.ts`** - Threat assessment and defense coordination
- **`room.spawning.ts`** - Advanced spawning management with priority queues
- **`room.structures.ts`** - Structure orchestration coordinator

### Structure Systems

- **`structure.tower.ts`** - Tower automation (attack, heal, repair, auto-repair)
- **`structure.link.ts`** - Link energy distribution and logistics
- **`structure.extension.ts`** - Extension energy management and monitoring
- **`structure.spawn.ts`** - Spawn status tracking and energy management

### Creep Systems

- **`creep.actions.ts`** - Modular creep behavior system
- **`creep.personality.ts`** - Entertainment system with spawn phrases

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
