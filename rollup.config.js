import clear from 'rollup-plugin-clear';
import typescript from 'rollup-plugin-typescript2';

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
        })
    ]
};
