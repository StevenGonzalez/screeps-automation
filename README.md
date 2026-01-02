## 🚀 Features

### 🔱 COVENANT AI System
Inspired by Halo's Covenant, this advanced AI architecture features:
- **Distributed Intelligence**: Each High Charity (colony) operates autonomously
- **Hierarchical Command**: Arbiters manage specialized Elite (creep) teams
- **Dynamic Response**: Crusades allow flag-based strategic intervention
- **Three-Phase Execution**: Optimized Build → Init → Run pattern

### 🎯 Core Systems
- **High Charities**: Autonomous room management with phase-based adaptation
- **Arbiters**: Specialized controllers for mining, building, defense, and logistics
- **Elites**: Enhanced creep wrappers with smart movement and task management
- **Crusades**: Flag-based directive system for strategic operations

### 🏗️ Advanced Features
- **CPU Optimization**: CacheSystem, Profiler, and TickBudget management
- **Sacred Geometry**: Covenant-themed base layouts with hexagonal symmetry
- **Combat System**: WarCouncil and VanguardArbiter for military operations
- **Power Harvesting**: PowerTemple and PowerHarvesterArbiter automation
- **Defense System**: Threat assessment and automatic safe mode activation
- **Market Automation**: Intelligent buy/sell with price history tracking
  - **Price Tracking**: Monitors market prices every 100 ticks, maintains rolling history
  - **Smart Selling**: Automatically sells excess resources when price >= 90% of average
  - **Smart Buying**: Purchases needed resources when price <= 110% of average
  - **Credit Management**: Maintains configurable minimum credit reserve (default 10k)
  - **Resource Thresholds**: Customizable buy/sell thresholds per resource type
  - **Automatic Commodity Sales**: Sells factory-produced commodities when stockpiled
  - **Trade History**: Tracks last 100 trades with profit/loss analysis
  - Console commands: `Game.cov.market()`, `Game.cov.price()`, `Game.cov.trade()`
- **Terminal Network**: Multi-room resource distribution
  - **Energy Balancing**: Automatically shares energy between colonies (surplus > 150k, deficit < 50k)
  - **Mineral Distribution**: Balances base minerals across empire for boost production
  - **Priority Queue**: Transfer requests with priority levels (10=emergency, 5=normal)
  - **Emergency Transfers**: High-priority resource transfers for colonies under threat
  - **Cost Optimization**: Calculates transfer costs, ensures sufficient energy reserves
  - **Network Monitoring**: Real-time transfer queue and colony terminal status
  - **Automatic Integration**: Works with boost production and military systems
  - Console commands: `Game.cov.network()`, `Game.cov.send()`, `Game.cov.emergency()`
- **Lab Automation**: Automatic compound production with reaction chains
- **Observer Network**: Automatic room scanning and intelligence gathering
- **Remote Mining**: Secure resource extraction with multi-layer threat detection
  - Real-time hostile detection and automatic retreat
  - Construction site griefing protection
  - Hostile reservation and structure checks
  - Cheap creep bodies to minimize losses (max 800 energy)
  - Auto re-enable when rooms become safe
- **Autonomous Expansion**: Intelligent colony growth system
  - Evaluates expansion targets from observer intel
  - Scores rooms based on sources, minerals, distance, and threats
  - Spawns claimer and pioneer creeps automatically
  - Bootstraps new colonies with initial infrastructure
  - Monitors expansion progress and handles failures
- **Terminal Network**: Inter-colony resource sharing
  - Automatically balances energy, minerals, and compounds
  - Emergency transfers for colonies under attack or bootstrapping
  - Prioritized need-matching algorithm
  - Compound distribution from labs to combat colonies
  - Real-time transfer monitoring and statistics
- **Power Processing**: Automated ops generation
  - Converts power to ops in Power Spawns at RCL 8
  - Smart energy management (only processes when surplus available)
  - Automatic power delivery requests via terminal network
  - Tracks efficiency metrics and ops generation
  - Console monitoring with `Game.cov.powerProcessing()`
- **Factory Automation**: Commodity production system
  - Automatically produces Level 0 and Level 1 commodities
  - Resource management via storage and terminal
  - Production prioritization based on available components
  - Tracks production statistics by commodity type
  - Console monitoring with `Game.cov.factories()`
