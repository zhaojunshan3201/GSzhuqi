import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("channeling ledger exposes complete lists and role-specific actions instead of a todo-only blank state", async () => {
  const component = await readFile(new URL("../src/components/ChannelingProjectManagement.tsx", import.meta.url), "utf8");
  assert.match(component, /projectFilters/);
  assert.match(component, /relationFilters/);
  assert.match(component, /canOperate/);
  assert.match(component, /isAdmin/);
  assert.match(component, /deleteProject/);
  assert.match(component, /releaseRelation/);
  assert.match(component, /<form key=\{selected\.id\}/);
  assert.match(component, /auth-expired/);
});

test("channeling APIs restrict mutating actions to technical, operation, or admin roles and reserve high-risk actions for admins", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /const channelingRole =/);
  assert.match(server, /requireChannelingOperator/);
  assert.match(server, /requireChannelingAdmin/);
  assert.doesNotMatch(server, /crypto\.randomBytes\(32\)/);
  assert.match(server, /AUTH_TOKEN_SECRET/);
  assert.match(server, /app\.delete\("\/api\/channeling-projects\/:id"/);
  assert.match(server, /app\.delete\("\/api\/channeling-relations\/:id"/);
});
