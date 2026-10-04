// Serves the realm to the page from inside Vite's dev server: a stream of
// server-sent events, room terrain, and the page's choice of rooms to watch.
// The Screeps token never leaves this process.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { Realm, type ScreepsConfig } from "./realm";

export function realmPlugin(repoRoot: string): Plugin {
  return {
    name: "screeps-realm",
    configureServer(server) {
      let cfg: ScreepsConfig;
      try {
        cfg = JSON.parse(readFileSync(resolve(repoRoot, "screeps.json"), "utf8"));
      } catch (e) {
        throw new Error(`viewer needs screeps.json with a token at the repo root: ${(e as Error).message}`);
      }
      const realm = new Realm(cfg, resolve(repoRoot, "viewer/.cache"), (msg) => server.config.logger.warn(`[realm] ${msg}`));
      realm.start();
      server.httpServer?.once("close", () => realm.stop());

      let pages = 0;
      server.middlewares.use("/realm/events", (req, res) => {
        const page = String(++pages);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("hello", { ...realm.snapshot(), page });
        const off = realm.listen(send);
        const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
        req.on("close", () => {
          off();
          clearInterval(ping);
          realm.dropPage(page);
        });
      });

      server.middlewares.use("/realm/terrain", (req, res) => {
        const key = new URL(req.url ?? "", "http://x").searchParams.get("key") ?? "";
        realm.terrain(key).then(
          (t) => {
            res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "max-age=86400" });
            res.end(t);
          },
          (e) => {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end(String(e.message));
          },
        );
      });

      server.middlewares.use("/realm/focus", (req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const { page, keys } = JSON.parse(body);
            realm.setFocus(String(page), Array.isArray(keys) ? keys.map(String) : []);
            res.writeHead(204);
          } catch {
            res.writeHead(400);
          }
          res.end();
        });
      });
    },
  };
}
