/**
 * KHALA VISUALS
 * 
 * "Let all witness the glory of the KHALA"
 * 
 * Visual debugging and information display for Nexuses
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';

export class ProtossVisuals {
  Nexus: Nexus;
  visual: RoomVisual;
  
  constructor(Nexus: Nexus) {
    this.Nexus = Nexus;
    this.visual = Nexus.room.visual;
  }
  
  /**
   * Draw comprehensive HUD for the room
   */
  drawHUD(): void {
    // Only draw every few ticks to save CPU
    if (Game.time % 5 !== 0) return;
    
    this.drawControllerInfo();
    this.drawEnergyInfo();
    this.drawCreepInfo();
    this.drawBoostInfo();
    this.drawThreatInfo();
    
    // Draw base plan if enabled
    if (Memory.KHALA?.visualize?.[this.Nexus.name]) {
      this.drawPlan();
    }
  }
  
  /**
   * Draw controller progress and level
   */
  private drawControllerInfo(): void {
    const controller = this.Nexus.controller;
    if (!controller) return;
    
    const pos = controller.pos;
    
    // RCL and progress
    if (controller.level < 8 && controller.progressTotal) {
      const percent = Math.floor((100 * (controller.progress || 0)) / controller.progressTotal);
      this.visual.text(
        `RCL ${controller.level} (${percent}%)`,
        pos.x, pos.y - 1.5,
        {
          align: 'center',
          color: '#00FFFF',
          font: 0.6,
          backgroundColor: '#000000',
          backgroundPadding: 0.1
        }
      );
    } else {
      this.visual.text(
        `RCL ${controller.level}`,
        pos.x, pos.y - 1.5,
        {
          align: 'center',
          color: '#00FF00',
          font: 0.6,
          backgroundColor: '#000000',
          backgroundPadding: 0.1
        }
      );
    }
    
    // Downgrade timer if relevant
    if (controller.ticksToDowngrade && controller.ticksToDowngrade < 10000) {
      const ticks = controller.ticksToDowngrade;
      const color = ticks < 5000 ? '#FF0000' : '#FFAA00';
      this.visual.text(
        `⏰ ${Math.floor(ticks / 1000)}k`,
        pos.x, pos.y - 0.8,
        {
          align: 'center',
          color,
          font: 0.5
        }
      );
    }
  }
  
  /**
   * Draw energy statistics
   */
  private drawEnergyInfo(): void {
    const room = this.Nexus.room;
    
    // Energy available/capacity
    const energyText = `⚡ ${room.energyAvailable}/${room.energyCapacityAvailable}`;
    const energyColor = room.energyAvailable >= room.energyCapacityAvailable * 0.9 ? '#00FF00' : '#FFAA00';
    
    this.visual.text(
      energyText,
      2, 2,
      {
        align: 'left',
        color: energyColor,
        font: 0.6,
        backgroundColor: '#000000',
        backgroundPadding: 0.1
      }
    );
    
    // Storage level
    if (this.Nexus.storage) {
      const storage = this.Nexus.storage;
      const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const capacity = storage.store.getCapacity();
      const percent = Math.floor((energy / capacity) * 100);
      
      this.visual.text(
        `🏦 ${Math.floor(energy / 1000)}k (${percent}%)`,
        2, 3,
        {
          align: 'left',
          color: '#FFD700',
          font: 0.6,
          backgroundColor: '#000000',
          backgroundPadding: 0.1
        }
      );
    }
  }
  
  /**
   * Draw creep statistics
   */
  private drawCreepInfo(): void {
    const creeps = this.Nexus.Warriors;
    
    // Count by role
    const roles: { [role: string]: number } = {};
    for (const creep of creeps) {
      const role = (creep.memory as any).role || 'unknown';
      roles[role] = (roles[role] || 0) + 1;
    }
    
    // Display role counts
    let y = 5;
    for (const role in roles) {
      const count = roles[role];
      const icon = this.getRoleIcon(role);
      
      this.visual.text(
        `${icon} ${role}: ${count}`,
        2, y,
        {
          align: 'left',
          color: '#FFFFFF',
          font: 0.5,
          backgroundColor: '#000000',
          backgroundPadding: 0.05
        }
      );
      y += 0.7;
    }
  }
  
  /**
   * Draw boost status
   */
  private drawBoostInfo(): void {
    if (!this.Nexus.BoostGateway) return;
    
    const boostQueue = this.Nexus.BoostGateway.getBoostQueue();
    
    if (boostQueue.length > 0) {
      this.visual.text(
        `⚗️ Boost Queue: ${boostQueue.length}`,
        2, 3,
        {
          align: 'left',
          color: '#FF00FF',
          font: 0.6,
          backgroundColor: '#000000',
          backgroundPadding: 0.1
        }
      );
    }
    
    // Show boost indicators on boosted creeps
    for (const creep of this.Nexus.Warriors) {
      if (creep.body.some(part => part.boost)) {
        this.visual.text(
          '✨',
          creep.pos.x, creep.pos.y - 1,
          {
            align: 'center',
            color: '#FFFF00',
            font: 0.6,
            stroke: '#000000',
            strokeWidth: 0.05
          }
        );
      }
    }
    
    // Show power bank information (RCL 8+)
    if (this.Nexus.PowerGateway && this.Nexus.PowerGateway.isReady) {
      const targets = this.Nexus.PowerGateway.getAvailableTargets();
      if (targets.length > 0) {
        this.visual.text(
          `⚡ POWER BANKS: ${targets.length}`,
          45, 2,
          {
            align: 'right',
            color: '#00FFFF',
            font: 0.6,
            backgroundColor: '#000000',
            backgroundPadding: 0.1
          }
        );
      }
    }
  }
  
  /**
   * Draw threat warnings
   */
  private drawThreatInfo(): void {
    const hostiles = this.Nexus.room.find(FIND_HOSTILE_CREEPS);
    
    if (hostiles.length > 0) {
      this.visual.text(
        `⚠️ HOSTILES: ${hostiles.length}`,
        25, 2,
        {
          align: 'center',
          color: '#FF0000',
          font: 0.8,
          backgroundColor: '#000000',
          backgroundPadding: 0.2
        }
      );
      
      // Draw boxes around hostiles
      for (const hostile of hostiles) {
        this.visual.circle(hostile.pos, {
          fill: 'transparent',
          radius: 0.6,
          stroke: '#FF0000',
          strokeWidth: 0.1
        });
        
        // Show hostile name
        this.visual.text(
          hostile.owner.username,
          hostile.pos.x, hostile.pos.y - 1,
          {
            align: 'center',
            color: '#FF0000',
            font: 0.4
          }
        );
      }
    }
  }
  
  /**
   * Get icon for creep role
   */
  private getRoleIcon(role: string): string {
    const icons: { [key: string]: string } = {
      'harvester': '⛏️',
      'miner': '⛏️',
      'hauler': '🚛',
      'upgrader': '⬆️',
      'worker': '⬆️',
      'builder': '🔨',
      'repairer': '🔧',
      'defender': '⚔️',
      'healer': '💚',
      'claimer': '🚩',
      'scout': '👁️'
    };
    
    return icons[role] || '👤';
  }
  
  /**
   * Visualize the room plan
   */
  drawPlan(): void {
    this.Nexus.planner.visualize();
  }
  
  /**
   * Draw Arbiter status
   */
  drawArbiters(): void {
    let y = 45;
    
    for (const arbiterName in this.Nexus.arbiters) {
      const arbiter = this.Nexus.arbiters[arbiterName];
      const WarriorCount = arbiter.Warriors?.length || 0;
      
      this.visual.text(
        `${arbiterName}: ${WarriorCount} Warriors`,
        2, y,
        {
          align: 'left',
          color: '#00FFFF',
          font: 0.5
        }
      );
      
      y -= 0.7;
    }
  }
}
