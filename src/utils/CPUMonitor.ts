/**
 * CPU MONITOR - Performance Profiling and Optimization
 * 
 * "Efficiency is the path to victory"
 * 
 * Tracks CPU usage across all systems and identifies bottlenecks.
 * Provides automatic throttling and optimization recommendations.
 */

/// <reference types="@types/screeps" />

interface CPUStats {
  total: number;
  average: number;
  peak: number;
  lastUpdate: number;
}

interface SystemStats {
  [system: string]: CPUStats;
}

export class CPUMonitor {
  private static readonly HISTORY_LENGTH = 100;
  private static readonly WARNING_THRESHOLD = 0.8; // 80% CPU usage
  private static readonly CRITICAL_THRESHOLD = 0.95; // 95% CPU usage
  
  private static get memory(): any {
    if (!(Memory as any).cpuStats) {
      (Memory as any).cpuStats = {
        systems: {},
        tickHistory: [],
        bucket: Game.cpu.bucket,
        lastPixelGeneration: 0
      };
    }
    return (Memory as any).cpuStats;
  }
  
  /**
   * Start monitoring a system
   */
  static startSystem(systemName: string): void {
    if (!this.memory.currentSystem) {
      this.memory.currentSystem = systemName;
      this.memory.systemStart = Game.cpu.getUsed();
    }
  }
  
  /**
   * End monitoring a system
   */
  static endSystem(systemName: string): void {
    if (this.memory.currentSystem === systemName && this.memory.systemStart !== undefined) {
      const used = Game.cpu.getUsed() - this.memory.systemStart;
      this.recordUsage(systemName, used);
      
      delete this.memory.currentSystem;
      delete this.memory.systemStart;
    }
  }
  
  /**
   * Record CPU usage for a system
   */
  private static recordUsage(systemName: string, cpu: number): void {
    const systems = this.memory.systems as SystemStats;
    
    if (!systems[systemName]) {
      systems[systemName] = {
        total: 0,
        average: 0,
        peak: 0,
        lastUpdate: Game.time
      };
    }
    
    const stats = systems[systemName];
    stats.total += cpu;
    stats.peak = Math.max(stats.peak, cpu);
    stats.lastUpdate = Game.time;
    
    // Calculate rolling average
    const age = Game.time - stats.lastUpdate + 1;
    stats.average = (stats.total / Math.min(age, this.HISTORY_LENGTH));
  }
  
  /**
   * Get CPU usage for a system
   */
  static getSystemUsage(systemName: string): number {
    const systems = this.memory.systems as SystemStats;
    return systems[systemName]?.average || 0;
  }
  
  /**
   * Get all system stats sorted by CPU usage
   */
  static getTopSystems(count: number = 10): Array<{name: string, avg: number, peak: number}> {
    const systems = this.memory.systems as SystemStats;
    const entries = Object.entries(systems).map(([name, stats]) => ({
      name,
      avg: stats.average,
      peak: stats.peak
    }));
    
    return entries
      .sort((a, b) => b.avg - a.avg)
      .slice(0, count);
  }
  
  /**
   * Track overall tick performance
   */
  static recordTick(cpuUsed: number): void {
    const history = this.memory.tickHistory as number[];
    history.push(cpuUsed);
    
    // Keep only recent history
    if (history.length > this.HISTORY_LENGTH) {
      history.shift();
    }
    
    this.memory.bucket = Game.cpu.bucket;
  }
  
