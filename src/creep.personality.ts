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
  private static readonly SPEECH_CHANCE = 0.05; // 5% chance to speak on actions

  // Personality phrases by action type
  private static readonly PHRASES = {
    harvest: [
      "⛏️ Mine",
      "💎 Shiny!",
      "🔥 Goods",
      "⚡ Energy!",
      "💪 Workin'",
      "🎯 Jackpot!",
      "🔋 Power up",
      "✨ Sweet!",
    ],
    build: [
      "🔨 Buildin'",
      "🏗 Build",
      "🎪 Magic!",
      "🔧 Crafting",
      "🔨 Hammer",
      "🎨 Art!",
      "🏠 Home",
      "⭐ Master!",
    ],
    repair: [
      "🔧 Fixin'",
      "� Good!",
      "💊 Heal",
      "🔨 Patching",
      "⚡ Restore",
      "✨ Magic!",
      "🎯 Perfect",
      "💪 Strong!",
    ],
    upgrade: [
      "🚀 Lvl up!",
      "⭐ Progress",
      "📈 Advance",
      "🎯 Excel!",
      "💎 Perfect",
      "🔥 Power!",
      "✨ Enhance",
      "🏆 Victory!",
    ],
    transfer: [
      "📦 Delivery",
      "🎁 Gift!",
      "💝 Package",
      "🚚 Express",
      "📮 Mail!",
      "🎪 Comin'",
      "💫 Supply!",
      "🔄 Swap!",
    ],
    withdraw: [
      "💰 Payday!",
      "🎒 Full up",
      "📥 Collect",
      "💎 Treasure",
      "🔋 Refuel",
      "🎯 Got it!",
      "💪 Loaded!",
      "⚡ Charged!",
    ],
    attack: [
      "⚔️ Glory!",
      "🔥 Burn!",
      "💥 Boom!",
      "⚡ Zap!",
      "🎯 Bullseye",
      "💪 Smash!",
      "🌟 Crit!",
      "🔥 Attack!",
    ],
    heal: [
      "💊 Meds!",
      "✨ Light!",
      "❤️ Heal",
      "🌟 Restore",
      "💚 Life!",
      "🔋 Recharge",
      "⭐ Vibes",
      "💫 Recover",
    ],
    move: [
      "🚶 On way",
      "🏃 Movin'",
      "🎯 Target",
      "⚡ Speed!",
      "🌟 Comin'",
      "🚀 Incoming",
      "💨 Zoom!",
      "🎪 Go!",
    ],
    idle: [
      "🤔 Hmmm...",
      "😴 Zzzz",
      "🎵 La la",
      "👀 Lookin'",
      "🌟 Shiny!",
      "😊",
      "🎈",
      "✨",
    ],
    flee: [
      "😱 Run!",
      "💨 Escape!",
      "🏃 Not now",
      "⚡ Retreat!",
      "🌪️ Outta!",
      "🚀 Zoom!",
      "😵 Danger!",
      "🌟 Safety!",
    ],
    celebrate: [
      "🎉 Success!",
      "🏆 Winner!",
      "✨ Amazing!",
      "🎊 Party!",
      "🌟 Great!",
      "💫 Brill!",
      "🔥 Awesome!",
      "⭐ Perfect!",
    ],
    frustrated: [
      "😤 Blocked!",
      "🙄 Ugh",
      "😠 Move it!",
      "🤬 Grrr!",
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

    // Add personality prefix occasionally, but avoid duplicating emojis
    const usePrefix = Math.random() < 0.3;
    let message = phrase;

    if (usePrefix) {
      const alreadyStartsWithPrefix = this.startsWithPrefixEmoji(
        phrase,
        personality.prefix
      );
      const startsWithAnyEmoji = this.startsWithEmojiLike(phrase);

      if (!alreadyStartsWithPrefix && !startsWithAnyEmoji) {
        // Try with space, then without, then fallback to phrase
        const spaced = `${personality.prefix} ${phrase}`;
        if (this.visibleLength(spaced) <= 10) {
          message = spaced;
        } else {
          const tight = `${personality.prefix}${phrase}`;
          if (this.visibleLength(tight) <= 10) {
            message = tight;
          } else {
            message = phrase; // prefix would overflow; keep phrase only
          }
        }
      }
    }

    // Final guard: hard-cap to 10 visible units (code points) to prevent overflow
    message = this.fitToSayLimit(message, 10);

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
      creep.say(this.fitToSayLimit("😴 Tired...", 10), true);
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
      harvester: ["⛏️ Harvest!", "💎 Mine!", "🌾 Gather!"],
      hauler: ["📦 Move!", "🚚 Transport", "📋 Logistics"],
      upgrader: ["🔧 Upgrade!", "⚡ Boost!", "🆙 Lvl up!"],
      builder: ["🏗️ Build!", "🔨 Construct", "🏠 Create"],
      defender: ["⚔️ Guard!", "🛡️ Protect!", "👮 Secure!"],
    };

    const genericPhrases = [
      "🌟 Ready!",
      "⚡ Go!",
      "🚀 Mission!",
      "💪 Work!",
      "🎯 On it!",
      "🔥 Fired up!",
      "✨ Eager!",
      "🏆 Victory!",
    ];
    const phrases = roleSpecificPhrases[role] || genericPhrases;
    const pick = phrases[Math.floor(Math.random() * phrases.length)];
    return this.fitToSayLimit(pick, 10);
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
    creep.say(this.fitToSayLimit(message, 10), true);
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

  // --- Helpers to respect Screeps' 10-character say limit safely ---
  private static visibleLength(str: string): number {
    // Count Unicode code points (avoids splitting surrogate pairs)
    return Array.from(str).length;
  }

  private static fitToSayLimit(str: string, max = 10): string {
    const arr = Array.from(str);
    if (arr.length <= max) return str;
    return arr.slice(0, max).join("");
  }

  private static startsWithPrefixEmoji(text: string, prefix: string): boolean {
    const t = text.replace(/^\s+/, "");
    return t.startsWith(prefix) || t.startsWith(prefix + " ");
  }

  private static startsWithEmojiLike(text: string): boolean {
    const t = text.replace(/^\s+/, "");
    if (!t) return false;
    const cp = t.codePointAt(0);
    if (cp === undefined) return false;
    // Heuristic: most pictographs/emojis are > 0x2600; also include some symbols
    return cp >= 0x2600;
  }
}
