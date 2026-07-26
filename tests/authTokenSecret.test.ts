import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("auth tokens require a configured deployment secret rather than a committed fallback", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /oil-system-local-auth-v1/);
  assert.match(server, /process\.env\.AUTH_TOKEN_SECRET/);
  assert.match(server, /NODE_ENV\s*===\s*["']production["']/);
  assert.match(server, /AUTH_TOKEN_SECRET is required in production/);
  assert.match(server, /crypto\.randomBytes\(32\)/);
});

test("production startup rejects an absent AUTH_TOKEN_SECRET", { timeout: 10000 }, async () => {
  const { AUTH_TOKEN_SECRET, ...envWithoutSecret } = process.env;
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: { ...envWithoutSecret, NODE_ENV: "production", LOCAL_ONLY: "true", PORT: "0" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 8000);
    child.once("exit", (exitCode) => { clearTimeout(timer); resolve(exitCode); });
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /AUTH_TOKEN_SECRET is required in production/);
});
