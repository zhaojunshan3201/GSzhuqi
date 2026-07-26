import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("channeling permissions consist only of guest read-only and administrator maintenance", async () => {
  const [component, server] = await Promise.all([
    readFile(new URL("../src/components/ChannelingProjectManagement.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
  ]);

  assert.match(component, /const canOperate = isAdmin;/);
  assert.match(component, /游客只读/);
  assert.doesNotMatch(component, /technical|technician|operation|operator/);
  assert.doesNotMatch(server, /requireChannelingOperator/);
  assert.doesNotMatch(server, /\["admin", "technical", "technician", "operation", "operator"\]/);
});