import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('InjectionProjectManagement renders only server-provided import preview rows', async () => {
  const source = await readFile(new URL('../src/components/InjectionProjectManagement.tsx', import.meta.url), 'utf8');

  assert.match(source, /payload\.data\.rows/);
  assert.doesNotMatch(source, /parseClientPreview|XLSX\.read|file\.arrayBuffer/);
});
