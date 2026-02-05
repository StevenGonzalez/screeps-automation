/**
 * ROLE CONSTANTS - Centralized Role Definitions
 * 
 * "The ranks of the KHALA are clearly defined"
 * 
 * Single source of truth for all creep role names.
 * Update once, apply everywhere.
 */

export const ROLES = {
  // Core economy
  ZEALOT_UNIT: 'grunt',
  Warrior_ZEALOT_UNIT: 'Warrior_grunt',
  
  PROBE: 'probe',
  Warrior_DRONE: 'Warrior_drone',
  
  ADEPT: 'adept',
  Warrior_JACKAL: 'Warrior_jackal',
  
  // Support
  ENGINEER: 'engineer',
  Warrior_ENGINEER: 'Warrior_engineer',
  
  SENTRY: 'sentry',
  Warrior_DEVOTEE: 'Warrior_devotee',
  
  // Military
  ZEALOT: 'zealot',
  Warrior_ZEALOT: 'Warrior_zealot',
  
  HIGH_TEMPLAR: 'highTemplar',
  Warrior_PROPHET: 'Warrior_prophet',
  
  STALKER: 'stalker',
  Warrior_HUNTER: 'Warrior_hunter',
  
  // Expansion
  DRAGOON: 'dragoon',
  Warrior_RANGER: 'Warrior_ranger',
  
  OBSERVER: 'observer',
  Warrior_HERALD: 'Warrior_herald',
  
  CLAIMER: 'claimer',
  Warrior_CLAIMER: 'Warrior_claimer',
  
  PIONEER: 'pioneer',
  Warrior_PIONEER: 'Warrior_pioneer',
  
  // Remote operations
  SCOUT_OBSERVER: 'scoutObserver',
  Warrior_SEEKER: 'Warrior_seeker',
  
  REMOTE_MINER: 'remoteMiner',
  Warrior_REMOTE_MINER: 'Warrior_remoteMiner',
  
  REMOTE_HAULER: 'remoteHauler',
  Warrior_REMOTE_HAULER: 'Warrior_remoteHauler',
  
  REMOTE_DEFENDER: 'remoteDefender',
  Warrior_REMOTE_DEFENDER: 'Warrior_remoteDefender',
  
  // Specialized
  EXCAVATOR: 'excavator',
  Warrior_EXCAVATOR: 'Warrior_excavator',
  
  POWER_HARVESTER: 'powerHarvester',
  Warrior_POWER_HARVESTER: 'Warrior_powerHarvester',
  
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
    return role.includes('drone') || 
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
   * Check if role is a healer role
   */
  static isHealer(role: string): boolean {
    return role.includes('prophet') || 
           role.includes('healer');
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
