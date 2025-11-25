// src/creeps/roleState.ts
import { acquireEnergy } from './behaviors/energy';

export type RoleState = 'acquire' | 'work';

// Returns true if the role should stop processing this tick because the creep
// is still acquiring energy. Returns false when the role should continue to
// perform its work behavior (i.e. creep is in 'work' state or has enough energy).
export function handleAcquireWork(creep: Creep, minToWorkFraction: number, preferHarvest = false): boolean {
  if (!(creep.memory as any).state) (creep.memory as any).state = 'acquire';
  const state = (creep.memory as any).state as RoleState;

  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
  const capacity = Math.max(1, used + free);
  const minToWork = Math.ceil((minToWorkFraction || 0.5) * capacity);

  if (state === 'acquire') {
    const res = acquireEnergy(creep, { preferHarvest });
    const nowHas = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const isFull = free === 0;
    
    // Only switch to work if: full, OR no more energy sources available AND we have enough to work
    if (isFull || (res === 'none' && nowHas >= minToWork)) {
      (creep.memory as any).state = 'work';
      return false;
    }
    return true;
  }

  // state === 'work'
  if (used === 0) {
    // switch back to acquiring and attempt an acquire immediately
    (creep.memory as any).state = 'acquire';
    const res = acquireEnergy(creep, { preferHarvest });
    if (res !== 'none') return true;
  }

  return false;
}

export default { handleAcquireWork };
