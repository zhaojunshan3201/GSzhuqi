import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const sourceFiles = [
  'src/App.tsx',
  'src/components/ChannelingTimeline.tsx',
  'src/components/ChannelingWellTracking.tsx',
  'src/components/ChannelingRelationDetail.tsx',
  'src/components/ChannelingWorkspace.tsx',
  'src/components/ChannelingProjectManagement.tsx',
  'src/components/OilWellMap.tsx',
  'src/lib/channelingTrackingApi.ts',
  'src/lib/sidebarNavigation.ts',
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
  const timeline = readSource('src/components/ChannelingTimeline.tsx');
  const wellTracking = readSource('src/components/ChannelingWellTracking.tsx');
  const relationDetail = readSource('src/components/ChannelingRelationDetail.tsx');
  const navigation = readSource('src/lib/sidebarNavigation.ts');
  const oilWellMap = readSource('src/components/OilWellMap.tsx');

  assert.match(projectManagement, /注窜项目台账/);
  assert.match(projectManagement, /注窜关系识别/);
  assert.match(projectManagement, /注汽窜/);
  assert.match(projectManagement, /注氮气窜/);
  assert.match(projectManagement, /有效关系/);
  assert.match(projectManagement, /重复关系/);
  assert.match(projectManagement, /自身关系/);
  assert.match(projectManagement, /无效行/);
  assert.match(projectManagement, /查看详情\/跟踪记录/);
  assert.match(wellTracking, /单井跟踪台账/);
  assert.match(navigation, /单井跟踪台账/);
  assert.match(relationDetail, /效果评价/);
  assert.match(timeline, /发现窜扰/);
  assert.match(timeline, /计划措施/);
  assert.match(timeline, /措施执行/);
  assert.match(timeline, /效果评价/);
  assert.match(timeline, /复查/);
  assert.match(timeline, /再次发生/);
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


test("expired channeling authorization clears the restored client session and prompts for login", async () => {
  const app = readSource('src/App.tsx');
  assert.match(app, /auth-expired/);
  assert.match(app, /localStorage\.removeItem\('oil_system_user'\)/);
  assert.match(app, /setShowAccessLogin\(true\)/);
});
