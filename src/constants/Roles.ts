/**
 * ROLE CONSTANTS - Centralized Role Definitions
 * 
 * "The ranks of the Covenant are clearly defined"
 * 
 * Single source of truth for all creep role names.
 * Update once, apply everywhere.
 */

export const ROLES = {
  // Core economy
  GRUNT: 'grunt',
  ELITE_GRUNT: 'elite_grunt',
  
  LEKGOLO: 'lekgolo',
  ELITE_LEKGOLO: 'elite_lekgolo',
  
  JACKAL: 'jackal',
  ELITE_JACKAL: 'elite_jackal',
  
  // Support
  ENGINEER: 'engineer',
  ELITE_ENGINEER: 'elite_engineer',
  
  DEVOTEE: 'devotee',
  ELITE_DEVOTEE: 'elite_devotee',
  
  // Military
  ZEALOT: 'zealot',
  ELITE_ZEALOT: 'elite_zealot',
  
  HUNTER: 'hunter',
  ELITE_HUNTER: 'elite_hunter',
  
  // Expansion
  RANGER: 'ranger',
  ELITE_RANGER: 'elite_ranger',
  
  HERALD: 'herald',
  ELITE_HERALD: 'elite_herald',
  
  // Remote operations
  SEEKER: 'seeker',
  ELITE_SEEKER: 'elite_seeker',
  
  REMOTE_MINER: 'remoteMiner',
  ELITE_REMOTE_MINER: 'elite_remoteMiner',
  
  REMOTE_HAULER: 'remoteHauler',
  ELITE_REMOTE_HAULER: 'elite_remoteHauler',
  
  REMOTE_DEFENDER: 'remoteDefender',
  ELITE_REMOTE_DEFENDER: 'elite_remoteDefender',
  
  // Specialized
  EXCAVATOR: 'excavator',
  ELITE_EXCAVATOR: 'elite_excavator',
  
  POWER_HARVESTER: 'powerHarvester',
  ELITE_POWER_HARVESTER: 'elite_powerHarvester',
  
  // Legacy support (for backwards compatibility during transition)
  LEGACY: {
    ACOLYTE: 'acolyte',
    MINER: 'miner',
    EXTRACTOR: 'extractor',
    HAULER: 'hauler',
    STEWARD: 'steward',
    BUILDER: 'builder',
    ARTISAN: 'artisan',
    GUARDIAN: 'guardian',
    SCOUT: 'scout'
  }
} as const;

/**
 * Helper functions for role checking
 */
export class RoleHelpers {
  /**
   * Check if role is a hauler/logistics role
   */
  static isHauler(role: string): boolean {
    return role.includes('jackal') || 
           role.includes('hauler') || 
           role.includes('steward');
  }
  
  /**
   * Check if role is a miner/harvester role
   */
  static isMiner(role: string): boolean {
    return role.includes('lekgolo') || 
           role.includes('drone') || 
           role.includes('miner') || 
           role.includes('extractor');
  }
  
  /**
   * Check if role is a builder/engineer role
   */
  static isBuilder(role: string): boolean {
    return role.includes('engineer') || 
           role.includes('builder') || 
           role.includes('artisan');
  }
  
  /**
   * Check if role is a defender/military role
   */
  static isDefender(role: string): boolean {
    return role.includes('hunter') || 
           role.includes('guardian') || 
           role.includes('defender') ||
           role.includes('zealot');
  }
  
  /**
   * Check if role is a scout/reconnaissance role
   */
  static isScout(role: string): boolean {
    return role.includes('ranger') || 
           role.includes('scout');
  }
  
  /**
   * Check if role is an upgrader role
   */
  static isUpgrader(role: string): boolean {
    return role.includes('devotee') || 
           role.includes('upgrader');
  }
  
  /**
   * Check if role is a grunt/worker role
   */
  static isGrunt(role: string): boolean {
    return role.includes('grunt') || 
           role.includes('acolyte');
  }
}
