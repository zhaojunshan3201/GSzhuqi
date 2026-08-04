import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('registers channeling APIs on the canonical nested project routes', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /app\.get\("\/api\/channeling-projects\/:id\/relations"/);
  assert.match(server, /app\.post\("\/api\/channeling-projects\/:id\/relations"/);
  assert.match(server, /app\.patch\("\/api\/channeling-relations\/:id"/);
  assert.doesNotMatch(server, /\/api\/channeling-project-relations/);
});

test('patch route permits only documented editable relation fields and maps unexpected errors to 500', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /const allowedRelationPatchFields = new Set/);
  assert.match(server, /allowedRelationPatchFields = new Set\(\[[^\]]*"channelingType"/);
  assert.match(server, /Object\.keys\(req\.body \|\| \{\}\)\.some\(\(key\) => !allowedRelationPatchFields\.has\(key\)\)/);
  assert.match(server, /channelingErrorStatus/);
});

test('registers standalone relationship import preview, detail and confirmation routes', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /app\.post\("\/api\/channeling-relation-imports\/preview"/);
  assert.match(server, /app\.post\("\/api\/channeling-relation-imports\/preview", requireChannelingAdminMiddleware, channelingRelationImportUploadMiddleware/);
  assert.match(server, /app\.get\("\/api\/channeling-relation-imports\/:id"/);
  assert.match(server, /getChannelingRelationImport/);
  assert.match(server, /confirmChannelingRelationImport\(localDb, importId, projectId\)/);
  assert.match(server, /channelingType: typeof req\.query\.channelingType === "string" \? req\.query\.channelingType : undefined/);
  assert.match(server, /channelingType: req\.body\?\.channelingType \?\? "steam"/);
  assert.match(server, /\\u4e0a\\u4f20\\u6587\\u4ef6\\u8fc7\\u5927/);
});
