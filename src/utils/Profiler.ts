/**
 * PROFILER - CPU Performance Monitoring
 * 
 * "Measure the efficiency of the Great Journey"
 * 
 * Tracks CPU usage across systems to identify bottlenecks
 * and optimize performance for multi-room scaling.
 */

/// <reference types="@types/screeps" />

interface ProfileEntry {
  calls: number;
  totalCpu: number;
  avgCpu: number;
  maxCpu: number;
  minCpu: number;
}

/**
 * CPU profiling system for performance monitoring
 */
export class Profiler {
  private static profiles: { [key: string]: ProfileEntry } = {};
  private static stack: Array<{ name: string; start: number }> = [];
  
  /**
   * Start profiling a section
   */
  static start(name: string): void {
    this.stack.push({
      name,
      start: Game.cpu.getUsed()
    });
  }
  
  /**
   * End profiling a section
   */
  static end(name: string): void {
    const entry = this.stack.pop();
    if (!entry || entry.name !== name) {
      console.log(`⚠️ Profiler mismatch: expected ${name}, got ${entry?.name}`);
      return;
    }
    
    const cpu = Game.cpu.getUsed() - entry.start;
    
    // Initialize profile entry if needed
    if (!this.profiles[name]) {
      this.profiles[name] = {
        calls: 0,
        totalCpu: 0,
        avgCpu: 0,
        maxCpu: 0,
        minCpu: Infinity
      };
    }
    
    // Update profile
    const profile = this.profiles[name];
    profile.calls++;
    profile.totalCpu += cpu;
    profile.avgCpu = profile.totalCpu / profile.calls;
    profile.maxCpu = Math.max(profile.maxCpu, cpu);
    profile.minCpu = Math.min(profile.minCpu, cpu);
  }
  
  /**
   * Profile a function execution
   */
  static wrap<T>(name: string, fn: () => T): T {
    this.start(name);
    const result = fn();
    this.end(name);
    return result;
  }
  
  /**
   * Profile an async function execution
   */
  static async wrapAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    const result = await fn();
    this.end(name);
    return result;
  }
  
  /**
   * Get profile data for specific section
   */
  static get(name: string): ProfileEntry | undefined {
    return this.profiles[name];
  }
  
  /**
   * Get all profile data
   */
  static getAll(): { [key: string]: ProfileEntry } {
    return this.profiles;
  }
  
  /**
   * Reset specific profile
   */
  static reset(name: string): void {
    delete this.profiles[name];
  }
  
  /**
   * Reset all profiles
   */
  static resetAll(): void {
    this.profiles = {};
  }
  
  /**
   * Print profile report to console
   */
  static report(minCpu: number = 0.1): void {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔍 CPU PROFILE REPORT');
    console.log('═══════════════════════════════════════════════════════');
    
    // Sort by total CPU usage
    const sorted = Object.entries(this.profiles)
      .filter(([_, p]) => p.avgCpu >= minCpu)
      .sort((a, b) => b[1].totalCpu - a[1].totalCpu);
    
    for (const [name, profile] of sorted) {
      console.log(
        `📊 ${name}:\n` +
        `   Avg: ${profile.avgCpu.toFixed(3)} CPU\n` +
        `   Total: ${profile.totalCpu.toFixed(2)} CPU\n` +
        `   Calls: ${profile.calls}\n` +
        `   Min: ${profile.minCpu.toFixed(3)} | Max: ${profile.maxCpu.toFixed(3)}`
      );
    }
    
    console.log('═══════════════════════════════════════════════════════');
  }
  
  /**
   * Get top CPU consumers
   */
  static getTopConsumers(count: number = 10): Array<{ name: string; cpu: number }> {
    return Object.entries(this.profiles)
      .map(([name, profile]) => ({ name, cpu: profile.totalCpu }))
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, count);
  }
  
  /**
   * Check if current tick is over CPU limit
   */
  static isOverBudget(limit: number = Game.cpu.limit): boolean {
    return Game.cpu.getUsed() > limit;
  }
  
  /**
   * Get remaining CPU budget for this tick
   */
  static getRemainingBudget(limit: number = Game.cpu.limit): number {
    return Math.max(0, limit - Game.cpu.getUsed());
  }
  
  /**
   * Check if we have enough CPU budget for an operation
   */
  static hasBudget(estimatedCpu: number, limit: number = Game.cpu.limit): boolean {
    return this.getRemainingBudget(limit) >= estimatedCpu;
  }
}

/**
 * Tick budget manager for distributed processing
 */
export class TickBudget {
  private static readonly DEFAULT_LIMIT = 0.8; // Use 80% of limit by default
  
  /**
   * Check if we should skip expensive operations this tick
   */
  static shouldSkipExpensive(threshold: number = 0.8): boolean {
    const used = Game.cpu.getUsed();
    const limit = Game.cpu.limit * this.DEFAULT_LIMIT;
    return used > limit * threshold;
  }
  
  /**
   * Distribute work across multiple ticks
   */
  static *distributeWork<T>(
    items: T[],
    maxCpuPerTick: number
  ): Generator<T, void, unknown> {
    for (const item of items) {
      const startCpu = Game.cpu.getUsed();
      
      yield item;
      
      const cpuUsed = Game.cpu.getUsed() - startCpu;
      if (cpuUsed > maxCpuPerTick) {
        return; // Stop processing this tick
      }
    }
  }
  
  /**
   * Process items with CPU budget limit
   */
  static processWithBudget<T>(
    items: T[],
    processor: (item: T) => void,
    maxCpuPerItem: number = 0.5
  ): number {
    let processed = 0;
    
    for (const item of items) {
      if (!Profiler.hasBudget(maxCpuPerItem)) {
        break;
      }
      
      processor(item);
      processed++;
    }
    
    return processed;
  }
}
