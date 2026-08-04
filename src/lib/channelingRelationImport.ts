import * as XLSX from 'xlsx';

import { createChannelingRelation, initChannelingProjectTables, type ChannelingType, type DatabaseLike, type ImpactLevel, type RelationSource } from './channelingProjectStore.ts';

export type ChannelingRelationImportRow = {
  rowNumber: number;
  injectorWellNo: string;
  producerWellNo: string;
  channelingType: ChannelingType;
  impactLevel?: ImpactLevel;
  reservoirLayer?: string;
  confidence?: number;
  source?: RelationSource;
  evidence?: string;
  effectiveStartDate?: string;
  effectiveEndDate?: string;
  owner?: string;
};

export type ChannelingRelationImportPreviewRows = {
  valid: ChannelingRelationImportRow[];
  duplicates: ChannelingRelationImportRow[];
  selfRelations: ChannelingRelationImportRow[];
  invalid: Array<{ row: number; reason: string }>;
};

export type ChannelingRelationImport = {
  id: number;
  projectId: number | null;
  fileName: string;
  channelingType: ChannelingType;
  status: 'preview' | 'confirmed';
  validCount: number;
  duplicateCount: number;
  selfRelationCount: number;
  invalidCount: number;
  createdAt: string;
  confirmedAt: string | null;
  valid?: ChannelingRelationImportRow[];
  duplicates?: ChannelingRelationImportRow[];
  selfRelations?: ChannelingRelationImportRow[];
  invalid?: Array<{ row: number; reason: string }>;
};

const headers = {
  injectorWellNo: '\u6ce8\u4e95', producerWellNo: '\u91c7\u6cb9\u4e95', impactLevel: '\u5f71\u54cd\u7b49\u7ea7', reservoirLayer: '\u5c42\u7cfb',
  confidence: '\u7f6e\u4fe1\u5ea6', source: '\u6765\u6e90', evidence: '\u8bc1\u636e', effectiveStartDate: '\u6709\u6548\u671f\u8d77',
  effectiveEndDate: '\u6709\u6548\u671f\u6b62', owner: '\u8d1f\u8d23\u4eba',
} as const;
type HeaderName = keyof typeof headers;
type Columns = Record<HeaderName, number | undefined>;
const requiredHeaders: readonly HeaderName[] = ['injectorWellNo', 'producerWellNo', 'impactLevel'];

export function parseChannelingRelationRows(workbook: XLSX.WorkBook, channelingType: ChannelingType = 'steam'): ChannelingRelationImportPreviewRows {
  if (!['steam', 'nitrogen'].includes(channelingType)) throw new Error('注窜类型无效');
  const sheetName = workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) throw new Error('workbook has no worksheet');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  if (!rows[0]) throw new Error('workbook is missing headers');
  const normalized = rows[0].map(normalizeHeader);
  const hasMatrixMarker = normalized.some((value) => /^井号[1-9]\d*$/.test(value));
  if (normalized[0] === '注汽井' || hasMatrixMarker) {
    const relationColumns = normalized
      .map((value, index) => ({ value, index }))
      .filter(({ value, index }) => index > 0 && /^井号[1-9]\d*$/.test(value))
      .map(({ index }) => index);
    if (normalized[0] !== '注汽井' || !relationColumns.length || normalized.slice(1).some((value) => value && !/^井号[1-9]\d*$/.test(value))) {
      throw new Error('表头必须包含“注汽井”和至少一个“井号N”列');
    }
    const formattedRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false });
    return parseMatrixRows(formattedRows, relationColumns, channelingType);
  }
  if (!normalized.some((value) => Object.values(headers).some((label) => normalizeHeader(label) === value))) {
    throw new Error('表头必须包含“注汽井”和至少一个“井号N”列');
  }
  return parseDetailedRows(rows, channelingType);
}

