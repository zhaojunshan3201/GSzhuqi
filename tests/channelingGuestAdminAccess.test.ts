import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("channeling permissions consist only of guest read-only and administrator maintenance", async () => {
  const [component, timeline, wellTracking, relationDetail, server] = await Promise.all([
    readFile(new URL("../src/components/ChannelingProjectManagement.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ChannelingTimeline.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ChannelingWellTracking.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ChannelingRelationDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
  ]);

  assert.match(component, /const canOperate = isAdmin;/);
  assert.match(component, /游客只读/);
  assert.doesNotMatch(component, /technical|technician|operation|operator/);
  assert.doesNotMatch(server, /requireChannelingOperator/);
  assert.doesNotMatch(server, /\["admin", "technical", "technician", "operation", "operator"\]/);

  assert.match(timeline, /role === 'admin' && <form[^>]*aria-label="新增跟踪记录"/);
  assert.match(wellTracking, /role === 'admin' && <form[^>]*aria-label="新建或复用单井档案"/);
  assert.match(relationDetail, /role === 'admin' \? <form[^>]*aria-label="新增效果评价"/);
  assert.match(relationDetail, /role === 'admin' && current && <button[^>]*onClick=\{onRecompute\}/);
  assert.match(relationDetail, /游客只读，可查看已形成的评价记录/);

  for (const source of [timeline, wellTracking, relationDetail]) {
    assert.doesNotMatch(source, /role === '(?:guest|user)' && <form/);
  }
});
