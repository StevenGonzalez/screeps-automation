/**
 * Creep Personality System
 *
 * Adds character, voice, and emotional intelligence to your creeps.
 * Makes your automation entertaining and immersive to watch.
 */

/// <reference types="@types/screeps" />

// Extend global interfaces for personality memory
declare global {
  interface CreepMemory {
    role?: string;
    silent?: boolean;
    hasGreeted?: boolean;
    personality?: {
      mood?: string;
      chattiness?: number;
      lastSpoke?: number;
    };
    [key: string]: any;
  }

  interface Memory {
    personality?: {
      globalChattiness?: number;
      [key: string]: any;
    };
  }
}

/**
 * Creep Personality System - Adds character and voice to your creeps!
 */
export class CreepPersonality {
  private static readonly SPEECH_CHANCE = 0.15; // 15% chance to speak on actions

  // Personality phrases by action type
  private static readonly PHRASES = {
    harvest: [
      "⛏️ Mining time!",
      "💎 Shiny rocks!",
      "🔥 Got the goods!",
      "⚡ Energy rush!",
      "💪 Hard work!",
      "🎯 Jackpot!",
      "🔋 Power up!",
      "✨ Sweet energy!",
    ],
    build: [
      "🔨 Building big!",
      "🏗️ Construct!",
      "🎪 Making magic!",
      "🔧 Craft time!",
      "⚒️ Hammer time!",
      "🎨 Artistry!",
      "🏠 Home sweet home!",
      "⭐ Masterpiece!",
    ],
    repair: [
      "🔧 Fix it up!",
      "🛠️ Good as new!",
      "💊 Healing!",
      "🔨 Patch job!",
      "⚡ Restored!",
      "✨ Like magic!",
      "🎯 Perfect fix!",
      "💪 Strong again!",
    ],
    upgrade: [
      "🚀 Level up!",
      "⭐ Progress!",
      "📈 Advancing!",
      "🎯 Excellence!",
      "💎 Perfection!",
      "🔥 Power boost!",
      "✨ Enhanced!",
      "🏆 Victory!",
    ],
    transfer: [
      "📦 Delivery!",
      "🎁 Special gift!",
      "💝 Package deal!",
      "🚚 Express!",
      "📮 Mail time!",
      "🎪 Coming through!",
      "💫 Fresh supply!",
      "🔄 Exchange!",
    ],
    withdraw: [
      "💰 Payday!",
      "🎒 Backpack full!",
      "📥 Collecting!",
      "💎 Treasure!",
      "🔋 Refueling!",
      "🎯 Got it!",
      "💪 Loaded up!",
      "⚡ Charged!",
    ],
    attack: [
      "⚔️ For glory!",
      "🔥 Burn baby!",
      "💥 Boom!",
      "⚡ Lightning!",
      "🎯 Bullseye!",
      "💪 Smash time!",
      "🌟 Critical hit!",
      "🔥 Devastation!",
    ],
    heal: [
      "💊 Medicine!",
      "✨ Healing light!",
      "❤️ Feel better!",
      "🌟 Restored!",
      "💚 Life force!",
      "🔋 Recharged!",
      "⭐ Good vibes!",
      "💫 Recovery!",
    ],
    move: [
      "🚶 On my way!",
      "🏃 Moving out!",
      "🎯 Target locked!",
      "⚡ Speed mode!",
      "🌟 Here I come!",
      "🚀 Incoming!",
      "💨 Zoom zoom!",
      "🎪 Adventure!",
    ],
    idle: [
      "🤔 Thinking...",
      "😴 Sleepy time",
      "🎵 La la la~",
      "👀 Looking around",
      "🌟 Shiny things!",
      "😊 Happy day!",
      "🎈 Floating by",
      "✨ Peaceful",
    ],
    flee: [
      "😱 Run away!",
      "💨 Escape!",
      "🏃 Not today!",
      "⚡ Tactical retreat!",
      "🌪️ Outta here!",
      "🚀 Zoom!",
      "😵 Danger!",
      "🌟 Safety first!",
    ],
    celebrate: [
      "🎉 Success!",
      "🏆 Winner!",
      "✨ Amazing!",
      "🎊 Party time!",
      "🌟 Fantastic!",
      "💫 Brilliant!",
      "🔥 Awesome!",
      "⭐ Perfect!",
    ],
    frustrated: [
      "😤 Blocked!",
      "🙄 Seriously?",
      "😠 Move it!",
      "🤬 Come on!",
      "😑 Really?",
      "💢 Argh!",
      "🤦 Oh no!",
      "😮‍💨 Sigh...",
    ],
  };

  private static readonly ROLE_PERSONALITIES = {
    harvester: { mood: "hardworking", prefix: "⛏️", energy: 0.8 },
    builder: { mood: "creative", prefix: "🔨", energy: 0.9 },
    upgrader: { mood: "ambitious", prefix: "🚀", energy: 0.7 },
    hauler: { mood: "reliable", prefix: "📦", energy: 0.6 },
    defender: { mood: "heroic", prefix: "⚔️", energy: 1.0 },
    attacker: { mood: "aggressive", prefix: "💥", energy: 1.2 },
    scout: { mood: "curious", prefix: "👁️", energy: 0.5 },
  };

  /**
   * Make a creep speak with personality based on action and role
   */
  static speak(
    creep: Creep,
    actionType: keyof typeof CreepPersonality.PHRASES,
    force = false
  ): void {
    // Check if speaking is disabled
    if (creep.memory.silent) return;

    // Random chance to speak (unless forced)
    if (!force && Math.random() > this.SPEECH_CHANCE) return;

    const role = creep.memory.role || "harvester";
    const personality =
      this.ROLE_PERSONALITIES[role as keyof typeof this.ROLE_PERSONALITIES] ||
      this.ROLE_PERSONALITIES.harvester;

    // Get appropriate phrases for the action
    const phrases = this.PHRASES[actionType] || this.PHRASES.idle;
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];

