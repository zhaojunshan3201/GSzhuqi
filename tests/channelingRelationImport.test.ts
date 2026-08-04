import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as XLSX from 'xlsx';
import { confirmChannelingRelationImport, createChannelingRelationPreview, getChannelingRelationImport, initChannelingRelationImportTables, parseChannelingRelationRows } from '../src/lib/channelingRelationImport.ts';
import { createChannelingProject, createChannelingRelation, initChannelingProjectTables, listChannelingRelations, updateChannelingRelation } from '../src/lib/channelingProjectStore.ts';
const h = { injector: '\u6ce8\u4e95', producer: '\u91c7\u6cb9\u4e95', impact: '\u5f71\u54cd\u7b49\u7ea7', confidence: '\u7f6e\u4fe1\u5ea6', source: '\u6765\u6e90', high: '\u9ad8', medium: '\u4e2d', low: '\u4f4e', suspected: '\u7591\u4f3c\u8bc6\u522b', imported: '\u5bfc\u5165' };
function workbookWithRows(rows: unknown[][]): XLSX.WorkBook { const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'relations'); return workbook; }
const matrixWorkbook = (rows: unknown[][]) => workbookWithRows(rows);
function matrixWorkbookWithFormattedWell(): XLSX.WorkBook {
  const workbook = matrixWorkbook([['注汽井', '井号1'], ['Z1', 24]]);
  workbook.Sheets.relations.B2.z = '000';
  return workbook;
}
async function withStore(run: (db: any) => Promise<void>) { const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-relation-import-')); const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database }); try { await initChannelingProjectTables(db); await run(db); } finally { await db.close(); await rm(directory, { recursive: true, force: true }); } }
test('parses the existing detailed template and adds the selected channeling type', () => { const preview = parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact, h.confidence, h.source], ['Z1', 'C1', h.high, 80, h.suspected]]), 'nitrogen'); assert.deepEqual(preview.valid, [{ rowNumber: 2, injectorWellNo: 'Z1', producerWellNo: 'C1', channelingType: 'nitrogen', impactLevel: 'high', confidence: 0.8, source: 'suspected' }]); assert.deepEqual(preview.invalid, []); assert.deepEqual(preview.duplicates, []); assert.deepEqual(preview.selfRelations, []); });

test('expands variable 井号N columns into directed relations without changing well numbers', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1', '井号2', '井号3'],
    [' 高3-6-莲H1 ', '  高3-6-024 ', '高3-6-0245  ', ''],
  ]), 'steam');
  assert.deepEqual(preview.valid, [
    { rowNumber: 2, injectorWellNo: '高3-6-莲H1', producerWellNo: '高3-6-024', channelingType: 'steam' },
    { rowNumber: 2, injectorWellNo: '高3-6-莲H1', producerWellNo: '高3-6-0245', channelingType: 'steam' },
  ]);
});

test('preserves the displayed leading zeros of formatted numeric well cells', () => {
  const preview = parseChannelingRelationRows(matrixWorkbookWithFormattedWell(), 'steam');
  assert.equal(preview.valid[0].producerWellNo, '024');
});

test('classifies self-relations and duplicate directed relations', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1', '井号2', '井号3'],
    ['高3-1-051C2', '高3-1-051C2', '高3-1-045', '高3-1-045'],
  ]), 'nitrogen');
  assert.equal(preview.valid.length, 1);
  assert.deepEqual(preview.selfRelations.map((row) => row.producerWellNo), ['高3-1-051C2']);
  assert.deepEqual(preview.duplicates.map((row) => row.producerWellNo), ['高3-1-045']);
});

test('reports a matrix row with related wells but no injection well as invalid', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1'],
    ['', '高3-1-045'],
    ['', ''],
    ['Z1', 'C1'],
  ]), 'steam');
  assert.deepEqual(preview.invalid, [{ row: 2, reason: '注汽井不能为空' }]);
  assert.equal(preview.valid.length, 1);
});

