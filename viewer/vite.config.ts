import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { realmPlugin } from "./server/plugin";

// `yarn realm`: the realm viewer at http://localhost:4747. It binds to this
// machine only, since it serves the account's live data.
export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  clearScreen: false,
  // One port only: a second server would take the account's two streamed rooms from the first.
  server: { host: "localhost", port: 4747, strictPort: true, open: true },
  plugins: [realmPlugin(fileURLToPath(new URL("..", import.meta.url)))],
});
