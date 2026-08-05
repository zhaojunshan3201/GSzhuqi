import type { DatabaseLike } from './channelingProjectStore.ts';
import { withChannelingWriteLock } from './channelingWriteQueue.ts';

export type ChannelingWellProfile = {
  id: number;
  wellNo: string;
  normalizedWellNo: string;
  block: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

export type ChannelingWellProfileInput = { wellNo: string; block?: string; owner?: string };

export function normalizeWellNo(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('wellNo is required');
  return value.trim().toUpperCase();
}

export async function initChannelingWellTables(db: DatabaseLike): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_well_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    well_no TEXT NOT NULL,
    normalized_well_no TEXT NOT NULL UNIQUE,
    block TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_channeling_well_profiles_block ON channeling_well_profiles(block);`);
}

const mapProfile = (row: any): ChannelingWellProfile => ({
  id: row.id,
  wellNo: row.well_no,
  normalizedWellNo: row.normalized_well_no,
  block: row.block,
  owner: row.owner,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function ensureWellProfileUnlocked(db: DatabaseLike, input: ChannelingWellProfileInput): Promise<ChannelingWellProfile> {
  const normalizedWellNo = normalizeWellNo(input.wellNo);
  const existing = await db.get('SELECT * FROM channeling_well_profiles WHERE normalized_well_no = ?', [normalizedWellNo]);
  if (existing) return mapProfile(existing);

  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO channeling_well_profiles (well_no, normalized_well_no, block, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [input.wellNo.trim(), normalizedWellNo, input.block?.trim() || '', input.owner?.trim() || '', now, now],
  );
  return mapProfile(await db.get('SELECT * FROM channeling_well_profiles WHERE id = ?', [result.lastID]));
}

export function createWellProfile(db: DatabaseLike, input: ChannelingWellProfileInput): Promise<ChannelingWellProfile> {
  return withChannelingWriteLock(db, () => ensureWellProfileUnlocked(db, input));
}

export async function listWellProfiles(
  db: DatabaseLike,
  filters: { query?: string; block?: string } = {},
): Promise<ChannelingWellProfile[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.query?.trim()) {
    clauses.push('(normalized_well_no LIKE ? OR well_no LIKE ?)');
    params.push(`%${normalizeWellNo(filters.query)}%`, `%${filters.query.trim()}%`);
  }
  if (filters.block?.trim()) {
    clauses.push('block = ?');
    params.push(filters.block.trim());
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return (await db.all(`SELECT * FROM channeling_well_profiles${where} ORDER BY updated_at DESC, id DESC`, params)).map(mapProfile);
}

export async function getWellProfile(db: DatabaseLike, id: number): Promise<ChannelingWellProfile> {
  const row = await db.get('SELECT * FROM channeling_well_profiles WHERE id = ?', [id]);
  if (!row) throw new Error('Well profile not found');
  return mapProfile(row);
}

export function updateWellProfile(
  db: DatabaseLike,
  id: number,
  input: { block: string; owner: string; updatedAt: string },
): Promise<ChannelingWellProfile> {
  return withChannelingWriteLock(db, async () => {
    const wallClock = new Date().getTime();
    const previousToken = Date.parse(input.updatedAt);
    const nextToken = Number.isNaN(previousToken) ? wallClock : Math.max(wallClock, previousToken + 1);
    const now = new Date(nextToken).toISOString();
    const result = await db.run(
      'UPDATE channeling_well_profiles SET block = ?, owner = ?, updated_at = ? WHERE id = ? AND updated_at = ?',
      [input.block.trim(), input.owner.trim(), now, id, input.updatedAt],
    ) as { changes?: number };
    if (result.changes !== 1) {
      if (!await db.get('SELECT id FROM channeling_well_profiles WHERE id = ?', [id])) throw new Error('Well profile not found');
      throw new Error('Well profile changed; refresh and retry');
    }
    return mapProfile(await db.get('SELECT * FROM channeling_well_profiles WHERE id = ?', [id]));
  });
}
