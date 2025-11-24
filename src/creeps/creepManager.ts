// src/creeps/creepManager.ts
import { run as harvesterRun } from './roles/harvester';
import { run as upgraderRun } from './roles/upgrader';

export class CreepManager {
  run() {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const role = creep.memory.role || 'harvester';
      try {
        switch (role) {
          case 'harvester':
            harvesterRun(creep);
            break;
          case 'upgrader':
            upgraderRun(creep);
            break;
          default:
            harvesterRun(creep);
            break;
        }
      } catch (err) {
        console.log(`Creep ${name} role ${role} error: ${err}`);
      }
    }
  }
}

export const creepManager = new CreepManager();
