import clear from 'rollup-plugin-clear';
import screeps from 'rollup-plugin-screeps';
import typescript from 'rollup-plugin-typescript2';
import { readFileSync } from 'fs';

const shouldDeploy = process.env.DEPLOY === 'true';
// Only read deploy credentials when actually deploying (DEPLOY=true, e.g. the CI workflow which
// writes screeps.json from a secret). Local `yarn build` then needs no screeps.json at all.
const screepsConfig = shouldDeploy
    ? JSON.parse(readFileSync('./screeps.json', 'utf8'))
    : null;

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
        shouldDeploy ? screeps({ config: screepsConfig }) : null
    ].filter(Boolean)
};