test('reports a matrix row with an injection well but no related wells as invalid', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1'],
    ['Z1', ''],
    ['Z2', 'C2'],
  ]), 'steam');
  assert.deepEqual(preview.invalid, [{ row: 2, reason: '关联井不能为空' }]);
  assert.equal(preview.valid.length, 1);
});

test('classifies duplicate directed relations across matrix rows', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1'],
    ['Z1', 'C1'],
    ['Z1', 'C1'],
  ]), 'steam');
  assert.deepEqual(preview.valid.map((row) => row.rowNumber), [2]);
  assert.deepEqual(preview.duplicates.map((row) => row.rowNumber), [3]);
});

test('rejects invalid matrix headers', () => {
  assert.throws(
    () => parseChannelingRelationRows(matrixWorkbook([['井名', '关联井'], ['A', 'B']]), 'steam'),
    /表头必须包含“注汽井”和至少一个“井号N”列/,
  );
});

test('rejects matrix-intent headers when column A is not 注汽井', () => {
  assert.throws(
    () => parseChannelingRelationRows(matrixWorkbook([['注井', '井号1'], ['A', 'B']]), 'steam'),
    /表头必须包含“注汽井”和至少一个“井号N”列/,
  );
});

test('rejects a matrix workbook without a recognizable relation', () => {
  assert.throws(
    () => parseChannelingRelationRows(matrixWorkbook([['注汽井', '井号1'], ['A', '']]), 'steam'),
    /工作表中没有可识别的注窜关系/,
  );
});
test('reports invalid rows while retaining valid preview rows', () => { const preview = parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact], ['Z1', 'C1', h.medium], ['Z2', '', h.low], ['Z3', 'C3', '\u6781\u9ad8']]), 'steam'); assert.equal(preview.valid.length, 1); assert.deepEqual(preview.invalid, [{ row: 3, reason: `${h.producer} is required` }, { row: 4, reason: 'impactLevel is invalid' }]); });
test('confirms only valid preview rows and creates suspected relations as suspected', async () => { await withStore(async (db) => { const project = await createChannelingProject(db, { projectName: '\u6ce8\u7a9c\u4e00\u671f', block: 'A', owner: 'owner' }); const preview = await createChannelingRelationPreview(db, project.id, 'relations.xlsx', 'steam', parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact, h.source], ['Z1', 'C1', h.high, h.suspected], ['Z2', '', h.low, h.imported]]), 'steam')); assert.equal(preview.validCount, 1); assert.equal(preview.invalidCount, 1); const confirmed = await confirmChannelingRelationImport(db, preview.id, project.id); assert.equal(confirmed.status, 'confirmed'); const [relation] = await listChannelingRelations(db, { projectId: project.id }); assert.equal(relation.source, 'suspected'); assert.equal(relation.status, 'suspected'); await assert.rejects(() => confirmChannelingRelationImport(db, preview.id, project.id), /only preview imports can be confirmed/); }); });


test('requires suspected imports to start suspected and permits PATCH-style confirmation', async () => { await withStore(async (db) => { const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' }); await assert.rejects(() => createChannelingRelation(db, { projectId: project.id, channelingType: 'steam', injectionWell: 'Z1', productionWell: 'C1', reservoirLayer: 'S1', impactLevel: 'high', confidence: 0.8, source: 'suspected', status: 'confirmed', evidence: 'e', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-01-01', owner: 'owner' }), /must be created as suspected/); const relation = await createChannelingRelation(db, { projectId: project.id, channelingType: 'steam', injectionWell: 'Z1', productionWell: 'C1', reservoirLayer: 'S1', impactLevel: 'high', confidence: 0.8, source: 'suspected', status: 'suspected', evidence: 'e', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-01-01', owner: 'owner' }); assert.equal((await updateChannelingRelation(db, relation.id, { status: 'confirmed' })).status, 'confirmed'); }); });

test('retains original row numbers across blank and invalid rows', () => { const preview = parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact], ['Z1', 'C1', h.high], ['', '', ''], ['Z2', '', h.medium], ['Z3', 'C3', h.low]]), 'steam'); assert.deepEqual(preview.valid.map((row) => row.rowNumber), [2, 5]); assert.deepEqual(preview.invalid, [{ row: 4, reason: `${h.producer} is required` }]); });