    // Add personality prefix occasionally
    const usePrefix = Math.random() < 0.3;
    const message = usePrefix ? `${personality.prefix} ${phrase}` : phrase;

    creep.say(message, true); // true = show to other players

    // Update personality memory
    if (!creep.memory.personality) {
      creep.memory.personality = {};
    }
    creep.memory.personality.lastSpoke = Game.time;
  }

  /**
   * Speak based on current creep state and situation
   */
  static contextualSpeak(creep: Creep): void {
    // Don't spam - limit contextual speech
    if (Game.time % 20 !== 0) return;

    const role = creep.memory.role || "harvester";

    // Check various conditions
    if (creep.hits < creep.hitsMax * 0.5) {
      this.speak(creep, "flee", false);
    } else if (creep.store.getFreeCapacity() === 0) {
      this.speak(creep, "celebrate", false);
    } else if (creep.store.getUsedCapacity() === 0 && role !== "upgrader") {
      this.speak(creep, "frustrated", false);
    } else if (creep.fatigue > 0) {
      creep.say("😴 Tired...", true);
    } else {
      // Random idle chatter
      if (Math.random() < 0.05) {
        // 5% chance
        this.speak(creep, "idle", false);
      }
    }
  }

  /**
   * Get a motivational phrase for spawning based on role
   */
  static getSpawnPhrase(role: string): string {
    const roleSpecificPhrases: { [key: string]: string[] } = {
      harvester: [
        "⛏️ Ready to harvest!",
        "💎 Let's mine!",
        "🌾 Time to gather!",
      ],
      hauler: [
        "📦 Moving supplies!",
        "🚚 Transport ready!",
        "📋 Logistics online!",
      ],
      upgrader: [
        "🔧 Upgrading systems!",
        "⚡ Power boosting!",
        "🆙 Level up time!",
      ],
      builder: [
        "🏗️ Construction ready!",
        "🔨 Building dreams!",
        "🏠 Creating homes!",
      ],
      defender: [
        "⚔️ Guardian mode!",
        "🛡️ Protection active!",
        "👮 Security online!",
      ],
    };

    const genericPhrases = [
      "🌟 Born to work!",
      "⚡ Ready to serve!",
      "🚀 Let's do this!",
      "💪 Time to shine!",
      "🎯 Mission ready!",
      "🔥 Fired up!",
      "✨ Fresh and eager!",
      "🏆 Victory awaits!",
    ];

    const phrases = roleSpecificPhrases[role] || genericPhrases;
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  /**
   * Celebration for completed tasks
   */
  static celebrate(creep: Creep, achievement: string): void {
    const celebrations = [
      `🎉 ${achievement}!`,
      `🏆 Nailed it!`,
      `⭐ ${achievement}!`,
      `✨ Success!`,
      `💫 Done!`,
      `🔥 Boom!`,
    ];

    const message =
      celebrations[Math.floor(Math.random() * celebrations.length)];
    creep.say(message, true);
  }

  /**
   * Initialize personality for a new creep
   */
  static initializePersonality(creep: Creep): void {
    if (!creep.memory.personality) {
      const role = creep.memory.role || "harvester";
      const rolePersonality =
        this.ROLE_PERSONALITIES[role as keyof typeof this.ROLE_PERSONALITIES];

      creep.memory.personality = {
        mood: rolePersonality?.mood || "neutral",
        chattiness: Math.random() * 0.3 + 0.7, // 0.7-1.0 multiplier
        lastSpoke: 0,
      };
    }
  }

  /**
   * Get personality statistics for the empire
   */
  static getPersonalityStats(): {
    byRole: Record<string, number>;
    totalSpeaking: number;
    totalSilent: number;
    avgChattiness: number;
  } {
    const byRole: Record<string, number> = {};
    let totalSpeaking = 0;
    let totalSilent = 0;
    let totalChattiness = 0;
    let count = 0;

    for (const creepName in Game.creeps) {
      const creep = Game.creeps[creepName];
      const role = creep.memory.role || "unknown";

      byRole[role] = (byRole[role] || 0) + 1;

      if (creep.memory.silent) {
        totalSilent++;
      } else {
        totalSpeaking++;
      }

      if (creep.memory.personality?.chattiness) {
        totalChattiness += creep.memory.personality.chattiness;
        count++;
      }
    }

    return {
      byRole,
      totalSpeaking,
      totalSilent,
      avgChattiness: count > 0 ? totalChattiness / count : 0.8,
    };
  }

  /**
   * Set global chattiness level (affects all creeps)
   */
  static setGlobalChattiness(
    level: "quiet" | "normal" | "chatty" | "party"
  ): void {
    const levels = {
      quiet: 0.05,
      normal: 0.15,
      chatty: 0.3,
      party: 0.5,
    };

    // Store in Memory for persistence
    if (!Memory.personality) {
      Memory.personality = {};
    }
    Memory.personality.globalChattiness = levels[level];

    console.log(
      `🎭 Global chattiness set to: ${level} (${levels[level] * 100}%)`
    );
  }

  /**
   * Apply global chattiness setting
   */
  private static getEffectiveChattiness(): number {
    const globalLevel =
      Memory.personality?.globalChattiness || this.SPEECH_CHANCE;
    return globalLevel;
  }
}
