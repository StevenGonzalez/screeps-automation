import { describe, it, expect, vi } from "vitest";
// @ts-expect-error plain JavaScript module without type declarations
import { codeUrl, deploy } from "../scripts/deploy.mjs";

const CFG = { token: "t", protocol: "https", hostname: "screeps.com", port: 443, path: "/season", branch: "default" };

function server(opts: { upload?: object; status?: number; live?: string | undefined }) {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      return { ok: (opts.status ?? 200) < 300, status: opts.status ?? 200, json: async () => opts.upload ?? { ok: 1 } };
    }
    return { ok: true, status: 200, json: async () => ({ ok: 1, modules: { main: opts.live } }) };
  });
}

describe("codeUrl", () => {
  it("builds the World and Season endpoints", () => {
    expect(codeUrl({ ...CFG, path: "/" })).toBe("https://screeps.com:443/api/user/code");
    expect(codeUrl(CFG)).toBe("https://screeps.com:443/season/api/user/code");
    expect(codeUrl({ token: "t" })).toBe("https://screeps.com:443/api/user/code");
  });
});

describe("deploy", () => {
  it("uploads main and confirms the branch holds it", async () => {
    const fetchFn = server({ live: "code" });
    await expect(deploy(CFG, "code", fetchFn)).resolves.toEqual({
      url: "https://screeps.com:443/season/api/user/code",
      branch: "default",
      bytes: 4,
    });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({ branch: "default", modules: { main: "code" } });
  });

  it("fails when the server rejects the upload", async () => {
    await expect(deploy(CFG, "code", server({ status: 401, upload: { error: "unauthorized" } }))).rejects.toThrow(
      /HTTP 401/
    );
    await expect(deploy(CFG, "code", server({ upload: { error: "bad" } }))).rejects.toThrow(/failed/);
  });

  it("fails when the branch does not hold what was sent", async () => {
    await expect(deploy(CFG, "code", server({ live: "" }))).rejects.toThrow(/holds 0 bytes/);
    await expect(deploy(CFG, "code", server({ live: undefined }))).rejects.toThrow(/holds nothing/);
  });

  it("refuses to upload an empty bundle or without a token", async () => {
    await expect(deploy(CFG, "", server({}))).rejects.toThrow(/empty/);
    await expect(deploy({ ...CFG, token: "" }, "code", server({}))).rejects.toThrow(/token/);
  });
});
