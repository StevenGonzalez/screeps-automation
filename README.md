# � The Royal Keep - Screeps Automation

A Medieval Kingdom-themed Screeps automation project where you rule as monarch over your realm.

## 🎭 Theme

This project uses Medieval Kingdom as its central theme:

- **The Royal Keep**: The main control center (your colony)
- **His Majesty's Court**: Command structure directing all subjects
- **Royal Subjects**: The creeps serving the Crown
- **The Royal Archives**: Memory management system
- **Fallen in Service**: Where deceased creeps are honored

## 👥 Creep Roles

### The Peasants (Harvesters) 🌾
Gather energy from sources and deliver to the castle.
- Named after: Cedric, Oswald, Aldric, Godwin, Beorn

### The Masons (Builders) 🔨
Build construction sites and repair damaged structures.
- Named after: Edmund, Baldwin, Godfrey, Reinhard, Wulfric

### The Alchemists (Upgraders) ⚗️
Transmute energy to strengthen and advance the realm.
- Named after: Merlin, Aldous, Cornelius, Magnus, Ambrose

### The Merchants (Haulers) 📦
Transport energy and resources efficiently across the kingdom.
- Named after: Gilbert, Roland, Percival, Tristan, Gawain

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Configure your Screeps credentials:**
   - Copy `screeps.json.example` to `screeps.json`
   - Add your Screeps API credentials

3. **Deploy to Screeps:**
   ```bash
   yarn deploy
   ```

4. **Watch it run:**
   Your kingdom will automatically recruit subjects and manage resources!

## 📁 Project Structure

```
src/
├── main.ts                 # Main game loop (The Royal Keep)
├── managers/
│   ├── SpawnManager.ts     # The Royal Barracks
│   └── CreepManager.ts     # The Royal Court
├── roles/
│   ├── RoleHarvester.ts    # The Peasants
│   ├── RoleBuilder.ts      # The Masons
│   ├── RoleUpgrader.ts     # The Alchemists
│   └── RoleHauler.ts       # The Merchants
└── utils/
    ├── BodyBuilder.ts      # The Quartermaster's Workshop
    ├── NameGenerator.ts    # The Royal Herald
    ├── ErrorMapper.ts      # The Royal Scribe
    └── MemoryManager.ts    # The Royal Archives
```

## 🎯 Features

- ✅ Automatic subject recruitment with priority system
- ✅ Energy harvesting and distribution
- ✅ Construction and repair automation
- ✅ Kingdom advancement (controller upgrading)
- ✅ Medieval naming theme
- ✅ Clean code architecture
- ✅ TypeScript with full type safety

## 🛠️ Extending the Project

Want to add more roles? Follow the Medieval theme:

- **Defenders**: The Knights (military defense)
- **Scouts**: The Rangers (exploration)
- **Miners**: The Miners (mineral extraction)
- **Claimer**: The Lord (room claiming)

## 📜 Scripts

- `yarn build` - Compile TypeScript
- `yarn deploy` - Build and deploy to Screeps
- `yarn deploy:sim` - Deploy to simulation room

## 🎨 Customization

Feel free to customize the theme! You could use different naming conventions:
- English Medieval (current): Cedric, Edmund, Roland...
- French Medieval: Guillaume, Philippe, Henri...
- Fantasy Medieval: Aragorn, Boromir, Faramir...
- Historical Kings: Richard, Henry, Edward...

Just update the names in [NameGenerator.ts](src/utils/NameGenerator.ts) and comments throughout!

## 📖 License

MIT - Rule your kingdom freely!

---

*Long live the King! May your realm prosper! 👑*

## 🚀 Features (Legacy Documentation)

### 🎯 Core Systems
- **Nexuses**: Autonomous room management with phase-based adaptation
- **Arbiters**: Specialized controllers for mining, building, defense, and logistics
- **Warriors**: Enhanced creep wrappers with smart movement and task management
- **Campaigns**: Flag-based directive system for strategic operations

### 🏗️ Advanced Features
- **CPU Optimization**: CacheSystem, Profiler, and TickBudget management
- **Protoss Architecture**: KHALA-themed base layouts with hexagonal symmetry
- **Combat System**: WarCouncil and ColossusArbiter for military operations
- **Power Harvesting**: PowerGateway and PowerHarvesterArbiter automation
- **Defense System**: Threat assessment and automatic safe mode activation
- **Market Automation**: Intelligent buy/sell with price history tracking
  - **Price Tracking**: Monitors market prices every 100 ticks, maintains rolling history
  - **Smart Selling**: Automatically sells excess resources when price >= 90% of average
  - **Smart Buying**: Purchases needed resources when price <= 110% of average
  - **Credit Management**: Maintains configurable minimum credit reserve (default 10k)
  - **Resource Thresholds**: Customizable buy/sell thresholds per resource type
  - **Automatic Commodity Sales**: Sells factory-produced commodities when stockpiled
  - **Trade History**: Tracks last 100 trades with profit/loss analysis
  - Console commands: `Game.kha.market()`, `Game.kha.price()`, `Game.kha.trade()`
- **Terminal Network**: Multi-room resource distribution
  - **Energy Balancing**: Automatically shares energy between colonies (surplus > 150k, deficit < 50k)
  - **Mineral Distribution**: Balances base minerals across empire for boost production
  - **Priority Queue**: Transfer requests with priority levels (10=emergency, 5=normal)
  - **Emergency Transfers**: High-priority resource transfers for colonies under threat
  - **Cost Optimization**: Calculates transfer costs, ensures sufficient energy reserves
  - **Network Monitoring**: Real-time transfer queue and colony terminal status
  - **Automatic Integration**: Works with boost production and military systems
  - Console commands: `Game.kha.network()`, `Game.kha.send()`, `Game.kha.emergency()`
