/**
 * BodyBuilder - Dynamic Creep Body Construction
 * 
 * Builds optimal creep bodies based on available energy, starting from minimal viable
 * configurations and scaling up with repeating patterns.
 */

export class BodyBuilder {
  /**
   * Build a body by repeating a pattern as many times as possible
   * @param pattern Array of body parts to repeat (e.g., [WORK, CARRY, MOVE])
   * @param energy Available energy
   * @param maxRepeats Maximum number of times to repeat the pattern (default: 10)
   * @returns Optimized body array
   */
  static repeat(
    pattern: BodyPartConstant[],
    energy: number,
    maxRepeats: number = 10
  ): BodyPartConstant[] {
    if (pattern.length === 0) return [];
    
    const patternCost = pattern.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    const repeats = Math.min(maxRepeats, Math.floor(energy / patternCost));
    
    if (repeats === 0) return [];
    
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < repeats; i++) {
      body.push(...pattern);
    }
    
    return body;
  }

  /**
   * Build a body with a minimum base + repeated pattern
   * @param base Minimum required parts (e.g., [WORK, CARRY, MOVE])
   * @param pattern Parts to repeat (e.g., [WORK, CARRY, MOVE])
   * @param energy Available energy
   * @param maxRepeats Maximum repeats of pattern after base
   */
  static minPlusRepeat(
    base: BodyPartConstant[],
    pattern: BodyPartConstant[],
    energy: number,
    maxRepeats: number = 10
  ): BodyPartConstant[] {
    const baseCost = base.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    
    // Not enough for minimum? Return empty (spawn will fail, arbiter should retry)
    if (energy < baseCost) return [];
    
    const remainingEnergy = energy - baseCost;
    const repeated = this.repeat(pattern, remainingEnergy, maxRepeats);
    
    const body = [...base, ...repeated];
    
    // Validate: must have at least base parts
    if (body.length < base.length) return [];
    
    return body;
  }

  /**
   * Build a balanced body (equal ratios of parts)
   * @param parts Array of part types in desired ratio (e.g., [WORK, CARRY, MOVE] = 1:1:1)
   * @param energy Available energy
   * @param maxTotal Maximum total body parts (default: 50)
   */
  static balanced(
    parts: BodyPartConstant[],
    energy: number,
    maxTotal: number = 50
  ): BodyPartConstant[] {
    const unitCost = parts.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    const maxUnits = Math.min(
      Math.floor(maxTotal / parts.length),
      Math.floor(energy / unitCost)
    );
    
    if (maxUnits === 0) return [];
    
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < maxUnits; i++) {
      body.push(...parts);
    }
    
    return body;
  }

  /**
   * Build a worker body (WORK + CARRY + MOVE in ratio)
   */
  static worker(energy: number): BodyPartConstant[] {
    // Minimum: 1W 1C 1M (200 energy)
    const base: BodyPartConstant[] = [WORK, CARRY, MOVE];
    const pattern: BodyPartConstant[] = [WORK, CARRY, MOVE];
    return this.minPlusRepeat(base, pattern, energy, 15);
  }

  /**
   * Build a hauler body (CARRY + MOVE)
   */
  static hauler(energy: number): BodyPartConstant[] {
    // Minimum: 1C 1M (100 energy)
    const base: BodyPartConstant[] = [CARRY, MOVE];
    const pattern: BodyPartConstant[] = [CARRY, MOVE];
    return this.minPlusRepeat(base, pattern, energy, 24);
  }

  /**
   * Build a miner body (WORK + MOVE)
   */
  static miner(energy: number): BodyPartConstant[] {
    // Absolute minimum: 1W 1M (150 energy)
    if (energy < 150) return [];
    
    // Scale up work parts (5-6 WORK is optimal for sources)
    const maxWork = Math.min(6, Math.floor(energy / 100));
    
    if (maxWork < 1) return [WORK, MOVE]; // Fallback to minimum
    
    const body: BodyPartConstant[] = [];
    
    // Add work parts
    for (let i = 0; i < maxWork; i++) {
      body.push(WORK);
    }
    
    // Add move parts (1 per 2 work parts, minimum 1)
    const moveCount = Math.max(1, Math.ceil(maxWork / 2));
    for (let i = 0; i < moveCount; i++) {
      body.push(MOVE);
    }
    
    return body;
  }

  /**
   * Build an upgrader body (WORK + CARRY + MOVE)
   */
  static upgrader(energy: number): BodyPartConstant[] {
    return this.worker(energy);
  }

  /**
   * Build a builder body (WORK + CARRY + MOVE)
   */
  static builder(energy: number): BodyPartConstant[] {
    return this.worker(energy);
  }

  /**
   * Build a defender body (ATTACK/RANGED_ATTACK + MOVE)
   */
  static defender(energy: number, ranged: boolean = false): BodyPartConstant[] {
    const attackPart = ranged ? RANGED_ATTACK : ATTACK;
    const attackCost = ranged ? 150 : 80;
    
    // Minimum: 1 attack + 1 move
    const baseCost = attackCost + 50;
    if (energy < baseCost) return [];
    
    const maxAttacks = Math.floor(energy / (attackCost + 50));
    const body: BodyPartConstant[] = [];
    
    for (let i = 0; i < maxAttacks && body.length < 50; i++) {
      body.push(attackPart);
      body.push(MOVE);
    }
    
    return body;
  }

  /**
   * Build a scout body (just MOVE parts for speed)
   */
  static scout(energy: number): BodyPartConstant[] {
    // Just 1 move (50 energy)
    return [MOVE];
  }

  /**
   * Get the energy cost of a body
   */
  static cost(body: BodyPartConstant[]): number {
    return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
  }
}
