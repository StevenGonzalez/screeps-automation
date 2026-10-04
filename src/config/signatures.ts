import { castleName, wildsName } from "../services/services.chronicle";
import { blazon } from "../services/services.heraldry";

// Royal proclamations for controller signing, in the voice of a dark-fantasy medieval
// kingdom. Keep under 100 chars.
export const SIGNATURES: string[] = [
  "By order of the Crown, this land now answers to the castle.",
  "Traveling merchants welcome. Raiders will be hanged at the gate.",
  "The siege is over. We won. Please wipe your boots.",
  "Taxes are due in gold. Pay at the castle gate.",
  "Warded by our enchanters. Do not touch.",
  "Here be dragons. And us. Mostly us.",
  "Our knights patrol these walls. Mind your step.",
  "The Crown sends its regards. Now leave.",
  "The bones were cast. Your claim did not survive them.",
  "Something stirs beneath the barrows. This land is under our protection.",
  "Trade, barter, pass through. Just don't stay.",
  "A dark wizard lives here. Knock at your own risk.",
];

// The proclamation a room was given, in turn, the first time it was signed.
function proclamation(roomName: string): string {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {} as any;
  const meta = Memory.rooms[roomName] as any;
  if (meta.lastSignedIndex === undefined) {
    const next = ((Memory.sigRotation ?? -1) + 1) % SIGNATURES.length;
    Memory.sigRotation = next;
    meta.lastSignedIndex = next;
  }
  return SIGNATURES[meta.lastSignedIndex];
}

// The game cuts a sign off at 100 characters.
const SIGN_LENGTH = 100;

// Who holds the room, then its proclamation when both fit on the sign.
function sign(head: string, roomName: string): string {
  const both = `${head} ${proclamation(roomName)}`;
  return both.length <= SIGN_LENGTH ? both : head.slice(0, SIGN_LENGTH);
}

/** A keep's sign, which names it and blazons its arms for anyone reading the map. */
export function keepSignature(roomName: string): string {
  return sign(`${castleName(roomName)}. Arms: ${blazon(roomName)}.`, roomName);
}

/** A reserved remote's sign, which names the wilds and the castle that holds them. */
export function remoteSignature(roomName: string, homeRoom: string): string {
  return sign(`The ${wildsName(roomName)}, held by ${castleName(homeRoom)}.`, roomName);
}
