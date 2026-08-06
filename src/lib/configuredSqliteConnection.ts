import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

export async function configureSqliteConnection<T extends { exec(sql: string): Promise<void> }>(db: T): Promise<T> {
  await db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  return db;
}

export async function openConfiguredSqliteDatabase(filename: string): Promise<Database> {
  const db = await open({ filename, driver: sqlite3.Database });
  try {
    return await configureSqliteConnection(db);
  } catch (error) {
    await db.close();
    throw error;
  }
}
