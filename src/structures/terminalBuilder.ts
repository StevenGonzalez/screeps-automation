// src/structures/terminalBuilder.ts
import { MemoryManager } from '../memory/memoryManager';
import { terminalPlanner } from './terminalPlanner';

interface TerminalBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
}

const BUILD_CHECK_INTERVAL = 30;
const CLEANUP_CHECK_INTERVAL = 150;

export class TerminalBuilder {
  buildTerminalForRoom(room: Room) {
    if (!room.controller || !room.controller.my || room.controller.level < 6) return;

    const statePath = `rooms.${room.name}.terminalBuildState`;
    const state = MemoryManager.get<TerminalBuildState>(statePath, { lastBuildCheck: 0, lastCleanupCheck: 0 });

    if (!state) return;

    if (Game.time - state.lastBuildCheck >= BUILD_CHECK_INTERVAL) {
      this.createTerminalSite(room);
      state.lastBuildCheck = Game.time;
      MemoryManager.set(statePath, state);
    }

    if (Game.time - state.lastCleanupCheck >= CLEANUP_CHECK_INTERVAL) {
      this.cleanupTerminal(room);
      state.lastCleanupCheck = Game.time;
      MemoryManager.set(statePath, state);
    }
  }

  private createTerminalSite(room: Room) {
    // Check if terminal already exists
    const existingTerminal = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TERMINAL });
    if (existingTerminal.length > 0) return;

    // Check if construction site already exists
    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TERMINAL });
    if (existingSites.length > 0) return;

    const plan = terminalPlanner.planTerminalForRoom(room);
    if (!plan || !plan.position) return;

    const [x, y] = plan.position.split(',').map(Number);
    const pos = new RoomPosition(x, y, room.name);

    // Don't place if there's a blocking structure
    const hasBlockingStructure = pos.lookFor(LOOK_STRUCTURES).some(s => 
      s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART
    );
    
    if (hasBlockingStructure) return;

    room.createConstructionSite(pos, STRUCTURE_TERMINAL);
  }

  private cleanupTerminal(room: Room) {
    const plan = terminalPlanner.planTerminalForRoom(room);
    if (!plan || !plan.position) return;

    const [px, py] = plan.position.split(',').map(Number);
    const plannedPos = `${px},${py}`;

    // Remove terminals not in the current plan
    const terminals = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TERMINAL }) as StructureTerminal[];
    
    for (const terminal of terminals) {
      const key = `${terminal.pos.x},${terminal.pos.y}`;
      
      if (key !== plannedPos) {
        terminal.destroy();
      }
    }

    // Cancel misplaced construction sites
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TERMINAL });
    
    for (const site of sites) {
      const key = `${site.pos.x},${site.pos.y}`;
      
      if (key !== plannedPos) {
        site.remove();
      }
    }
  }
}

export const terminalBuilder = new TerminalBuilder();
