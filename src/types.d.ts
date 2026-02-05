/**
 * Global type definitions for KHALA system
 */

import { KHALA } from './core/KHALA';

declare global {
  var Cov: Khala;
  
  namespace NodeJS {
    interface Global {
      Cov: Khala;
    }
  }
  
  interface Memory {
    KHALA?: {
      version?: string;
      visualize?: { [roomName: string]: boolean };
      [key: string]: any;
    };
    intel?: { [roomName: string]: any }; // Room intelligence data
    expansion?: { // Expansion system data
      currentTarget?: any;
      history: Array<{ roomName: string; claimedAt: number; success: boolean }>;
      lastEvaluation: number;
    };
    terminalNetwork?: { // Terminal network data
      transfers: any[];
      lastBalancing: number;
      statistics: any;
    };
  }
  
  interface CreepMemory {
    role?: string;
    arbiter?: string;
    working?: boolean;
    building?: boolean;
    collecting?: boolean;
    task?: any;
    sourceId?: Id<Source>;
    targetRoom?: string;
    [key: string]: any;
  }
}

export {};