- **Lab Automation**: Automatic compound production with reaction chains
- **Observer Network**: Automatic room scanning and intelligence gathering
- **Remote Mining**: Secure resource extraction with multi-layer threat detection
  - **Profitability Scoring**: Evaluates rooms based on sources, distance, safety, and controller status
  - **Automatic Room Discovery**: Scans adjacent rooms and ranks them by profitability (0-1 score)
  - **Smart Activation**: Automatically activates top 2 remote rooms based on RCL
  - **Real-time Threat Detection**: Monitors hostiles, hostile structures, and construction site griefing
  - **Automatic Defender Spawning**: Creates RemoteDefenderArbiter for rooms with detected threats
  - **Threat Level Calculation**: Scores threats based on attack/ranged/heal parts
  - **Cheap Miner Bodies**: Uses max 800 energy to minimize losses during hostile encounters
  - **Container-Based Mining**: Builds containers at sources for efficient hauling
  - **Dynamic Hauler Scaling**: 2-5 haulers per room based on distance
  - **Automatic Retreat**: Disables operations when hostiles detected, re-enables when safe
  - **Hostile Reservation Detection**: Detects and disables when enemy players reserve rooms
  - **Re-evaluation System**: Checks disabled rooms every 1000 ticks to see if safe again
  - Console commands: `Game.kha.remote()`, `Game.kha.remoteToggle()`
- **Deposit Harvesting**: Sacred pilgrimages to highway deposits
  - **Automatic Discovery**: Scans highway rooms within 7 range for deposits (biomass, silicon, metal, mist)
  - **Profitability Scoring**: Evaluates deposits based on cooldown, distance, and decay time
  - **Pilgrim Harvesters**: Creeps with up to 30 WORK parts that stay at deposit and drop resources
  - **Caravan Haulers**: 2 dedicated shuttles with 25 CARRY parts per deposit (1250 capacity each)
  - **Drop Mining**: Pilgrims continuously harvest and drop resources, Caravans shuttle them home
  - **Minimal Storage**: Pilgrims have only 3 CARRY parts (150 capacity) to maximize WORK parts
  - **Multi-Deposit Operations**: Runs up to 2 pilgrimages simultaneously
  - **Powerhouse Colonies Only**: Requires RCL 7+, 100k+ energy reserves
  - **Automatic Cleanup**: Removes fully harvested deposits from memory
  - Console commands: `Game.kha.deposits()`, `Game.kha.depositToggle()`
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
  - Console monitoring with `Game.kha.powerProcessing()`
- **Factory Automation**: Commodity production system
  - Automatically produces Level 0 and Level 1 commodities
  - Resource management via storage and terminal
  - Production prioritization based on available components
  - Tracks production statistics by commodity type
  - Console monitoring with `Game.kha.factories()`
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
  - Queue statistics and monitoring with `Game.kha.spawns()`
- **Auto-Planner**: Automated construction and layout system
  - Automatic construction site placement on RCL upgrades
  - **RCL 6 Full Automation**: Links, Labs, Terminal, Extractor + Container all placed automatically
  - Traffic-based road planning (builds roads where creeps frequently travel)
  - Defense perimeter planning with automatic ramparts on critical structures
  - Protoss Architecture layouts with hexagonal symmetry
  - Integration with RoomPlanner for optimal structure placement
  - Visualization tools for layout and traffic heatmaps
  - Console monitoring with `Game.kha.layout()`, `Game.kha.plan()`, `Game.kha.build()`
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
  - Console monitoring with `Game.kha.powerCreeps()`
- **Advanced Military System**: Squad-based combat with tactical coordination
  - **Squad Coordinator**: Formation movement with 4 formations (line, box, wedge, scatter)
  - **Combat Tactics**: 5 tactic modes (assault, siege, raid, defend, retreat)
  - **Intelligent Targeting**: Priority-based target selection for creeps and structures
  - **Role-Based Combat**: Attacker, Healer, Ranged, Tank, and Dismantler roles
  - **Formation Movement**: Units maintain tactical positions relative to squad leader
  - **Dynamic Adaptation**: Auto-retreat at 40% health, kiting for ranged units
  - **Console Control**: Launch attacks, change formations, recall units on the fly
  - **ColossusArbiter Integration**: Seamless integration with existing military system
  - Commands: `Game.kha.attack()`, `Game.kha.squads()`, `Game.kha.recall()`, `Game.kha.formation()`, `Game.kha.tactic()`
- **Boost Production System**: Automated military enhancement automation
  - **Automatic Production**: Monitors stock levels and queues boost compound production
  - **Military Mode**: Detects active combat and prioritizes military boosts
  - **Target Management**: Maintains stockpiles of Tier 3 (6k) and Tier 4 (3k) boosts
  - **Smart Prioritization**: Prioritizes XUH2O, XLHO2, XKHO2, XGHO2, XZO2 for combat
  - **Mineral Requests**: Automatically identifies missing base minerals
  - **Boost Assignment**: Automatically requests boosts for newly spawned combat creeps
  - **Integration**: Works with LabGateway, BoostGateway, and ColossusArbiter
  - **Console Monitoring**: `Game.kha.boosts()` for status, `Game.kha.militaryBoosts(true)` for aggressive mode
- Structure logic for towers, links, spawns, and terminals
- Console commands via `Game.kha.*` for monitoring and control
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