- **Market Automation**: Automated commodity sales
  - Sells factory-produced commodities automatically
  - Price intelligence with historical tracking
  - Threshold-based selling (1000+ for L0, 500+ for L1)
  - Tracks revenue and sales statistics
  - Integrated with existing buy/sell logic
- **Spawn Queue System**: Priority-based spawn management
  - 6-tier priority system (Emergency → Defense → Critical → Economy → Expansion → Military)
  - **Early Game Harvester System**: Dedicated harvesters for RCL 1-3 that directly collect and deliver energy
  - **Mid-Late Game Miner+Hauler**: Transitions to static miners on containers + hauler logistics
  - Dynamic body optimization based on energy capacity
  - Spawn load balancing across multiple spawns
  - Lifecycle tracking for replacement spawning
  - Emergency minimal bodies when under attack
  - Queue statistics and monitoring with `Game.cov.spawns()`
- **Auto-Planner**: Automated construction and layout system
  - Automatic construction site placement on RCL upgrades
  - Traffic-based road planning (builds roads where creeps frequently travel)
  - Defense perimeter planning with automatic ramparts on critical structures
  - Sacred geometry layouts with hexagonal symmetry
  - Integration with RoomPlanner for optimal structure placement
  - Visualization tools for layout and traffic heatmaps
  - Console monitoring with `Game.cov.layout()`
- **Power Creep Automation**: Immortal units with divine abilities
  - Automatic power creep creation at GPL 1+ and RCL 8
  - Spawning and renewal management at Power Spawns
  - Strategic ability usage prioritization
  - OPERATE_SPAWN: 50% faster spawn times during active spawning
  - OPERATE_TOWER: 200% tower range and power during combat
  - OPERATE_EXTENSION: Free energy distribution from storage
  - OPERATE_LAB: 4x reaction speed for compound production
  - OPERATE_FACTORY: Reduced cooldown for commodity production
  - GENERATE_OPS: Self-sustaining ops generation from energy
  - Console monitoring with `Game.cov.powerCreeps()`
- **Advanced Military System**: Squad-based combat with tactical coordination
  - **Squad Coordinator**: Formation movement with 4 formations (line, box, wedge, scatter)
  - **Combat Tactics**: 5 tactic modes (assault, siege, raid, defend, retreat)
  - **Intelligent Targeting**: Priority-based target selection for creeps and structures
  - **Role-Based Combat**: Attacker, Healer, Ranged, Tank, and Dismantler roles
  - **Formation Movement**: Units maintain tactical positions relative to squad leader
  - **Dynamic Adaptation**: Auto-retreat at 40% health, kiting for ranged units
  - **Console Control**: Launch attacks, change formations, recall units on the fly
  - **VanguardArbiter Integration**: Seamless integration with existing military system
  - Commands: `Game.cov.attack()`, `Game.cov.squads()`, `Game.cov.recall()`, `Game.cov.formation()`, `Game.cov.tactic()`
- **Boost Production System**: Automated military enhancement automation
  - **Automatic Production**: Monitors stock levels and queues boost compound production
  - **Military Mode**: Detects active combat and prioritizes military boosts
  - **Target Management**: Maintains stockpiles of Tier 3 (6k) and Tier 4 (3k) boosts
  - **Smart Prioritization**: Prioritizes XUH2O, XLHO2, XKHO2, XGHO2, XZO2 for combat
  - **Mineral Requests**: Automatically identifies missing base minerals
  - **Boost Assignment**: Automatically requests boosts for newly spawned combat creeps
  - **Integration**: Works with LabTemple, BoostTemple, and VanguardArbiter
  - **Console Monitoring**: `Game.cov.boosts()` for status, `Game.cov.militaryBoosts(true)` for aggressive mode
- Structure logic for towers, links, spawns, and terminals
- Console commands via `Game.cov.*` for monitoring and control
- Designed for clarity, modularity, and ease of iteration

## 🛠️ Tech Stack

- **Language**: JavaScript (ES6)
- **Package Manager**: Yarn
- **Editor**: Visual Studio Code
- **Environment**: Screeps MMO sandbox

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🤝 About

Created and maintained by [Steven Gonzalez](https://github.com/StevenGonzalez) as part of an ongoing exploration into autonomous systems, game AI, and clean software architecture.
