import clear from 'rollup-plugin-clear';
import screeps from 'rollup-plugin-screeps';
import typescript from 'rollup-plugin-typescript2';
import { readFileSync } from 'fs';

// Read screeps config from file
const screepsConfig = JSON.parse(readFileSync('./screeps.json', 'utf8'));

export default {
    input: "src/main.ts",
    output: {
        file: "dist/main.js",
        format: "cjs",
        sourcemap: false
    },

    plugins: [
        clear({ targets: ["dist"] }),
        typescript({
            tsconfig: "./tsconfig.json"
        }),
        screeps({ config: screepsConfig })
    ]
};