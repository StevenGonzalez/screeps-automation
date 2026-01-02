/**
 * CONSOLE COMMANDS - Global Debugging Tools
 * 
 * "The Hierarchs speak, and all shall listen"
 * 
 * Provides console commands for monitoring, debugging, and
 * controlling the Covenant system from the in-game console.
 */

/// <reference types="@types/screeps" />

import { Profiler } from './Profiler';
import { CacheSystem } from './CacheSystem';
import { Covenant } from '../core/Covenant';

/**
 * Global console commands accessible via Game.cov
 */
export class CovenantCommands {
  private covenant: Covenant;
  
  constructor(covenant: Covenant) {
    this.covenant = covenant;
  }
  
  /**
   * Show CPU profile report
   * Usage: Game.cov.profile()
   */
  profile(minCpu: number = 0.1): void {
    Profiler.report(minCpu);
  }
  
  /**
   * Reset all profiling data
   * Usage: Game.cov.resetProfile()
   */
  resetProfile(): void {
    Profiler.resetAll();
    console.log('✅ All profiling data reset');
  }
  
  /**
   * Show cache statistics
   * Usage: Game.cov.cacheStats()
   */
  cacheStats(): void {
    const stats = CacheSystem.getStats();
    console.log('═══════════════════════════════════════════════════════');
    console.log('💾 CACHE STATISTICS');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Total entries: ${stats.size}`);
    console.log(`Entries: ${stats.entries.slice(0, 20).join(', ')}${stats.size > 20 ? '...' : ''}`);
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Clear all caches
   * Usage: Game.cov.clearCache()
   */
  clearCache(): void {
    CacheSystem.clear();
    console.log('✅ All caches cleared');
  }
  
  /**
   * Show current CPU budget status
   * Usage: Game.cov.cpuStatus()
   */
  cpuStatus(): void {
    const used = Game.cpu.getUsed();
    const limit = Game.cpu.limit;
    const bucket = Game.cpu.bucket;
    const remaining = Profiler.getRemainingBudget();
    const percentage = ((used / limit) * 100).toFixed(1);
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚡ CPU STATUS');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Used: ${used.toFixed(2)} / ${limit} (${percentage}%)`);
    console.log(`Remaining: ${remaining.toFixed(2)}`);
    console.log(`Bucket: ${bucket} / 10000`);
    console.log(`Over budget: ${Profiler.isOverBudget() ? '❌ YES' : '✅ NO'}`);
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show top CPU consumers
   * Usage: Game.cov.topCpu(10)
   */
  topCpu(count: number = 10): void {
    const consumers = Profiler.getTopConsumers(count);
    
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🔥 TOP ${count} CPU CONSUMERS`);
    console.log('═══════════════════════════════════════════════════════');
    
    for (let i = 0; i < consumers.length; i++) {
      const consumer = consumers[i];
      console.log(`${i + 1}. ${consumer.name}: ${consumer.cpu.toFixed(3)} CPU`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show colony status for a room
   * Usage: Game.cov.colony('W1N1')
   */
  colony(roomName: string): void {
    const charity = this.covenant.highCharities[roomName];
    if (!charity) {
      console.log(`❌ No colony found in ${roomName}`);
      return;
    }
    
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🏛️ ${charity.print}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log(`RCL: ${charity.level}`);
    console.log(`Phase: ${charity.memory.phase}`);
    console.log(`Creeps: ${charity.elites.length}`);
    console.log(`Arbiters: ${Object.keys(charity.arbiters).length}`);
    console.log(`Temples: ${Object.keys(charity.temples).length}`);
    console.log(`Energy: ${charity.energyAvailable} / ${charity.energyCapacity}`);
    console.log(`Spawns: ${charity.spawns.length}`);
    console.log(`Extensions: ${charity.extensions.length}`);
    console.log(`Towers: ${charity.towers.length}`);
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * List all High Charities
   * Usage: Game.cov.colonies()
   */
  colonies(): void {
    const charities = Object.values(this.covenant.highCharities);
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('🏛️ HIGH CHARITIES');
    console.log('═══════════════════════════════════════════════════════');
    
    for (const charity of charities) {
      console.log(
        `${charity.print} - RCL${charity.level} ${charity.memory.phase} - ` +
        `${charity.elites.length} creeps - ` +
        `Energy: ${charity.energyAvailable}/${charity.energyCapacity}`
      );
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show war status and targets
   * Usage: Game.cov.war()
   */
  war(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚔️ WAR COUNCIL STATUS');
    console.log('═══════════════════════════════════════════════════════');
    
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity || charity.memory.phase !== 'powerhouse') continue;
      
      const status = charity.warCouncil.getStatus();
      console.log(`\n🏛️ ${charity.name}:`);
      console.log(`   Targets identified: ${status.targets}`);
      console.log(`   Active squads: ${status.activeSquads}`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show power harvesting status
   * Usage: Game.cov.power()
   */
  power(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚡ POWER HARVESTING STATUS');
    console.log('═══════════════════════════════════════════════════════');
    
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity || !charity.powerTemple) continue;
      
      const temple = charity.powerTemple;
      const targets = temple.getAvailableTargets();
      const best = temple.getBestTarget();
      
      console.log(`\n🏛️ ${charity.name}:`);
      console.log(`   RCL: ${charity.level}`);
      console.log(`   Ready: ${temple.isReady ? '✅' : '❌'}`);
      console.log(`   Power Banks found: ${targets.length}`);
      
      if (best) {
        console.log(`   Best target: ${best.roomName}`);
        console.log(`   Power: ${best.power}`);
        console.log(`   Decay: ${best.decayTime} ticks`);
        console.log(`   Distance: ${best.distance} rooms`);
      }
      
      // Show power processing
      const powerSpawn = charity.room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_POWER_SPAWN
      })[0] as StructurePowerSpawn | undefined;
      
      if (powerSpawn && charity.storage) {
        const power = charity.storage.store.getUsedCapacity(RESOURCE_POWER) || 0;
        console.log(`   Storage Power: ${power}`);
        console.log(`   Power Spawn: ${powerSpawn.store[RESOURCE_POWER]}/${powerSpawn.store[RESOURCE_ENERGY]}`);
      }
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show market and trading status
   * Usage: Game.cov.market() or Game.cov.market('W1N1')
   */
  market(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('💰 MARKET STATUS');
    console.log('═══════════════════════════════════════════════════════');
    
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity || !charity.terminal) continue;
      
      console.log(`\n${charity.marketManager.getStats()}`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Get price report for a resource
   * Usage: Game.cov.price('energy') or Game.cov.price('power', 'W1N1')
   */
  price(resource: ResourceConstant, roomName?: string): void {
    const targetRoom = roomName || Object.keys(this.covenant.highCharities)[0];
    const charity = this.covenant.highCharities[targetRoom];
    
    if (!charity || !charity.terminal) {
      console.log(`❌ No terminal in ${targetRoom}`);
      return;
    }
    
    console.log('═══════════════════════════════════════════════════════');
    console.log(charity.marketManager.getPriceReport(resource));
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Control market auto-trading
   * Usage: Game.cov.trade('W1N1', true) - Enable
   *        Game.cov.trade('W1N1', false) - Disable
   */
  trade(roomName: string, enable?: boolean): void {
    const charity = this.covenant.highCharities[roomName];
    if (!charity || !charity.terminal) {
      console.log(`❌ No terminal in ${roomName}`);
      return;
    }
    
    if (enable === undefined) {
      // Toggle
      const current = charity.marketManager.memory.autoTradeEnabled;
      charity.marketManager.setAutoTrade(!current);
    } else {
      charity.marketManager.setAutoTrade(enable);
    }
  }
  
  /**
   * Show lab production status
   * Usage: Game.cov.labs() or Game.cov.labs('W1N1')
   */
  labs(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚗️ LAB STATUS');
    console.log('═══════════════════════════════════════════════════════');
    
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity || !charity.labTemple) continue;
      
      const temple = charity.labTemple;
      const memory = temple.memory as any;
      
      console.log(`\n📍 ${charity.name}`);
      console.log(`  Labs: ${temple.labs.length} (${temple.inputLabs.length} input, ${temple.outputLabs.length} output)`);
      console.log(`  Auto-production: ${memory.autoProduction !== false ? '✅ Enabled' : '❌ Disabled'}`);
      
      if (memory.currentReaction) {
        console.log(`  Current: ${memory.currentReaction.amount}x ${memory.currentReaction.product}`);
      } else {
        console.log(`  Current: None`);
      }
      
      const queue = memory.reactionQueue || [];
      console.log(`  Queue: ${queue.length} reactions`);
      if (queue.length > 0) {
        for (let i = 0; i < Math.min(3, queue.length); i++) {
          const task = queue[i];
          console.log(`    ${i + 1}. ${task.amount}x ${task.product}`);
        }
        if (queue.length > 3) {
          console.log(`    ... and ${queue.length - 3} more`);
        }
      }
      
      // Show top compound stocks
      const storage = charity.storage;
      if (storage) {
        console.log(`  Top compounds:`);
        const compounds = ['XUH2O', 'XUHO2', 'XKHO2', 'XLH2O', 'XLHO2', 'XZH2O', 'XZHO2', 'XGH2O', 'XGHO2'];
        for (const compound of compounds.slice(0, 5)) {
          const amount = storage.store.getUsedCapacity(compound as ResourceConstant) || 0;
          if (amount > 0) {
            console.log(`    ${compound}: ${amount.toLocaleString()}`);
          }
        }
      }
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Queue a compound for production
   * Usage: Game.cov.produce('XUH2O', 3000) or Game.cov.produce('XUH2O', 3000, 'W1N1')
   */
  produce(compound: MineralCompoundConstant, amount: number, roomName?: string): void {
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity || !charity.labTemple) continue;
      
      charity.labTemple.queueReaction(compound, amount);
      console.log(`✅ Queued ${amount}x ${compound} in ${charity.name}`);
    }
  }
  
  /**
   * Control automatic lab production
   * Usage: Game.cov.autoLabs('W1N1', true) - Enable
   *        Game.cov.autoLabs('W1N1', false) - Disable
   *        Game.cov.autoLabs('W1N1') - Toggle
   */
  autoLabs(roomName: string, enable?: boolean): void {
    const charity = this.covenant.highCharities[roomName];
    if (!charity || !charity.labTemple) {
      console.log(`❌ No lab temple found in ${roomName}`);
      return;
    }
    
    const memory = charity.labTemple.memory as any;
    if (enable === undefined) {
      // Toggle
      const current = memory.autoProduction !== false;
      memory.autoProduction = !current;
      console.log(`${!current ? '✅ Enabled' : '❌ Disabled'} auto-production in ${roomName}`);
    } else {
      memory.autoProduction = enable;
      console.log(`${enable ? '✅ Enabled' : '❌ Disabled'} auto-production in ${roomName}`);
    }
  }
  
  /**
   * Show intel on a specific room or all scanned rooms
   * Usage: Game.cov.intel('W1N1') or Game.cov.intel()
   */
  intel(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔍 INTELLIGENCE REPORT');
    console.log('═══════════════════════════════════════════════════════');
    
    if (roomName) {
      // Show specific room intel
      const intel = this.covenant.observerNetwork.getIntel(roomName);
      if (!intel) {
        console.log(`❌ No intel available for ${roomName}`);
        return;
      }
      
      console.log(`\n📍 ${intel.roomName}`);
      console.log(`  Scanned: ${Game.time - intel.scannedAt} ticks ago`);
      
      if (intel.owner) {
        console.log(`  Owner: ${intel.owner} (RCL ${intel.level})`);
        if (intel.safeMode) {
          console.log(`  Safe Mode: ${intel.safeMode} ticks remaining`);
        }
      } else {
        console.log(`  Owner: None (unclaimed)`);
      }
      
      console.log(`  Sources: ${intel.sources?.length || 0}`);
      if (intel.mineral) {
        console.log(`  Mineral: ${intel.mineral.type} (${intel.mineral.amount.toLocaleString()})`);
      }
      
      console.log(`  Structures: ${intel.spawns || 0} spawns, ${intel.extensions || 0} ext, ${intel.labs || 0} labs`);
      console.log(`  Defense: ${intel.hostileTowers || 0} towers, ${intel.ramparts || 0} ramparts`);
      console.log(`  Economy: ${intel.storage ? '✓' : '✗'} storage, ${intel.terminal ? '✓' : '✗'} terminal`);
      
      if (intel.hostileCreeps && intel.hostileCreeps > 0) {
        console.log(`  ⚠️ Hostile creeps: ${intel.hostileCreeps}`);
      }
      
      console.log(`  Score: ${intel.score}/100`);
      console.log(`  Threat: ${intel.threat}/10`);
    } else {
      // Show top 10 rooms by score
      const allIntel = this.covenant.observerNetwork.getAllIntel().slice(0, 10);
      
      if (allIntel.length === 0) {
        console.log('No intel data available. Build observers to scan rooms.');
        return;
      }
      
      console.log('\nTop scanned rooms:');
      for (let i = 0; i < allIntel.length; i++) {
        const intel = allIntel[i];
        const owner = intel.owner || 'unclaimed';
        const age = Math.floor((Game.time - intel.scannedAt) / 100) / 10;
        console.log(`  ${i + 1}. ${intel.roomName} - Score: ${intel.score}, Threat: ${intel.threat}, Owner: ${owner} (${age}k ticks)`);
      }
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show rooms suitable for expansion
   * Usage: Game.cov.expand()
   */
  expand(): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🏗️ EXPANSION CANDIDATES');
    console.log('═══════════════════════════════════════════════════════');
    
    const candidates = this.covenant.observerNetwork.getExpansionCandidates().slice(0, 10);
    
    if (candidates.length === 0) {
      console.log('No expansion candidates found. Scan more rooms.');
      return;
    }
    
    for (let i = 0; i < candidates.length; i++) {
      const intel = candidates[i];
      console.log(`\n${i + 1}. ${intel.roomName} (Score: ${intel.score})`);
      console.log(`   Sources: ${intel.sources?.length || 0}`);
      if (intel.mineral) {
        console.log(`   Mineral: ${intel.mineral.type}`);
      }
      console.log(`   Threat: ${intel.threat}/10`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show detected threats
   * Usage: Game.cov.threats()
   */
  threats(): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚔️ DETECTED THREATS');
    console.log('═══════════════════════════════════════════════════════');
    
    const threats = this.covenant.observerNetwork.getThreats(5);
    
    if (threats.length === 0) {
      console.log('✅ No significant threats detected.');
      return;
    }
    
    for (const intel of threats) {
      console.log(`\n⚠️ ${intel.roomName} - Threat Level: ${intel.threat}/10`);
      if (intel.owner) {
        console.log(`   Owner: ${intel.owner} (RCL ${intel.level})`);
      }
      console.log(`   Hostiles: ${intel.hostileCreeps || 0} creeps`);
      console.log(`   Defense: ${intel.hostileTowers || 0} towers, ${intel.ramparts || 0} ramparts`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show remote mining operations
   * Usage: Game.cov.remote() or Game.cov.remote('W1N1')
   */
  remote(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🌍 REMOTE OPERATIONS');
    console.log('═══════════════════════════════════════════════════════');
    
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity) continue;
      
      console.log(charity.remoteOperations.getStatus());
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Control remote mining for a specific room
   * Usage: Game.cov.remoteToggle('W1N1', 'W2N1', true)
   */
  remoteToggle(homeRoom: string, remoteRoom: string, enable: boolean): void {
    const charity = this.covenant.highCharities[homeRoom];
    if (!charity) {
      console.log(`❌ No colony found in ${homeRoom}`);
      return;
    }
    
    charity.remoteOperations.setRemoteRoomActive(remoteRoom, enable);
  }
  
  /**
   * Show help for all commands
   * Usage: Game.cov.help()
   */
  help(): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('📚 COVENANT CONSOLE COMMANDS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('Game.cov.profile(minCpu) - Show CPU profile report');
    console.log('Game.cov.resetProfile() - Reset profiling data');
    console.log('Game.cov.cacheStats() - Show cache statistics');
    console.log('Game.cov.clearCache() - Clear all caches');
    console.log('Game.cov.cpuStatus() - Show CPU budget status');
    console.log('Game.cov.topCpu(count) - Show top CPU consumers');
    console.log('Game.cov.colony(room) - Show colony status');
    console.log('Game.cov.colonies() - List all colonies');
    console.log('Game.cov.war(room?) - Show war targets and squads');
    console.log('Game.cov.power(room?) - Show power harvesting status');
    console.log('Game.cov.showPlan(room?) - Visualize base layout (toggle)');
    console.log('Game.cov.defense(room?) - Show defense and threat status');
    console.log('Game.cov.safeMode(room, enable?) - Control auto safe mode');
    console.log('Game.cov.market(room?) - Show trading statistics');
    console.log('Game.cov.price(resource, room?) - Show price report');
    console.log('Game.cov.trade(room, enable?) - Control auto-trading');
    console.log('Game.cov.labs(room?) - Show lab production status');
    console.log('Game.cov.produce(compound, amount, room?) - Queue compound');
    console.log('Game.cov.autoLabs(room, enable?) - Control auto-production');
    console.log('Game.cov.intel(room?) - Show room intelligence');
    console.log('Game.cov.expand() - Show expansion candidates');
    console.log('Game.cov.threats() - Show detected threats');
    console.log('Game.cov.remote(room?) - Show remote mining ops');
    console.log('Game.cov.remoteToggle(home, remote, enable) - Control remote mining');
    console.log('Game.cov.help() - Show this help');
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Show defense and threat status
   * Usage: Game.cov.defense() or Game.cov.defense('W1N1')
   */
  defense(roomName?: string): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🛡️ DEFENSE STATUS');
    console.log('═══════════════════════════════════════════════════════');
    
    const charities = roomName ? 
      [this.covenant.highCharities[roomName]] : 
      Object.values(this.covenant.highCharities);
    
    for (const charity of charities) {
      if (!charity) continue;
      
      console.log(`\n${charity.safeModeManager.getStatus()}`);
      
      // Show rampart status
      const ramparts = charity.defenseTemple.getRampartsNeedingRepair();
      const walls = charity.defenseTemple.getWallsNeedingRepair();
      
      console.log(`  Ramparts needing repair: ${ramparts.length}`);
      console.log(`  Walls needing repair: ${walls.length}`);
      
      if (ramparts.length > 0) {
        const weakest = ramparts[0];
        console.log(`  Weakest rampart: ${weakest.hits.toLocaleString()} HP`);
      }
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Control automatic safe mode activation
   * Usage: Game.cov.safeMode('W1N1', true) - Enable
   *        Game.cov.safeMode('W1N1', false) - Disable
   *        Game.cov.safeMode('W1N1') - Toggle
   */
  safeMode(roomName: string, enable?: boolean): void {
    const charity = this.covenant.highCharities[roomName];
    if (!charity) {
      console.log(`❌ No colony found in ${roomName}`);
      return;
    }
    
    if (enable === undefined) {
      // Toggle
      const current = charity.safeModeManager.memory.autoSafeModeEnabled;
      charity.safeModeManager.setAutoSafeMode(!current);
    } else {
      charity.safeModeManager.setAutoSafeMode(enable);
    }
  }
  
  /**
   * Toggle base plan visualization
   * Usage: Game.cov.showPlan() or Game.cov.showPlan('W1N1')
   */
  showPlan(roomName?: string): void {
    if (!Memory.covenant) Memory.covenant = {};
    if (!Memory.covenant.visualize) Memory.covenant.visualize = {};
    
    if (roomName) {
      // Toggle for specific room
      const current = Memory.covenant.visualize![roomName] || false;
      Memory.covenant.visualize![roomName] = !current;
      console.log(`${!current ? '✅ Enabled' : '❌ Disabled'} base plan visualization for ${roomName}`);
    } else {
      // Toggle for all rooms
      const charities = Object.values(this.covenant.highCharities);
      const anyEnabled = charities.some(c => Memory.covenant?.visualize?.[c.name]);
      
      for (const charity of charities) {
        Memory.covenant.visualize![charity.name] = !anyEnabled;
      }
      console.log(`${!anyEnabled ? '✅ Enabled' : '❌ Disabled'} base plan visualization for all rooms`);
    }
  }
  
  /**
   * Show expansion status
   * Usage: Game.cov.expansion()
   */
  expansion(): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀 EXPANSION STATUS');
    console.log('═══════════════════════════════════════════════════════');
    
    const currentTarget = this.covenant.reclaimationCouncil.getStatus();
    
    if (currentTarget) {
      console.log(`\n📍 Current Target: ${currentTarget.roomName}`);
      console.log(`   Status: ${currentTarget.status}`);
      console.log(`   Score: ${currentTarget.score}/100`);
      console.log(`   Sources: ${currentTarget.sources}`);
      console.log(`   Mineral: ${currentTarget.mineral || 'unknown'}`);
      console.log(`   Distance: ${currentTarget.distance} rooms`);
      console.log(`   Claiming from: ${currentTarget.claimingFrom}`);
      console.log(`   Started: ${currentTarget.claimedAt ? Game.time - currentTarget.claimedAt : 0} ticks ago`);
    } else {
      console.log('\nNo active expansion');
      
      // Show top expansion candidates
      const candidates = this.covenant.observerNetwork.getExpansionCandidates().slice(0, 5);
      if (candidates.length > 0) {
        console.log('\n🎯 Top Expansion Candidates:');
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          console.log(`${i + 1}. ${candidate.roomName} (Score: ${candidate.score}/100, ${candidate.sources?.length || 0} sources)`);
        }
      }
    }
    
    // Show history
    const history = this.covenant.reclaimationCouncil.getHistory();
    if (history.length > 0) {
      console.log('\n📜 Expansion History:');
      for (const entry of history.slice(-5)) {
        const status = entry.success ? '✅' : '❌';
        console.log(`${status} ${entry.roomName} (${Game.time - entry.claimedAt} ticks ago)`);
      }
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Cancel current expansion
   * Usage: Game.cov.cancelExpansion()
   */
  cancelExpansion(): void {
    this.covenant.reclaimationCouncil.cancelExpansion();
  }
  
  /**
   * Show terminal network status
   * Usage: Game.cov.network()
   */
  network(): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🌐 TERMINAL NETWORK');
    console.log('═══════════════════════════════════════════════════════');
    
    const stats = this.covenant.terminalNetwork.getStatistics();
    const pending = this.covenant.terminalNetwork.getPendingTransfers();
    
    console.log(`\n📊 Statistics:`);
    console.log(`  Total transfers: ${stats.totalTransfers}`);
    console.log(`  Energy shared: ${stats.energyShared.toLocaleString()}`);
    console.log(`  Minerals shared: ${stats.mineralsShared.toLocaleString()}`);
    console.log(`  Compounds shared: ${stats.compoundsShared.toLocaleString()}`);
    
    if (pending.length > 0) {
      console.log(`\n📦 Pending Transfers (${pending.length}):`);
      for (const transfer of pending.slice(0, 10)) {
        console.log(`  ${transfer.from} → ${transfer.to}: ${transfer.amount} ${transfer.resourceType}`);
      }
      if (pending.length > 10) {
        console.log(`  ... and ${pending.length - 10} more`);
      }
    } else {
      console.log(`\nNo pending transfers`);
    }
    
    // Show terminal status for each colony
    console.log(`\n🏛️ Colony Terminal Status:`);
    for (const roomName in this.covenant.highCharities) {
      const charity = this.covenant.highCharities[roomName];
      if (!charity.terminal) continue;
      
      const energy = charity.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      const capacity = charity.terminal.store.getCapacity();
      const used = charity.terminal.store.getUsedCapacity();
      const cooldown = charity.terminal.cooldown || 0;
      
      console.log(`  ${roomName}: ${energy.toLocaleString()} energy, ${used.toLocaleString()}/${capacity.toLocaleString()} used, cooldown ${cooldown}`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Force emergency energy transfer
   * Usage: Game.cov.sendEnergy('W1N1', 20000)
   */
  sendEnergy(targetRoom: string, amount: number = 20000): void {
    this.covenant.terminalNetwork.forceEnergyTransfer(targetRoom, amount);
    console.log(`✅ Scheduled emergency energy transfer to ${targetRoom}`);
  }
}
