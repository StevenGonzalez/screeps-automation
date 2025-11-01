import clear from 'rollup-plugin-clear';
import screeps from 'rollup-plugin-screeps';
import typescript from 'rollup-plugin-typescript2';
import { readFileSync, existsSync } from 'fs';

let screepsConfig = null;
if (existsSync('./screeps.json')) {
    screepsConfig = JSON.parse(readFileSync('./screeps.json', 'utf8'));
}

const plugins = [
    clear({ targets: ["dist"] }),
    typescript({
        tsconfig: "./tsconfig.json"
    })
];

if (screepsConfig) {
    plugins.push(screeps({ config: screepsConfig }));
}

export default {
    input: "src/main.ts",
    output: {
        file: "dist/main.js",
        format: "cjs",
        sourcemap: false
    },
    plugins
};