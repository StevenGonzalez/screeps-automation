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
    console.log('Game.cov.help() - Show this help');
    console.log('═══════════════════════════════════════════════════════');
  }
}
