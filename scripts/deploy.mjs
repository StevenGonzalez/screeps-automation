// Uploads dist/main.js to a Screeps server and fails loudly if it did not land.
//
// rollup-plugin-screeps started its upload without waiting for it or reporting
// errors, so a failed upload still passed CI. This script waits for the server
// to accept the code, then reads the branch back and checks that `main` holds
// exactly what was sent.
//
// Config comes from screeps.json: token, branch, and optionally protocol,
// hostname, port and path (the Season server lives under path "/season").
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

export function codeUrl(cfg) {
  const protocol = cfg.protocol ?? "https";
  const hostname = cfg.hostname ?? "screeps.com";
  const port = cfg.port ?? (protocol === "https" ? 443 : 80);
  const base = (cfg.path ?? "/").replace(/\/+$/, "");
  return `${protocol}://${hostname}:${port}${base}/api/user/code`;
}

export async function deploy(cfg, main, fetchFn = fetch) {
  if (!cfg.token) throw new Error("screeps.json has no token");
  if (!main) throw new Error("dist/main.js is empty; build before deploying");
  const branch = cfg.branch ?? "default";
  const url = codeUrl(cfg);
  const headers = { "X-Token": cfg.token, "Content-Type": "application/json" };

  const put = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ branch, modules: { main } }),
  });
  const putBody = await put.json().catch(() => ({}));
  if (!put.ok || putBody.ok !== 1) {
    throw new Error(`upload to ${url} failed: HTTP ${put.status} ${JSON.stringify(putBody)}`);
  }

  const get = await fetchFn(`${url}?branch=${encodeURIComponent(branch)}`, { headers });
  const getBody = await get.json().catch(() => ({}));
  const live = getBody.modules?.main;
  if (live !== main) {
    const got = typeof live === "string" ? `${Buffer.byteLength(live)} bytes` : "nothing";
    throw new Error(`branch ${branch} at ${url} holds ${got} after upload, expected ${Buffer.byteLength(main)} bytes`);
  }
  return { url, branch, bytes: Buffer.byteLength(main) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const cfg = JSON.parse(readFileSync("screeps.json", "utf8"));
    const main = readFileSync("dist/main.js", "utf8");
    const { url, branch, bytes } = await deploy(cfg, main);
    console.log(`Deployed ${bytes} bytes to branch ${branch} at ${url}`);
  } catch (e) {
    console.error(`Deploy failed: ${e.message}`);
    process.exit(1);
  }
}