  /**
   * Get CPU status and recommendations
   */
  static getStatus(): string {
    const limit = Game.cpu.limit;
    const bucket = Game.cpu.bucket;
    const used = Game.cpu.getUsed();
    const history = this.memory.tickHistory as number[] || [];
    
    const avgUsage = history.length > 0 
      ? history.reduce((a, b) => a + b, 0) / history.length 
      : used;
    
    const utilization = avgUsage / limit;
    
    let status = `\n⚡ CPU MONITOR\n`;
    status += `  Current: ${used.toFixed(2)}/${limit} (${(used/limit*100).toFixed(1)}%)\n`;
    status += `  Average: ${avgUsage.toFixed(2)}/${limit} (${(utilization*100).toFixed(1)}%)\n`;
    status += `  Bucket: ${bucket}/10000\n`;
    
    // Warning status
    if (utilization >= this.CRITICAL_THRESHOLD) {
      status += `  Status: 🔴 CRITICAL - Severe throttling needed!\n`;
    } else if (utilization >= this.WARNING_THRESHOLD) {
      status += `  Status: 🟡 WARNING - Consider optimizations\n`;
    } else {
      status += `  Status: 🟢 HEALTHY\n`;
    }
    
    // Top CPU consumers
    status += `\n  Top CPU Consumers:\n`;
    const topSystems = this.getTopSystems(5);
    for (const sys of topSystems) {
      status += `    ${sys.name}: ${sys.avg.toFixed(2)} avg, ${sys.peak.toFixed(2)} peak\n`;
    }
    
    // Recommendations
    if (utilization >= this.WARNING_THRESHOLD) {
      status += `\n  💡 Recommendations:\n`;
      if (bucket < 5000) {
        status += `    - Bucket low, enable emergency throttling\n`;
      }
      const pathfindingCPU = this.getSystemUsage('pathfinding');
      if (pathfindingCPU > 5) {
        status += `    - Pathfinding expensive, increase reusePath values\n`;
      }
      const visualsCPU = this.getSystemUsage('visuals');
      if (visualsCPU > 2) {
        status += `    - Visuals expensive, consider disabling\n`;
      }
    }
    
    return status;
  }
  
  /**
   * Check if we should throttle operations
   */
  static shouldThrottle(): boolean {
    const bucket = Game.cpu.bucket;
    const history = this.memory.tickHistory as number[] || [];
    const avgUsage = history.length > 0 
      ? history.reduce((a, b) => a + b, 0) / history.length 
      : Game.cpu.getUsed();
    
    const utilization = avgUsage / Game.cpu.limit;
    
    // Emergency throttling if bucket critically low
    if (bucket < 1000) return true;
    
    // Throttle if consistently over 95%
    if (utilization >= this.CRITICAL_THRESHOLD && bucket < 5000) return true;
    
    return false;
  }
  
  /**
   * Get throttle level (0 = none, 1 = light, 2 = heavy, 3 = emergency)
   */
  static getThrottleLevel(): number {
    const bucket = Game.cpu.bucket;
    const history = this.memory.tickHistory as number[] || [];
    const avgUsage = history.length > 0 
      ? history.reduce((a, b) => a + b, 0) / history.length 
      : Game.cpu.getUsed();
    
    const utilization = avgUsage / Game.cpu.limit;
    
    // Check if we just generated a pixel (within last 10 ticks)
    // If so, be more lenient with throttling as the bucket drop is intentional
    const recentPixelGeneration = (Game.time - this.memory.lastPixelGeneration) < 10;
    
    // Emergency: Bucket critically low (but not from pixel generation)
    if (bucket < 100 && !recentPixelGeneration) return 3;
    
    // Heavy: Bucket low + high CPU (but not from pixel generation)
    if (bucket < 1000 && utilization >= 0.9 && !recentPixelGeneration) return 2;
    
    // Light: Approaching limits
    if (bucket < 5000 && utilization >= 0.85 && !recentPixelGeneration) return 1;
    
    return 0;
  }
  
  /**
   * Mark that a pixel was just generated (to avoid false throttling)
   */
  static markPixelGeneration(): void {
    this.memory.lastPixelGeneration = Game.time;
  }
  
  /**
   * Reset statistics (useful for testing)
   */
  static reset(): void {
    delete (Memory as any).cpuStats;
  }
  
  /**
   * Wrap a function with CPU monitoring
   */
  static wrap<T extends (...args: any[]) => any>(
    systemName: string,
    fn: T
  ): T {
    return ((...args: any[]) => {
      CPUMonitor.startSystem(systemName);
      try {
        return fn(...args);
      } finally {
        CPUMonitor.endSystem(systemName);
      }
    }) as T;
  }
}
