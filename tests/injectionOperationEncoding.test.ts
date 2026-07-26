import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operation recommendation source has no replacement or question-mark Chinese placeholders", () => {
  const optimizer = readFileSync(new URL("../src/lib/injectionOperationOptimizer.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const api = server.slice(server.indexOf("const requireOperationAdmin"), server.indexOf("app.get(\"/api/injection-production/cockpit\""));
  assert.doesNotMatch(optimizer, /\uFFFD/);
  assert.doesNotMatch(api, /\uFFFD/);
  assert.doesNotMatch(api, /[\"']\?{2,}/);
  assert.match(api, /injection_operation_adjustment_audits/);
  assert.match(api, /authenticatedUser/);
});
