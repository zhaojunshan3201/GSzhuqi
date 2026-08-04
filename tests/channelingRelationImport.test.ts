import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as XLSX from 'xlsx';
import { confirmChannelingRelationImport, createChannelingRelationPreview, parseChannelingRelationRows } from '../src/lib/channelingRelationImport.ts';
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
test('reports invalid rows while retaining valid preview rows', () => { const preview = parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact], ['Z1', 'C1', h.medium], ['Z2', '', h.low], ['Z3', 'C3', '\u6781\u9ad8']])); assert.equal(preview.valid.length, 1); assert.deepEqual(preview.invalid, [{ row: 3, reason: `${h.producer} is required` }, { row: 4, reason: 'impactLevel is invalid' }]); });
test('confirms only valid preview rows and creates suspected relations as suspected', async () => { await withStore(async (db) => { const project = await createChannelingProject(db, { projectName: '\u6ce8\u7a9c\u4e00\u671f', block: 'A', owner: 'owner' }); const preview = await createChannelingRelationPreview(db, project.id, 'relations.xlsx', parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact, h.source], ['Z1', 'C1', h.high, h.suspected], ['Z2', '', h.low, h.imported]]))); assert.equal(preview.validCount, 1); assert.equal(preview.invalidCount, 1); const confirmed = await confirmChannelingRelationImport(db, preview.id); assert.equal(confirmed.status, 'confirmed'); const [relation] = await listChannelingRelations(db, { projectId: project.id }); assert.equal(relation.source, 'suspected'); assert.equal(relation.status, 'suspected'); await assert.rejects(() => confirmChannelingRelationImport(db, preview.id), /only preview imports can be confirmed/); }); });


test('requires suspected imports to start suspected and permits PATCH-style confirmation', async () => { await withStore(async (db) => { const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' }); await assert.rejects(() => createChannelingRelation(db, { projectId: project.id, injectionWell: 'Z1', productionWell: 'C1', reservoirLayer: 'S1', impactLevel: 'high', confidence: 0.8, source: 'suspected', status: 'confirmed', evidence: 'e', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-01-01', owner: 'owner' }), /must be created as suspected/); const relation = await createChannelingRelation(db, { projectId: project.id, injectionWell: 'Z1', productionWell: 'C1', reservoirLayer: 'S1', impactLevel: 'high', confidence: 0.8, source: 'suspected', status: 'suspected', evidence: 'e', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-01-01', owner: 'owner' }); assert.equal((await updateChannelingRelation(db, relation.id, { status: 'confirmed' })).status, 'confirmed'); }); });

test('retains original row numbers across blank and invalid rows', () => { const preview = parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact], ['Z1', 'C1', h.high], ['', '', ''], ['Z2', '', h.medium], ['Z3', 'C3', h.low]])); assert.deepEqual(preview.valid.map((row) => row.rowNumber), [2, 5]); assert.deepEqual(preview.invalid, [{ row: 4, reason: `${h.producer} is required` }]); });

test('serializes concurrent import confirmations on one database connection', async () => { await withStore(async (db) => { const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' }); const makePreview = (well: string) => createChannelingRelationPreview(db, project.id, `${well}.xlsx`, parseChannelingRelationRows(workbookWithRows([[h.injector, h.producer, h.impact], [well, 'C1', h.high]]))); const [first, second] = await Promise.all([makePreview('Z1'), makePreview('Z2')]); const confirmed = await Promise.all([confirmChannelingRelationImport(db, first.id), confirmChannelingRelationImport(db, second.id)]); assert.deepEqual(confirmed.map((item) => item.status), ['confirmed', 'confirmed']); assert.equal((await listChannelingRelations(db, { projectId: project.id })).length, 2); }); });
