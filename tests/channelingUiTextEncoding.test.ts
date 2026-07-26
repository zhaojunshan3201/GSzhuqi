import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const sourceFiles = [
  'src/App.tsx',
  'src/components/ChannelingProjectManagement.tsx',
  'src/components/OilWellMap.tsx',
];

const readSource = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

const loadDecodeMojibakeText = () => {
  const source = readSource('src/App.tsx');
  const match = source.match(/const decodeMojibakeText = \(value: unknown\) => \{[\s\S]*?\n\};/);
  assert.ok(match, 'decodeMojibakeText should exist in App.tsx');

  const compiled = ts.transpileModule(`${match[0]}\nreturn decodeMojibakeText;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  return new Function(compiled)() as (value: unknown) => string;
};

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

test('decodes UTF-8 Chinese text represented as Latin-1', () => {
  const decodeMojibakeText = loadDecodeMojibakeText();
  const original = '注水运行计划.xlsx';
  const latin1 = Buffer.from(original, 'utf8').toString('latin1');

  assert.equal(decodeMojibakeText(latin1), original);
});

test('does not return replacement characters for invalid UTF-8 bytes', () => {
  const decodeMojibakeText = loadDecodeMojibakeText();
  const invalidUtf8 = String.fromCharCode(0xe6, 0x97);

  assert.equal(decodeMojibakeText(invalidUtf8), invalidUtf8);
  assert.doesNotMatch(decodeMojibakeText(invalidUtf8), /\uFFFD/);
});
