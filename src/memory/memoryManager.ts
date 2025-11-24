// src/memory/memoryManager.ts
// MemoryManager: Efficient, batched, and type-safe Memory access for Screeps

export class MemoryManager {
  private static cache: Record<string, any> = {};
  private static dirty: Set<string> = new Set();
  private static scheduled: Record<string, number> = {};
  private static toDelete: Set<string> = new Set();

  // Get a value from Memory, using a dotted path (e.g., 'rooms.W1N1.plan')
  static get<T>(path: string, fallback?: T): T | undefined {
    if (path in this.cache) return this.cache[path];
    const value = path.split('.').reduce<any>((acc, key) => acc && acc[key], Memory);
    this.cache[path] = value !== undefined ? value : fallback;
    return this.cache[path];
  }

  // Set a value in Memory (marks as dirty, but does not immediately write)
  static set<T>(path: string, value: T): void {
    this.cache[path] = value;
    this.dirty.add(path);
  }

  static has(path: string): boolean {
    if (path in this.cache) return this.cache[path] !== undefined;
    const value = path.split('.').reduce<any>((acc, key) => acc && acc[key], Memory);
    return value !== undefined;
  }

  // Update a value in Memory using a mutator function
  static update<T>(path: string, mutator: (curr: T | undefined) => T): void {
    const curr = this.get<T>(path);
    this.set(path, mutator(curr));
  }

  static remove(path: string): void {
    delete this.cache[path];
    this.toDelete.add(path);
    this.dirty.add(path);
  }

  static scheduleSave(path: string, delayTicks = 1): void {
    const due = (Game.time || 0) + Math.max(1, delayTicks);
    this.scheduled[path] = due;
    this.dirty.add(path);
  }

  static readSegment(id: number): any {
    try {
      if (!('RawMemory' in globalThis)) return null;
      const seg = (RawMemory as any).segments && (RawMemory as any).segments[id];
      if (!seg) return null;
      return JSON.parse(seg);
    } catch (err) {
      console.log('MemoryManager.readSegment error: ' + err);
      return null;
    }
  }

  static writeSegment(id: number, data: any): void {
    try {
      if (!('RawMemory' in globalThis)) return;
      (RawMemory as any).segments = (RawMemory as any).segments || {};
      (RawMemory as any).segments[id] = JSON.stringify(data);
    } catch (err) {
      console.log('MemoryManager.writeSegment error: ' + err);
    }
  }

  // Write all dirty values back to Memory (call once per tick)
  static flush(): void {
    const now = Game.time || 0;
    for (const path of this.dirty) {
      const due = this.scheduled[path];
      if (due && due > now) continue;

      const keys = path.split('.');
      let obj: any = Memory;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }

      if (this.toDelete.has(path)) {
        delete obj[keys[keys.length - 1]];
        this.toDelete.delete(path);
      } else {
        obj[keys[keys.length - 1]] = this.cache[path];
      }
      delete this.scheduled[path];
      this.dirty.delete(path);
    }
  }

  // Clear cache (call at start of tick)
  static reset(): void {
    this.cache = {};
    this.dirty.clear();
  }
}
