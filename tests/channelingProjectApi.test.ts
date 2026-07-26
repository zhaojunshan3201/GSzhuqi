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
  assert.match(server, /Object\.keys\(req\.body \|\| \{\}\)\.some\(\(key\) => !allowedRelationPatchFields\.has\(key\)\)/);
  assert.match(server, /channelingErrorStatus/);
});
