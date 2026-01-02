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
}
