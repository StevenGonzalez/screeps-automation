// src/creeps/roles/upgrader.ts
import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';

export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(creep, SpawnConfig.upgrader.minToWorkFraction || 0.5, false);
  if (shouldPause) return;

  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' }, reusePath: 20 });
    }
  }
}

export default { run };