function parseMatrixRows(rows: unknown[][], relationColumns: number[], channelingType: ChannelingType): ChannelingRelationImportPreviewRows {
  const result: ChannelingRelationImportPreviewRows = { valid: [], duplicates: [], selfRelations: [], invalid: [] };
  const seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    if (row.every(isBlank)) return;
    const rowNumber = index + 2;
    const injectorWellNo = textAt(row, 0);
    const related = relationColumns.map((column) => textAt(row, column)).filter((value): value is string => Boolean(value));
    if (!injectorWellNo) {
      if (related.length) result.invalid.push({ row: rowNumber, reason: '注汽井不能为空' });
      return;
    }
    if (!related.length) {
      result.invalid.push({ row: rowNumber, reason: '关联井不能为空' });
      return;
    }
    for (const producerWellNo of related) {
      const relation = { rowNumber, injectorWellNo, producerWellNo, channelingType };
      if (injectorWellNo === producerWellNo) result.selfRelations.push(relation);
      else {
        const key = `${channelingType}\u0000${injectorWellNo}\u0000${producerWellNo}`;
        if (seen.has(key)) result.duplicates.push(relation);
        else { seen.add(key); result.valid.push(relation); }
      }
    }
  });
  if (!result.valid.length && !result.duplicates.length && !result.selfRelations.length) throw new Error('工作表中没有可识别的注窜关系');
  return result;
}

function parseDetailedRows(rows: unknown[][], channelingType: ChannelingType): ChannelingRelationImportPreviewRows {
  const columns = findColumns(rows[0]);
  const result: ChannelingRelationImportPreviewRows = { valid: [], duplicates: [], selfRelations: [], invalid: [] };
  const seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    if (row.every(isBlank)) return;
    const rowNumber = index + 2;
    try {
      const relation = { rowNumber, ...parseRow(row, columns), channelingType };
      const key = `${channelingType}\u0000${relation.injectorWellNo}\u0000${relation.producerWellNo}`;
      if (relation.injectorWellNo === relation.producerWellNo) result.selfRelations.push(relation);
      else if (seen.has(key)) result.duplicates.push(relation);
      else { seen.add(key); result.valid.push(relation); }
    } catch (error: any) { result.invalid.push({ row: rowNumber, reason: error.message }); }
  });
  return result;
}

