import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceFiles = [
  'src/App.tsx',
  'src/components/ChannelingProjectManagement.tsx',
  'src/components/OilWellMap.tsx',
];

const readSource = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

test('channeling UI source has no replacement characters or placeholder runs', () => {
  for (const file of sourceFiles) {
    const source = readSource(file);
    assert.doesNotMatch(source, /\uFFFD/, `${file} contains Unicode replacement characters`);
    assert.doesNotMatch(source, /\?{3,}/, `${file} contains a placeholder question-mark run`);
  }
});

test('channeling UI exposes the primary Chinese labels', () => {
  const projectManagement = readSource('src/components/ChannelingProjectManagement.tsx');
  const oilWellMap = readSource('src/components/OilWellMap.tsx');

  assert.match(projectManagement, /注窜项目台账/);
  assert.match(oilWellMap, /关系图层/);
});
