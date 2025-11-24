import { kernel } from "./kernel/kernel";

export function loop() {
	kernel.tick();
}

declare const module: any;
if (typeof module !== 'undefined') module.exports.loop = loop;