export async function initChannelingRelationImportTables(db: DatabaseLike): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_relation_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, file_name TEXT NOT NULL, channeling_type TEXT NOT NULL DEFAULT 'steam', status TEXT NOT NULL DEFAULT 'preview',
    valid_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0, self_relation_count INTEGER NOT NULL DEFAULT 0, invalid_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, confirmed_at TEXT,
    FOREIGN KEY(project_id) REFERENCES channeling_projects(id)
  ); CREATE TABLE IF NOT EXISTS channeling_relation_import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER NOT NULL, row_class TEXT NOT NULL, row_number INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL, FOREIGN KEY(import_id) REFERENCES channeling_relation_imports(id)
  ); CREATE INDEX IF NOT EXISTS idx_channeling_relation_import_rows_import ON channeling_relation_import_rows(import_id, row_class);`);
  const columns = await db.all("SELECT name, [notnull] AS required FROM pragma_table_info('channeling_relation_imports')");
  const names = new Set(columns.map((column) => column.name));
  const projectId = columns.find((column) => column.name === 'project_id');
  if (projectId?.required) {
    const foreignKeys = (await db.get('PRAGMA foreign_keys'))?.foreign_keys;
    if (foreignKeys) await db.exec('PRAGMA foreign_keys=OFF');
    try {
      await db.exec('BEGIN');
      await db.exec(`CREATE TABLE channeling_relation_imports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, file_name TEXT NOT NULL, channeling_type TEXT NOT NULL DEFAULT 'steam', status TEXT NOT NULL DEFAULT 'preview',
        valid_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0, self_relation_count INTEGER NOT NULL DEFAULT 0, invalid_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, confirmed_at TEXT,
        FOREIGN KEY(project_id) REFERENCES channeling_projects(id)
      )`);
      await db.exec(`INSERT INTO channeling_relation_imports_new (id, project_id, file_name, channeling_type, status, valid_count, duplicate_count, self_relation_count, invalid_count, created_at, confirmed_at)
        SELECT id, project_id, file_name, ${names.has('channeling_type') ? 'channeling_type' : "'steam'"}, status, valid_count, ${names.has('duplicate_count') ? 'duplicate_count' : '0'}, ${names.has('self_relation_count') ? 'self_relation_count' : '0'}, invalid_count, created_at, confirmed_at FROM channeling_relation_imports`);
      await db.exec('DROP TABLE channeling_relation_imports; ALTER TABLE channeling_relation_imports_new RENAME TO channeling_relation_imports; COMMIT');
    } catch (error) {
      try { await db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      if (foreignKeys) await db.exec('PRAGMA foreign_keys=ON');
    }
  } else {
    for (const definition of ["channeling_type TEXT NOT NULL DEFAULT 'steam'", 'duplicate_count INTEGER NOT NULL DEFAULT 0', 'self_relation_count INTEGER NOT NULL DEFAULT 0']) {
      try { await db.exec(`ALTER TABLE channeling_relation_imports ADD COLUMN ${definition}`); } catch (error: any) { if (!String(error.message).includes('duplicate column name')) throw error; }
    }
  }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_channeling_relation_import_rows_import ON channeling_relation_import_rows(import_id, row_class)');
}

export async function createChannelingRelationPreview(db: DatabaseLike, projectId: number | null, fileName: string, channelingType: ChannelingType, rows: ChannelingRelationImportPreviewRows): Promise<ChannelingRelationImport> {
  if (projectId !== null && (!Number.isInteger(projectId) || projectId <= 0)) throw new Error('projectId is invalid');
  if (!['steam', 'nitrogen'].includes(channelingType)) throw new Error('channelingType is invalid');
  if (!fileName.trim()) throw new Error('fileName is required');
  await initChannelingProjectTables(db);
  await initChannelingRelationImportTables(db);
  if (projectId !== null && !await db.get('SELECT id FROM channeling_projects WHERE id = ?', [projectId])) throw new Error('Project not found');
  const now = new Date().toISOString();
  const result = await db.run(`INSERT INTO channeling_relation_imports (project_id, file_name, channeling_type, status, valid_count, duplicate_count, self_relation_count, invalid_count, created_at) VALUES (?, ?, ?, 'preview', ?, ?, ?, ?, ?)`, [projectId, fileName.trim(), channelingType, rows.valid.length, rows.duplicates.length, rows.selfRelations.length, rows.invalid.length, now]);
  const importId = result.lastID!;
  for (const [rowClass, values] of [['valid', rows.valid], ['duplicate', rows.duplicates], ['self_relation', rows.selfRelations]] as const) {
    for (const value of values) await db.run('INSERT INTO channeling_relation_import_rows (import_id, row_class, row_number, snapshot_json) VALUES (?, ?, ?, ?)', [importId, rowClass, value.rowNumber, JSON.stringify(value)]);
  }
  for (const value of rows.invalid) await db.run("INSERT INTO channeling_relation_import_rows (import_id, row_class, row_number, snapshot_json) VALUES (?, 'invalid', ?, ?)", [importId, value.row, JSON.stringify(value)]);
  return readImport(db, importId, true);
}

const confirmationQueues = new WeakMap<DatabaseLike, Promise<void>>();

function queueConfirmation<T>(db: DatabaseLike, operation: () => Promise<T>): Promise<T> {
  const previous = confirmationQueues.get(db) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  confirmationQueues.set(db, current.then(() => undefined, () => undefined));
  return current;
}

export async function confirmChannelingRelationImport(db: DatabaseLike, importId: number, projectId: number): Promise<ChannelingRelationImport> {
  return queueConfirmation(db, async () => {
    if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('projectId is required');
    await initChannelingProjectTables(db);
    await initChannelingRelationImportTables(db);
    let began = false;
    try {
      await db.exec('BEGIN IMMEDIATE');
      began = true;
      const project = await db.get('SELECT id FROM channeling_projects WHERE id = ?', [projectId]);
      if (!project) throw new Error('Project not found');
      const batch = await db.get('SELECT * FROM channeling_relation_imports WHERE id = ?', [importId]);
      if (!batch) throw new Error('channeling relation import not found');
      if (batch.status !== 'preview') throw new Error('only preview imports can be confirmed');
      if (batch.project_id !== null && batch.project_id !== projectId) throw new Error('preview belongs to another project');
      const rows = await db.all("SELECT id, snapshot_json FROM channeling_relation_import_rows WHERE import_id = ? AND row_class = 'valid' ORDER BY id", [importId]);
      const remaining: ChannelingRelationImportRow[] = [];
      let newDuplicates = 0;
      for (const stored of rows) {
        const row = JSON.parse(stored.snapshot_json) as ChannelingRelationImportRow;
        const duplicate = await db.get('SELECT id FROM channeling_relations WHERE project_id = ? AND channeling_type = ? AND injection_well = ? AND production_well = ?', [projectId, batch.channeling_type, row.injectorWellNo, row.producerWellNo]);
        if (duplicate) {
          await db.run("UPDATE channeling_relation_import_rows SET row_class = 'duplicate' WHERE id = ?", [stored.id]);
          newDuplicates++;
        } else remaining.push(row);
      }
      const today = new Date().toISOString().slice(0, 10);
      for (const row of remaining) {
        const source = row.source ?? 'import';
        await createChannelingRelation(db, {
          projectId, channelingType: batch.channeling_type, injectionWell: row.injectorWellNo, productionWell: row.producerWellNo,
          reservoirLayer: row.reservoirLayer ?? '\u672a\u63d0\u4f9b', impactLevel: row.impactLevel ?? 'medium', confidence: row.confidence ?? 0.5,
          source, status: source === 'suspected' ? 'suspected' : 'confirmed', evidence: row.evidence ?? '\u672a\u63d0\u4f9b',
          effectiveStartDate: row.effectiveStartDate ?? today, effectiveEndDate: row.effectiveEndDate ?? today, owner: row.owner ?? '\u0045\u0078\u0063\u0065\u006c\u5bfc\u5165',
        });
      }
      const now = new Date().toISOString();
      await db.run("UPDATE channeling_relation_imports SET project_id = ?, status = 'confirmed', valid_count = ?, duplicate_count = duplicate_count + ?, confirmed_at = ? WHERE id = ?", [projectId, remaining.length, newDuplicates, now, importId]);
      await db.exec('COMMIT');
      began = false;
      return readImport(db, importId, false);
    } catch (error) {
      if (began) await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function listChannelingRelationImports(db: DatabaseLike, projectId?: number): Promise<ChannelingRelationImport[]> {
  await initChannelingRelationImportTables(db);
  const where = projectId === undefined ? '' : ' WHERE project_id = ?';
  return Promise.all((await db.all(`SELECT id FROM channeling_relation_imports${where} ORDER BY created_at DESC, id DESC`, projectId === undefined ? [] : [projectId])).map((row) => readImport(db, row.id, false)));
}

export async function getChannelingRelationImport(db: DatabaseLike, id: number): Promise<ChannelingRelationImport> {
  await initChannelingRelationImportTables(db);
  return readImport(db, id, true);
}

async function readImport(db: DatabaseLike, id: number, includeRows: boolean): Promise<ChannelingRelationImport> {
  const row = await db.get('SELECT * FROM channeling_relation_imports WHERE id = ?', [id]);
  if (!row) throw new Error('channeling relation import not found');
  const result: ChannelingRelationImport = { id: row.id, projectId: row.project_id, fileName: row.file_name, channelingType: row.channeling_type, status: row.status, validCount: row.valid_count, duplicateCount: row.duplicate_count, selfRelationCount: row.self_relation_count, invalidCount: row.invalid_count, createdAt: row.created_at, confirmedAt: row.confirmed_at };
  if (includeRows) {
    const stored = await db.all('SELECT row_class, snapshot_json FROM channeling_relation_import_rows WHERE import_id = ? ORDER BY id', [id]);
    result.valid = stored.filter((item) => item.row_class === 'valid').map((item) => JSON.parse(item.snapshot_json));
    result.duplicates = stored.filter((item) => item.row_class === 'duplicate').map((item) => JSON.parse(item.snapshot_json));
    result.selfRelations = stored.filter((item) => item.row_class === 'self_relation').map((item) => JSON.parse(item.snapshot_json));
    result.invalid = stored.filter((item) => item.row_class === 'invalid').map((item) => JSON.parse(item.snapshot_json));
  }
  return result;
}

function findColumns(headerRow: unknown[]): Columns {
  const locations = new Map(headerRow.map((value, index) => [normalizeHeader(value), index]));
  const columns = {} as Columns;
  for (const [name, label] of Object.entries(headers) as Array<[HeaderName, string]>) {
    const column = locations.get(normalizeHeader(label));
    if (column === undefined && requiredHeaders.includes(name)) throw new Error(`missing required column: ${label}`);
    columns[name] = column;
  }
  return columns;
}
function parseRow(row: unknown[], columns: Columns): Omit<ChannelingRelationImportRow, 'rowNumber' | 'channelingType'> {
  const injectorWellNo = required(textAt(row, columns.injectorWellNo), '\u6ce8\u4e95');
  const producerWellNo = required(textAt(row, columns.producerWellNo), '\u91c7\u6cb9\u4e95');
  const impactLevel = parseImpactLevel(textAt(row, columns.impactLevel));
  const confidence = parseConfidence(row[columns.confidence!]);
  const source = parseSource(textAt(row, columns.source));
  const effectiveStartDate = parseDate(row[columns.effectiveStartDate!]);
  const effectiveEndDate = parseDate(row[columns.effectiveEndDate!]);
  if (effectiveStartDate && effectiveEndDate && effectiveEndDate < effectiveStartDate) throw new Error('有效期止 must not precede 有效期起');
  return omitUndefined({ injectorWellNo, producerWellNo, impactLevel, confidence, source, reservoirLayer: textAt(row, columns.reservoirLayer), evidence: textAt(row, columns.evidence), effectiveStartDate, effectiveEndDate, owner: textAt(row, columns.owner) });
}
function omitUndefined<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T; }
function isBlank(value: unknown): boolean { return value === null || value === undefined || (typeof value === 'string' && !value.trim()); }
function textAt(row: unknown[], column: number | undefined): string | undefined { return column === undefined || isBlank(row[column]) ? undefined : String(row[column]).trim(); }
function required(value: string | undefined, label: string): string { if (!value) throw new Error(`${label} is required`); return value; }
function normalizeHeader(value: unknown): string { return String(value ?? '').replace(/\s+/g, '').trim(); }
function parseImpactLevel(value: string | undefined): ImpactLevel { const levels: Record<string, ImpactLevel> = { high: 'high', '\u9ad8': 'high', medium: 'medium', '\u4e2d': 'medium', low: 'low', '\u4f4e': 'low' }; if (!value || !levels[value.toLowerCase()]) throw new Error('impactLevel is invalid'); return levels[value.toLowerCase()]; }
function parseSource(value: string | undefined): RelationSource | undefined { if (!value) return undefined; if (['suspected', '\u7591\u4f3c', '\u7591\u4f3c\u8bc6\u522b'].includes(value.toLowerCase())) return 'suspected'; if (['manual', '\u624b\u5de5'].includes(value.toLowerCase())) return 'manual'; if (['import', '\u5bfc\u5165'].includes(value.toLowerCase())) return 'import'; throw new Error('来源 is invalid'); }
function parseConfidence(value: unknown): number | undefined { if (isBlank(value)) return undefined; const parsed = typeof value === 'number' ? value : Number(String(value).replace('%', '').trim()); const normalized = parsed > 1 ? parsed / 100 : parsed; if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) throw new Error('置信度 is invalid'); return normalized; }
function parseDate(value: unknown): string | undefined { if (isBlank(value)) return undefined; if (typeof value === 'number') { const date = XLSX.SSF.parse_date_code(value); return date ? formatDate(date.y, date.m, date.d) : undefined; } const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(String(value).trim()); if (!match) throw new Error('有效期 is invalid'); return formatDate(Number(match[1]), Number(match[2]), Number(match[3])) ?? (() => { throw new Error('有效期 is invalid'); })(); }
function formatDate(year: number, month: number, day: number): string | undefined { const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : undefined; }