test('serializes concurrent import confirmations on one database connection', async () => { await withStore(async (db) => { const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' }); const makePreview = (well: string) => createChannelingRelationPreview(db, null, `${well}.xlsx`, 'steam', parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact], [well, 'C1', h.high]]), 'steam')); const [first, second] = await Promise.all([makePreview('Z1'), makePreview('Z2')]); const confirmed = await Promise.all([confirmChannelingRelationImport(db, first.id, project.id), confirmChannelingRelationImport(db, second.id, project.id)]); assert.deepEqual(confirmed.map((item) => item.status), ['confirmed', 'confirmed']); assert.equal((await listChannelingRelations(db, { projectId: project.id })).length, 2); }); });


test('persists an unbound preview with every row category and confirms it later', async () => { await withStore(async (db) => {
  const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' });
  const rows = { valid: [{ rowNumber: 2, injectorWellNo: 'Z1', producerWellNo: 'C1', channelingType: 'nitrogen' as const }], duplicates: [{ rowNumber: 3, injectorWellNo: 'Z1', producerWellNo: 'C1', channelingType: 'nitrogen' as const }], selfRelations: [{ rowNumber: 4, injectorWellNo: 'Z1', producerWellNo: 'Z1', channelingType: 'nitrogen' as const }], invalid: [{ row: 5, reason: 'bad' }] };
  const preview = await createChannelingRelationPreview(db, null, 'relations.xlsx', 'nitrogen', rows);
  assert.equal(preview.projectId, null);
  assert.deepEqual([preview.validCount, preview.duplicateCount, preview.selfRelationCount, preview.invalidCount], [1, 1, 1, 1]);
  const stored = await getChannelingRelationImport(db, preview.id);
  assert.deepEqual([stored.valid?.length, stored.duplicates?.length, stored.selfRelations?.length, stored.invalid?.length], [1, 1, 1, 1]);
  const confirmed = await confirmChannelingRelationImport(db, preview.id, project.id);
  assert.equal(confirmed.projectId, project.id);
  assert.equal((await listChannelingRelations(db, { channelingType: 'nitrogen' })).length, 1);
}); });

test('rejects invalid explicit preview channeling type even with no valid rows', async () => { await withStore(async (db) => {
  await assert.rejects(() => createChannelingRelationPreview(db, null, 'bad.xlsx', 'water' as any, { valid: [], duplicates: [], selfRelations: [], invalid: [{ row: 2, reason: 'bad' }] }), /channelingType/);
}); });

test('reclassifies target-project duplicates but keeps the same pair for another type', async () => { await withStore(async (db) => {
  const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' });
  await createChannelingRelation(db, { projectId: project.id, channelingType: 'steam', injectionWell: 'Z1', productionWell: 'C1', reservoirLayer: 'S1', impactLevel: 'high', confidence: 0.8, source: 'manual', status: 'confirmed', evidence: 'e', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-01-01', owner: 'owner' });
  const make = (type: 'steam' | 'nitrogen') => createChannelingRelationPreview(db, null, type + '.xlsx', type, { valid: [{ rowNumber: 2, injectorWellNo: 'Z1', producerWellNo: 'C1', channelingType: type }], duplicates: [], selfRelations: [], invalid: [] });
  const steam = await make('steam');
  const confirmedSteam = await confirmChannelingRelationImport(db, steam.id, project.id);
  assert.deepEqual([confirmedSteam.validCount, confirmedSteam.duplicateCount], [0, 1]);
  await confirmChannelingRelationImport(db, (await make('nitrogen')).id, project.id);
  assert.equal((await listChannelingRelations(db, { projectId: project.id })).length, 2);
}); });

test('migrates old non-null import batches without losing row data or its index', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-import-migration-')); const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec('PRAGMA foreign_keys=ON; CREATE TABLE channeling_projects (id INTEGER PRIMARY KEY); INSERT INTO channeling_projects VALUES (1); CREATE TABLE channeling_relation_imports (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, file_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'preview\', valid_count INTEGER NOT NULL DEFAULT 0, invalid_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, confirmed_at TEXT, FOREIGN KEY(project_id) REFERENCES channeling_projects(id)); CREATE TABLE channeling_relation_import_rows (id INTEGER PRIMARY KEY, import_id INTEGER NOT NULL, row_class TEXT NOT NULL, row_number INTEGER NOT NULL, snapshot_json TEXT NOT NULL, FOREIGN KEY(import_id) REFERENCES channeling_relation_imports(id)); CREATE INDEX idx_channeling_relation_import_rows_import ON channeling_relation_import_rows(import_id, row_class); INSERT INTO channeling_relation_imports VALUES (1, 1, \'old.xlsx\', \'preview\', 1, 0, \'now\', NULL); INSERT INTO channeling_relation_import_rows VALUES (1, 1, \'valid\', 2, \'{"rowNumber":2,"injectorWellNo":"Z1","producerWellNo":"C1","channelingType":"steam"}\');');
    await initChannelingRelationImportTables(db);
    const migrated = await getChannelingRelationImport(db, 1);
    assert.equal(migrated.channelingType, 'steam'); assert.equal(migrated.valid?.length, 1);
    assert.equal((await db.get("SELECT [notnull] AS required FROM pragma_table_info('channeling_relation_imports') WHERE name='project_id'")).required, 0);
    assert.ok(await db.get("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_channeling_relation_import_rows_import'"));
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});


test('rolls back relation inserts and preview confirmation when confirmation fails', async () => { await withStore(async (db) => {
  const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' });
  const preview = await createChannelingRelationPreview(db, null, 'rollback.xlsx', 'steam', { valid: [{ rowNumber: 2, injectorWellNo: 'Z1', producerWellNo: 'C1', channelingType: 'steam' }], duplicates: [], selfRelations: [], invalid: [] });
  const failingDb = { exec: db.exec.bind(db), get: db.get.bind(db), all: db.all.bind(db), run: async (sql: string, params?: unknown[]) => { if (sql.startsWith('INSERT INTO channeling_relations ')) throw new Error('forced relation failure'); return db.run(sql, params); } };
  await assert.rejects(() => confirmChannelingRelationImport(failingDb, preview.id, project.id), /forced relation failure/);
  assert.equal((await getChannelingRelationImport(db, preview.id)).status, 'preview');
  assert.equal((await listChannelingRelations(db, { projectId: project.id })).length, 0);
}); });


test('classifies detailed self-pairs and duplicates and confirms only one valid relation', async () => { await withStore(async (db) => {
  const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' });
  const parsed = parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact, h.source], ['Z1', 'Z1', h.high, h.suspected], ['Z1', 'C1', h.high, h.suspected], ['Z1', 'C1', h.high, h.suspected]]), 'steam');
  assert.deepEqual(parsed.selfRelations.map((row) => row.rowNumber), [2]);
  assert.deepEqual(parsed.valid.map((row) => row.rowNumber), [3]);
  assert.deepEqual(parsed.duplicates.map((row) => row.rowNumber), [4]);
  const preview = await createChannelingRelationPreview(db, null, 'detailed.xlsx', 'steam', parsed);
  await confirmChannelingRelationImport(db, preview.id, project.id);
  const relations = await listChannelingRelations(db, { projectId: project.id });
  assert.equal(relations.length, 1);
  assert.equal(relations[0].source, 'suspected');
  assert.equal(relations[0].status, 'suspected');
}); });
