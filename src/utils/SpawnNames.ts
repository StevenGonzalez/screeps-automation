/**
 * SPAWN NAMING - Covenant-Themed Spawn Names
 * 
 * "Sacred birthing chambers of the Covenant"
 * 
 * Provides epic Covenant-themed names for spawns.
 */

export const SPAWN_NAMES = [
  // Primary spawns - Religious/Sacred sites
  'Sanctum',
  'Reliquary',
  'Shrine',
  
  // Secondary spawns - Monuments
  'Monolith',
  'Obelisk',
  'Citadel',
  
  // Tertiary spawns - Powerful structures
  'Bastion',
  'Nexus',
  'Spire',
  
  // Additional names
  'Cradle',
  'Beacon',
  'Altar',
  'Temple',
  'Vestibule',
  'Sanctum-Prime',
  'Holy-Forge',
  'Sacred-Foundry',
  'Divine-Cradle',
  'Eternal-Hearth'
];

/**
 * Get a Covenant-themed name for a spawn
 */
export function getSpawnName(roomName: string, spawnIndex: number): string {
  if (spawnIndex < SPAWN_NAMES.length) {
    return `${SPAWN_NAMES[spawnIndex]}`;
  }
  
  // Fallback for many spawns
  return `Sanctum-${spawnIndex + 1}`;
}

/**
 * Rename all spawns in a room to Covenant theme
 */
export function renameRoomSpawns(room: Room): void {
  const spawns = room.find(FIND_MY_SPAWNS);
  
  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i];
    const newName = getSpawnName(room.name, i);
    
    // Only rename if name doesn't match our theme
    if (spawn.name !== newName && !SPAWN_NAMES.includes(spawn.name)) {
      const result = spawn.room.createConstructionSite(spawn.pos, STRUCTURE_SPAWN, newName);
      if (result === OK) {
        console.log(`🔱 Renamed spawn ${spawn.name} → ${newName}`);
      }
    }
  }
}
