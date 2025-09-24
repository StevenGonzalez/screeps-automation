/// <reference types="@types/screeps" />
import { getRoomMemory } from "./global.memory";

export function drawRoomHUD(room: Room, intel: any): void {
  if (!room.controller?.my) return;
  const mem = getRoomMemory(room.name);
  const ui = mem?.ui || {};
  // Off by default: require explicit enable
  if (!ui.hudEnabled) return;
  const period = Math.max(1, ui.hudPeriod ?? 5);
  // Draw infrequently to keep CPU low
  if (Game.time % period !== 0) return;
  const vis = new RoomVisual(room.name);

  // Anchor for layout-relative drawings
  const anchor = mem?.construction?.anchor;
  const ax = anchor?.x ?? room.controller.pos.x;
  const ay = anchor?.y ?? room.controller.pos.y;

  // Controller block: show controller container/link energy
  const ctrl = room.controller;
  if (ctrl) {
    // RCL progress label
    if (ctrl.level < 8 && ctrl.progressTotal) {
      const pct = Math.floor((100 * (ctrl.progress || 0)) / ctrl.progressTotal);
      vis.text(
        `RCL ${ctrl.level} ${pct}%`,
        ctrl.pos.x + 0.5,
        ctrl.pos.y - 1.2,
        {
          align: "left",
          color: "#cff",
          font: 0.7,
          backgroundColor: "#111",
        }
      );
    } else {
      vis.text(`RCL ${ctrl.level}`, ctrl.pos.x + 0.5, ctrl.pos.y - 1.2, {
        align: "left",
        color: "#cff",
        font: 0.7,
        backgroundColor: "#111",
      });
    }
    const nearLink = ctrl.pos
      .findInRange(FIND_MY_STRUCTURES, 3)
      .find((s) => s.structureType === STRUCTURE_LINK) as
      | StructureLink
      | undefined;
    const nearContainer = ctrl.pos
      .findInRange(FIND_STRUCTURES, 2)
      .find((s) => s.structureType === STRUCTURE_CONTAINER) as
      | StructureContainer
      | undefined;
    const parts: string[] = [];
    if (nearLink)
      parts.push(`🔗 ${nearLink.store.getUsedCapacity(RESOURCE_ENERGY)}`);
    if (nearContainer)
      parts.push(`📦 ${nearContainer.store.getUsedCapacity(RESOURCE_ENERGY)}`);
    if (parts.length) {
      vis.text(parts.join("  "), ctrl.pos.x + 0.5, ctrl.pos.y - 0.5, {
        align: "left",
        color: "#9cf",
        font: 0.7,
      });
    }
  }

  // Extensions: filled/total near anchor
  const exts = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_EXTENSION,
  }) as StructureExtension[];
  if (exts.length) {
    const filled = exts.filter(
      (e) => e.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ).length;
    vis.text(`🔌 ${filled}/${exts.length}`, ax + 2, ay - 2, {
      color: "#ffd28c",
      font: 0.7,
      align: "center",
      backgroundColor: "#111",
    });
  }

  // Storage energy
  if (room.storage) {
    vis.text(
      `🏦 ${formatK(room.storage.store.getUsedCapacity(RESOURCE_ENERGY))}`,
      room.storage.pos.x + 0.5,
      room.storage.pos.y - 0.5,
      {
        align: "left",
        color: "#bdf",
        font: 0.7,
      }
    );
  }

  // Towers energy aggregate
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  if (towers.length) {
    const total = towers.reduce(
      (sum, t) => sum + t.store.getUsedCapacity(RESOURCE_ENERGY),
      0
    );
    vis.text(`🗼 ${formatK(total)}`, ax - 2, ay - 2, {
      color: "#bdf",
      font: 0.7,
      align: "center",
      backgroundColor: "#111",
    });
  }
}

function formatK(n: number): string {
  if (n >= 1000000)
    return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "m";
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
  return String(n);
}
