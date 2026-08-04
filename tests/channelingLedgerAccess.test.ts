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

test("channeling relation recognition stays available before project selection and uses standalone preview confirmation", async () => {
  const component = await readFile(new URL("../src/components/ChannelingProjectManagement.tsx", import.meta.url), "utf8");
  const recognitionCard = component.indexOf("注窜关系识别");
  const standaloneEndpoint = component.indexOf("/api/channeling-relation-imports/preview");
  const typeControls = component.indexOf('name="channeling-type"');
  const selectedDetail = component.indexOf("{selected ?");

  assert.ok(recognitionCard >= 0, "persistent recognition card should be rendered");
  assert.ok(standaloneEndpoint >= 0, "standalone preview endpoint should be used");
  assert.ok(typeControls >= 0, "manual channeling type controls should be rendered");
  assert.ok(selectedDetail >= 0, "selected project detail conditional should remain");
  assert.ok(recognitionCard < selectedDetail, "recognition card should render outside selected project detail");
  assert.ok(standaloneEndpoint < selectedDetail, "preview behavior should not depend on a selected project");
  assert.ok(typeControls < selectedDetail, "type controls should render outside selected project detail");
  assert.match(component, /\/api\/channeling-relation-imports\/preview/);
  assert.match(component, /body\.append\('channelingType', channelingType\)/);
  assert.match(component, /\/api\/channeling-relation-imports\/\$\{preview\.id\}\/confirm/);
  assert.match(component, /JSON\.stringify\(\{ projectId: previewProjectId \}\)/);
  assert.match(component, /没有项目可确认，请先通过上方表单新建项目/);
  assert.match(component, /展开全部有效关系/);
  assert.match(component, /\{isAdmin && <div className="mt-4 flex flex-wrap items-end gap-3"/);
  assert.doesNotMatch(component, /\/api\/channeling-projects\/\$\{selected\.id\}\/relation-imports\/preview/);
  assert.equal((component.match(/type="file"/g) || []).length, 1, "component should expose one upload input");
});

test("channeling relation type is supported by filters, rows and manual drafts", async () => {
  const component = await readFile(new URL("../src/components/ChannelingProjectManagement.tsx", import.meta.url), "utf8");
  assert.match(component, /channelingType: 'steam'/);
  assert.match(component, /relationFilters\.channelingType/);
  assert.match(component, /channelingType=\$\{encodeURIComponent\(relationFilters\.channelingType\)\}/);
  assert.match(component, /setRelationDraft\(\{ \.\.\.relationDraft, channelingType:/);
  assert.match(component, /channelingTypeLabels\[row\.channelingType\]/);
});

test("channeling APIs reserve every mutating action for administrators", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /const channelingRole =/);
  assert.doesNotMatch(server, /requireChannelingOperator/);
  assert.match(server, /requireChannelingAdmin/);
  assert.match(server, /crypto\.randomBytes\(32\)/);
  assert.match(server, /AUTH_TOKEN_SECRET/);
  assert.match(server, /app\.delete\("\/api\/channeling-projects\/:id"/);
  assert.match(server, /app\.delete\("\/api\/channeling-relations\/:id"/);
});
