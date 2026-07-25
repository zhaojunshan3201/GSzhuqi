import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import oracledb from "oracledb";
import dotenv from "dotenv";
import multer from "multer";

import sqlite3 from "sqlite3";
import { open } from "sqlite";
import * as XLSX from "xlsx";
import { MEASURE_IMPORT_FILE_TYPE_MESSAGE, isHtmlMeasureImportFile, isMeasureImportWorkbookFile } from "./src/lib/measureImportUpload.ts";
import { parseWellTemperatureWorkbook } from "./src/lib/wellTemperature.ts";
import { isWellTemperatureClientError } from "./src/lib/wellTemperatureApi.ts";
import {
  deleteWellTemperatureTest,
  getWellTemperatureTest,
  initWellTemperatureTables,
  listWellTemperatureTests,
  replaceWellTemperatureTest,
} from "./src/lib/wellTemperatureStore.ts";
import {
  getSelectionWellDetail,
  initMeasureWellSelectionTables,
  listSelectionWells,
  type SelectionFilter,
} from "./src/lib/measureWellSelectionStore.ts";
import { importMeasureWellWorkbook } from "./src/lib/measureWellImport.ts";
import { alignOilCurve, evaluateWells } from "./src/lib/measureWellSelection.ts";
import { buildSelectionCyclesFromTrackingRows } from "./src/lib/measureWellSelectionData.ts";
import { parseProducingWellsWorkbook, validateWellMapMarkerInput } from "./src/lib/oilWellMap.ts";
import { getExternalTransferUpload, initExternalTransferTables, replaceExternalTransferUpload } from "./src/lib/externalTransferStore.ts";
import { buildInjectionProductionCockpit } from "./src/lib/injectionProductionCockpit.ts";
import { buildInjectionPlanActualComparison, type ComparisonStatus } from "./src/lib/injectionPlanActualComparison.ts";
import { createInjectionProject, initInjectionProjectTables, listInjectionProjects, listProjectPendingItems, transitionInjectionProject, updatePlanStatus } from "./src/lib/injectionProjectStore.ts";
import { parseMonthlyInjectionPlan } from "./src/lib/monthlyInjectionPlanParser.ts";
import { confirmPlanImport, createPlanPreview, initMonthlyInjectionPlanImportTables, listPlanImports } from "./src/lib/monthlyInjectionPlanImportStore.ts";
import { decodeUploadedFileName } from "./src/lib/uploadFileName.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, "production.db");
const WELL_MAP_DATA_DIR = [
  path.resolve(__dirname, "..", "..", "井位图"),
  path.resolve(__dirname, "..", "..", "..", "..", "井位图"),
].find((candidate) => fs.existsSync(candidate)) || path.resolve(__dirname, "..", "..", "井位图");
const WELL_MAP_DAILY_FILE = path.join(WELL_MAP_DATA_DIR, "日数据.xlsx");
const DEFAULT_SYNC_START_DATE = "2020-01-01";
const OVERALL_SCOPE_VALUE = "__overall__";
const DASHBOARD_BOOTSTRAP_CACHE_KEY = "dashboard_bootstrap";
const WELLS_CACHE_KEY = "wells_list";
const BLOCKS_CACHE_KEY = "blocks_list";
const STATIONS_CACHE_KEY = "stations_list";
const CHART_CACHE_TTL_MS = 1000 * 60 * 5;
const INCREMENTAL_SYNC_INTERVAL_MS = 1000 * 60 * 60 * 4;
const DAILY_REBUILD_CHECK_INTERVAL_MS = 1000 * 60 * 60;
const REQUEST_BODY_LIMIT = "20mb";
const MEASURE_IMPORT_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
const WATER_CUT_FORMULA_VERSION = "2026-04-14-v4";
const GAS_FORMULA_VERSION = "2026-04-14-v2";
const LOCAL_ONLY_MODE = process.env.LOCAL_ONLY === "true";
const CHART_BLOCK_GROUPS: Record<string, string[]> = {
  "___246___": ["246___L6", "246___L5"],
  "___3618___": ["3618___L4", "3618___L5", "3618___L6"],
  "___3624___": ["3624___(___)L5", "3624___(___)L6", "3624___(___)L5", "3624___(___)L6"],
  "___3___": ["3___L5", "3___L6", "3___L7", "数据获取失败", "___372108"],
  "___21___": ["___21(___)", "___21(___)"]
};

function normalizeBlockAliasKey(block: string) {
  return block.trim().replace(/\s+/g, "").replace(/\(/g, "___").replace(/\)/g, "___");
}

function buildRawBlockAliases(block: string) {
  const base = normalizeBlockAliasKey(block);
  const variants = new Set<string>([
    block.trim(),
    base,
    base.replace(/___/g, "(").replace(/___/g, ")")
  ]);

  if (base.includes("_________")) {
    variants.add(base.replace("_________", "___"));
    variants.add(base.replace("_________", "(___)"));
  }

  if (base.includes("_________")) {
    variants.add(base.replace("_________", "___"));
    variants.add(base.replace("_________", "(___)"));
  }

  return Array.from(variants);
}

const RAW_BLOCK_ALIASES = Object.fromEntries(
  Object.values(CHART_BLOCK_GROUPS)
    .flat()
    .map((block) => [block, buildRawBlockAliases(block)])
) as Record<string, string[]>;

const RAW_BLOCK_TO_CANONICAL = Object.fromEntries(
  Object.entries(RAW_BLOCK_ALIASES).flatMap(([canonicalBlock, aliases]) =>
    aliases.map((alias) => [normalizeBlockAliasKey(alias), canonicalBlock])
  )
) as Record<string, string>;

const RAW_BLOCK_TO_CHART_BLOCK = Object.fromEntries(
  Object.entries(CHART_BLOCK_GROUPS).flatMap(([chartBlock, sourceBlocks]) =>
    sourceBlocks.flatMap((sourceBlock) =>
      (RAW_BLOCK_ALIASES[sourceBlock] || [sourceBlock]).map((alias) => [normalizeBlockAliasKey(alias), chartBlock])
    )
  )
) as Record<string, string>;

// --- Oracle Thick Mode Initialization ---
if (!LOCAL_ONLY_MODE && process.env.ORACLE_LIB_DIR) {
  try {
    oracledb.initOracleClient({ libDir: process.env.ORACLE_LIB_DIR });
    console.log("Oracle Thick Mode initialized with libDir:", process.env.ORACLE_LIB_DIR);
  } catch (err) {
    console.error("Failed to initialize Oracle Thick Mode:", err);
  }
}

// Oracle Database Configuration
const dbConfig = {
  user: process.env.ORACLE_USER || "a1a2_sjjk_ejdw_gc",
  password: process.env.ORACLE_PASSWORD || "LH24sjjkcx_gsls8",
  connectString: process.env.ORACLE_CONNECTION_STRING || "10.70.2.33:1521/orcl"
};
let oraclePoolPromise: Promise<any> | null = null;

function hasOracleConfig() {
  if (LOCAL_ONLY_MODE) {
    return false;
  }

  return Boolean(
    process.env.ORACLE_USER &&
      process.env.ORACLE_PASSWORD &&
      process.env.ORACLE_CONNECTION_STRING &&
      process.env.ORACLE_USER !== "a1a2_sjjk_ejdw_gc_placeholder"
  );
}

async function getOraclePool() {
  if (!hasOracleConfig()) {
    throw new Error("DB_NOT_CONFIGURED");
  }

  if (!oraclePoolPromise) {
    oraclePoolPromise = oracledb.createPool({
      ...dbConfig,
      poolMin: 1,
      poolMax: 3,
      poolIncrement: 1,
      queueTimeout: 30000,
      connectTimeout: 15,
      enableStatistics: false
    });
  }

  return oraclePoolPromise;
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function withTimingLog<T>(label: string, fn: () => Promise<T>) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[${new Date().toISOString()}] ${label} _________ ${Date.now() - start}ms`);
  }
}

function getMemoryCacheEntry<T>(cache: Map<string, { expiresAt: number; data: T }>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setMemoryCacheEntry<T>(cache: Map<string, { expiresAt: number; data: T }>, key: string, data: T) {
  cache.set(key, {
    expiresAt: Date.now() + CHART_CACHE_TTL_MS,
    data
  });
}

function clearChartMemoryCache() {
  blockChartMemoryCache.clear();
  wellChartMemoryCache.clear();
}

function buildChartData(rows: any[]) {
  return {
    dates: rows.map((r: any) => r.date),
    liquid: rows.map((r: any) => Number(r.liquid ?? 0)),
    oil: rows.map((r: any) => Number(r.oil ?? 0)),
    diluent: rows.map((r: any) => Number(r.diluent ?? 0)),
    water_cut: rows.map((r: any) => Number(r.water_cut ?? 0)),
    gas: rows.map((r: any) => Number(r.gas ?? 0))
  };
}

const ORACLE_PRODUCTION_METRICS_SQL = `
  ROUND((a.rcyl + a.rcsl + NVL(a.rcyl2, 0)), 1) as "liquid",
  ROUND(a.rcyl, 1) as "oil",
  NVL(a.rcyl2, 0) as "diluent",
  CASE
    WHEN NVL(a.rcyl2, 0) > 0 THEN
      ROUND(100 - 100 * (a.rcyl + NVL(a.rcyl2, 0)) / (a.rcyl + a.rcsl + NVL(a.rcyl2, 0)), 1)
    ELSE
      ROUND(a.rcsl / (a.rcyl + a.rcsl + 0.0001) * 100, 0)
  END as "water_cut",
  ROUND((NVL(a.rcbsq, 0) + NVL(a.rcql, 0)), 0) as "gas"
`;

const ORACLE_PRODUCTION_SCOPE_SQL = `
  a.jh = c.jh
  AND a.jh IN (SELECT jh FROM daa01 WHERE km = '高采采油作业三区')
  AND a.scsj > 0
`;

function buildSqliteWaterCutSql(liquidExpr: string, oilExpr: string, diluentExpr: string) {
  const waterExpr = `CASE WHEN (${liquidExpr}) - (${oilExpr}) - (${diluentExpr}) > 0 THEN (${liquidExpr}) - (${oilExpr}) - (${diluentExpr}) ELSE 0 END`;
  return `
    CASE
      WHEN (${diluentExpr}) > 0 THEN
        ROUND(
          100 - 100.0 * ((${oilExpr}) + (${diluentExpr})) / CASE
            WHEN (${liquidExpr}) > 0 THEN (${liquidExpr})
            ELSE 0.0001
          END,
          1
        )
      ELSE
        ROUND(
          100.0 * (${waterExpr}) / ((${oilExpr}) + (${waterExpr}) + 0.0001),
          0
        )
    END
  `;
}

const SQLITE_ROW_WATER_CUT_SQL = buildSqliteWaterCutSql("COALESCE(liquid, 0)", "COALESCE(oil, 0)", "COALESCE(diluent, 0)");
const SQLITE_SUMMARY_WATER_CUT_SQL = buildSqliteWaterCutSql("SUM(COALESCE(liquid, 0))", "SUM(COALESCE(oil, 0))", "SUM(COALESCE(diluent, 0))");

// Helper for Oracle DB queries
async function queryDB(sql: string, params: any = {}): Promise<any> {
  let connection;
  try {
    const pool = await getOraclePool();
    connection = await pool.getConnection();
    await connection.execute("ALTER SESSION SET QUERY_REWRITE_ENABLED=FALSE", [], { autoCommit: true }).catch(() => {});
    const result = await connection.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 1000 });
    return { success: true, rows: result.rows };
  } catch (err: any) {
    console.warn("Database query failed:", err.message);
    return { success: false, error: err.message };
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
}

// --- SQLite Initialization ---
let localDb: any = null;
let isSyncing = false;
const activeRefreshJobs = new Map<string, Promise<void>>();
let lastDailyRepairDate = "";
let homepageCacheWarmTask: Promise<any> | null = null;
let startupWarmTask: Promise<void> | null = null;
let startupFormulaRepairTask: Promise<void> | null = null;
let startupSyncTask: Promise<void> | null = null;
const blockChartMemoryCache = new Map<string, { expiresAt: number; data: any[] }>();
const wellChartMemoryCache = new Map<string, { expiresAt: number; data: any }>();

async function setSyncMeta(key: string, value: string | null | undefined) {
  await localDb.run("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)", [key, value ?? ""]);
}

async function getSyncMetaMap() {
  const rows = await localDb.all("SELECT key, value FROM sync_meta");
  return rows.reduce((acc: Record<string, string>, row: any) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

async function getLocalLatestDate() {
  const row = await localDb.get("SELECT MAX(rq) as lastDate FROM production");
  return row?.lastDate || null;
}

async function repairStoredWaterCut() {
  const result = await localDb.run(
    `
      UPDATE production
      SET water_cut = ${SQLITE_ROW_WATER_CUT_SQL}
    `
  );

  console.log(`[${new Date().toISOString()}] ______________________________ ${result?.changes ?? 0} _________`);
}

async function rebuildDerivedData() {
  await refreshDashboardSummary(DEFAULT_SYNC_START_DATE);
  clearChartMemoryCache();
  await Promise.all([
    warmBlocksCache(),
    warmStationsCache(),
    warmWellsCache(),
    warmHomepageCache()
  ]);
}

async function ensureWaterCutFormulaVersion() {
  const currentVersion = await localDb.get("SELECT value FROM sync_meta WHERE key = ?", ["water_cut_formula_version"]);
  if (currentVersion?.value === WATER_CUT_FORMULA_VERSION) {
    return;
  }

  await repairStoredWaterCut();
  await rebuildDerivedData();
  await setSyncMeta("water_cut_formula_version", WATER_CUT_FORMULA_VERSION);
}

async function repairStoredGas(fromDate: string = DEFAULT_SYNC_START_DATE) {
  const result = await queryDB(
    `
      SELECT a.jh as "jh", TO_CHAR(a.rq, 'YYYY-MM-DD') as "rq",
             ROUND((NVL(a.rcbsq, 0) + NVL(a.rcql, 0)), 0) as "gas"
      FROM dba01 a, daa01 c
      WHERE ${ORACLE_PRODUCTION_SCOPE_SQL}
        AND a.rq >= TO_DATE(:p_from_date, 'YYYY-MM-DD')
        AND a.jh IS NOT NULL
    `,
    { p_from_date: fromDate }
  );

  if (!result.success) {
    throw new Error(result.error || "Oracle ___________________________");
  }

  if (!result.rows || result.rows.length === 0) {
    console.log(`[${new Date().toISOString()}] ______________________________________________________`);
    return 0;
  }

  const stmt = await localDb.prepare(`
    UPDATE production
    SET gas = ?
    WHERE jh = ? AND rq = ?
  `);

  let transactionStarted = false;
  let repairedCount = 0;
  try {
    await localDb.run("BEGIN TRANSACTION");
    transactionStarted = true;
    for (const row of result.rows) {
      const updateResult = await stmt.run(row.gas, row.jh, row.rq);
      repairedCount += Number(updateResult?.changes || 0);
    }
    await localDb.run("COMMIT");
    transactionStarted = false;
  } catch (err) {
    if (transactionStarted) {
      await localDb.run("ROLLBACK");
    }
    throw err;
  } finally {
    await stmt.finalize();
  }

  console.log(`[${new Date().toISOString()}] ___________________________ ${repairedCount} _________`);
  return repairedCount;
}

async function ensureGasFormulaVersion() {
  const currentVersion = await localDb.get("SELECT value FROM sync_meta WHERE key = ?", ["gas_formula_version"]);
  if (currentVersion?.value === GAS_FORMULA_VERSION) {
    return;
  }

  await repairStoredGas(DEFAULT_SYNC_START_DATE);
  await rebuildDerivedData();
  await setSyncMeta("gas_formula_version", GAS_FORMULA_VERSION);
}

async function getSummaryRowCount() {
  const row = await localDb.get("SELECT COUNT(*) as count FROM dashboard_summary_daily");
  return Number(row?.count || 0);
}

function getEmptyAnalysisData() {
  return {
    water_cut_pie: [],
    top_water_cut_wells: [],
    decline_warnings: [],
    summary: {
      total_wells: 0,
      abnormal_wells: 0,
      potential_gain: "--"
    }
  };
}

function normalizeRawBlock(block: string) {
  const normalizedKey = normalizeBlockAliasKey(block);
  return RAW_BLOCK_TO_CANONICAL[normalizedKey] || block.trim();
}

function normalizeChartBlock(block: string) {
  const normalizedBlock = normalizeRawBlock(block);
  const normalizedKey = normalizeBlockAliasKey(normalizedBlock);
  return RAW_BLOCK_TO_CHART_BLOCK[normalizedKey] || normalizedBlock;
}

function buildChartBlocksList(blocks: string[]) {
  const seen = new Set<string>();
  const chartBlocks: string[] = [];

  for (const block of blocks) {
    const chartBlock = normalizeChartBlock(block);
    if (!seen.has(chartBlock)) {
      seen.add(chartBlock);
      chartBlocks.push(chartBlock);
    }
  }

  return chartBlocks;
}

function getChartBlockSourceBlocks(block: string) {
  const normalizedBlock = normalizeChartBlock(block);
  return (CHART_BLOCK_GROUPS[normalizedBlock] || [normalizeRawBlock(block)]).map((sourceBlock) => normalizeRawBlock(sourceBlock));
}

function getQueryBlocksForSourceBlock(block: string) {
  const canonicalBlock = normalizeRawBlock(block);
  return RAW_BLOCK_ALIASES[canonicalBlock] || [canonicalBlock];
}

function normalizeSelectedChartBlocks(blocks: string[]) {
  const seen = new Set<string>();
  const normalizedBlocks: string[] = [];

  for (const block of blocks) {
    const normalizedBlock = normalizeChartBlock(block);
    if (!normalizedBlock || seen.has(normalizedBlock)) {
      continue;
    }
    seen.add(normalizedBlock);
    normalizedBlocks.push(normalizedBlock);
  }

  return normalizedBlocks.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function expandChartBlocksToSourceBlocks(blocks: string[]) {
  const seen = new Set<string>();
  const sourceBlocks: string[] = [];

  for (const block of blocks) {
    for (const sourceBlock of getChartBlockSourceBlocks(block)) {
      if (!sourceBlock || seen.has(sourceBlock)) {
        continue;
      }
      seen.add(sourceBlock);
      sourceBlocks.push(sourceBlock);
    }
  }

  return sourceBlocks.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function buildBlockChartCacheKey(blocks: string[]) {
  return normalizeSelectedChartBlocks(blocks).join("||");
}

async function getBlocksList() {
  const rows = await localDb.all(`
    SELECT DISTINCT block as "block"
    FROM production
    WHERE block IS NOT NULL AND block != ''
    ORDER BY block
  `);
  return rows.map((row: any) => row.block);
}

async function getStationsList() {
  const rows = await localDb.all(`
    SELECT DISTINCT station as "station"
    FROM production
    WHERE station IS NOT NULL AND station != ''
    ORDER BY station
  `);
  return rows.map((row: any) => row.station);
}

async function getWellsList() {
  const rows = await localDb.all(`
    SELECT DISTINCT jh as "jh", block as "block", station as "station"
    FROM production
    WHERE jh IS NOT NULL AND jh != ''
    ORDER BY jh
  `);

  return rows.map((row: any) => ({
    ...row,
    block: normalizeChartBlock(row.block || "")
  }));
}

async function getIssueAnalysisData() {
  const latestDate = await getLocalLatestDate();

  if (!latestDate) {
    return getEmptyAnalysisData();
  }

  const waterCutRows = await localDb.all(
    `
      SELECT
        CASE
          WHEN water_cut >= 95 THEN '_____________________?>=95%)'
          WHEN water_cut >= 80 THEN '__________________(80-95%)'
          WHEN water_cut >= 50 THEN '__________________(50-80%)'
          ELSE '__________________(<50%)'
        END as "name",
        COUNT(*) as "value"
      FROM production
      WHERE rq = ? AND jh IS NOT NULL AND jh != ''
      GROUP BY
        CASE
          WHEN water_cut >= 95 THEN '_____________________?>=95%)'
          WHEN water_cut >= 80 THEN '__________________(80-95%)'
          WHEN water_cut >= 50 THEN '__________________(50-80%)'
          ELSE '__________________(<50%)'
        END
    `,
    [latestDate]
  );

  const topWaterCutRows = await localDb.all(
    `
      SELECT jh as "jh", ROUND(water_cut, 1) as "water_cut", ROUND(oil, 1) as "oil", ROUND(liquid, 1) as "liquid"
      FROM production
      WHERE rq = ? AND jh IS NOT NULL AND jh != ''
      ORDER BY water_cut DESC, oil ASC
      LIMIT 10
    `,
    [latestDate]
  );

  const totalWells = waterCutRows.reduce((sum: number, row: any) => sum + Number(row.value || 0), 0);
  const abnormalWells = waterCutRows
    .filter((row: any) => row.name !== "__________________(<50%)")
    .reduce((sum: number, row: any) => sum + Number(row.value || 0), 0);

  return {
    water_cut_pie: waterCutRows,
    top_water_cut_wells: topWaterCutRows,
    decline_warnings: [],
    summary: {
      total_wells: totalWells,
      abnormal_wells: abnormalWells,
      potential_gain: "--"
    }
  };
}

async function setHomepageCache(key: string, payload: unknown, sourceDate: string | null) {
  const updatedAt = new Date().toISOString();
  await localDb.run(
    "INSERT OR REPLACE INTO homepage_cache (cache_key, payload, updated_at, source_date) VALUES (?, ?, ?, ?)",
    [key, JSON.stringify(payload), updatedAt, sourceDate]
  );
  return { updatedAt, sourceDate };
}

async function getHomepageCache<T>(key: string): Promise<{ payload: T; updatedAt: string; sourceDate: string | null } | null> {
  const row = await localDb.get(
    "SELECT payload, updated_at as updatedAt, source_date as sourceDate FROM homepage_cache WHERE cache_key = ?",
    [key]
  );

  if (!row?.payload) {
    return null;
  }

  try {
    return {
      payload: JSON.parse(row.payload) as T,
      updatedAt: row.updatedAt,
      sourceDate: row.sourceDate || null
    };
  } catch {
    return null;
  }
}

async function buildDashboardBootstrapPayload() {
  const [overallRows, analysisData, blocks, stations, syncStatus] = await Promise.all([
    getOverallChartRows(),
    getIssueAnalysisData(),
    getBlocksCacheData(),
    getStationsCacheData(),
    getSyncStatus()
  ]);

  return {
    overallData: buildChartData(overallRows),
    analysisData,
    blocks: buildChartBlocksList(blocks),
    chartBlocks: buildChartBlocksList(blocks),
    stations,
    syncStatus
  };
}

function buildEmptyChartData() {
  return {
    dates: [],
    liquid: [],
    oil: [],
    diluent: [],
    water_cut: [],
    gas: []
  };
}

async function buildLightweightDashboardBootstrapPayload() {
  const [overallRows, analysisData, syncStatus, rawBlocks, rawStations] = await Promise.all([
    getOverallChartRows(),
    getIssueAnalysisData(),
    getSyncStatus(),
    getBlocksList(),
    getStationsList()
  ]);

  const chartBlocks = buildChartBlocksList(rawBlocks);
  return {
    overallData: overallRows.length > 0 ? buildChartData(overallRows) : buildEmptyChartData(),
    analysisData,
    blocks: chartBlocks,
    chartBlocks,
    stations: rawStations,
    syncStatus
  };
}

function ensureHomepageWarmInBackground(reason: string) {
  if (homepageCacheWarmTask) {
    return homepageCacheWarmTask;
  }

  const task = withTimingLog(`___________________________(${reason})`, () => warmHomepageCache())
    .catch((err: any) => {
      console.error(`____________________________________(${reason}):`, err.message);
    });

  return task;
}

async function warmHomepageCache() {
  if (homepageCacheWarmTask) {
    return homepageCacheWarmTask;
  }

  homepageCacheWarmTask = (async () => {
    const latestLocalDate = await getLocalLatestDate();
    const summaryCount = await getSummaryRowCount();

    if (latestLocalDate && summaryCount === 0) {
      await refreshDashboardSummary(DEFAULT_SYNC_START_DATE);
    }

    const payload = await buildDashboardBootstrapPayload();
    const meta = await setHomepageCache(DASHBOARD_BOOTSTRAP_CACHE_KEY, payload, latestLocalDate);
    console.log(`[${new Date().toISOString()}] ____________________________________: ${latestLocalDate || "___"}`);
    return {
      ...payload,
      cacheWarm: Boolean(latestLocalDate),
      cacheSource: "rebuilt",
      generatedAt: meta.updatedAt,
      sourceDate: meta.sourceDate
    };
  })();

  try {
    return await homepageCacheWarmTask;
  } finally {
    homepageCacheWarmTask = null;
  }
}

async function warmWellsCache() {
  const latestLocalDate = await getLocalLatestDate();
  const wells = await getWellsList();
  const meta = await setHomepageCache(WELLS_CACHE_KEY, wells, latestLocalDate);
  console.log(`[${new Date().toISOString()}] ______________________________________________________: ${wells.length}`);
  return {
    data: wells,
    generatedAt: meta.updatedAt,
    sourceDate: meta.sourceDate
  };
}

async function warmBlocksCache() {
  const latestLocalDate = await getLocalLatestDate();
  const blocks = await getBlocksList();
  const meta = await setHomepageCache(BLOCKS_CACHE_KEY, blocks, latestLocalDate);
  return {
    data: blocks,
    generatedAt: meta.updatedAt,
    sourceDate: meta.sourceDate
  };
}

async function warmStationsCache() {
  const latestLocalDate = await getLocalLatestDate();
  const stations = await getStationsList();
  const meta = await setHomepageCache(STATIONS_CACHE_KEY, stations, latestLocalDate);
  return {
    data: stations,
    generatedAt: meta.updatedAt,
    sourceDate: meta.sourceDate
  };
}

async function getWellsCacheData() {
  const cached = await getHomepageCache<any[]>(WELLS_CACHE_KEY);
  if (cached) {
    console.log(`[${new Date().toISOString()}] /api/wells _________SQLite_________`);
    return Array.isArray(cached.payload)
      ? cached.payload.map((row: any) => ({
          ...row,
          block: normalizeChartBlock(row?.block || "")
        }))
      : [];
  }

  console.log(`[${new Date().toISOString()}] /api/wells ___________________________`);
  const warmed = await warmWellsCache();
  return warmed.data;
}

async function getBlocksCacheData() {
  const cached = await getHomepageCache<string[]>(BLOCKS_CACHE_KEY);
  if (cached) {
    console.log(`[${new Date().toISOString()}] /api/blocks _________SQLite_________`);
    return buildChartBlocksList(Array.isArray(cached.payload) ? cached.payload : []);
  }

  console.log(`[${new Date().toISOString()}] /api/blocks ___________________________`);
  const warmed = await warmBlocksCache();
  return buildChartBlocksList(warmed.data);
}

async function getStationsCacheData() {
  const cached = await getHomepageCache<string[]>(STATIONS_CACHE_KEY);
  if (cached) {
    console.log(`[${new Date().toISOString()}] /api/stations _________SQLite_________`);
    return cached.payload;
  }

  console.log(`[${new Date().toISOString()}] /api/stations ___________________________`);
  const warmed = await warmStationsCache();
  return warmed.data;
}

async function getDashboardBootstrapData() {
  const cached = await getHomepageCache<any>(DASHBOARD_BOOTSTRAP_CACHE_KEY);
  if (cached) {
    console.log(`[${new Date().toISOString()}] /api/dashboard/bootstrap _________SQLite_________`);
    const liveSyncStatus = await getSyncStatus();
    const cachedBlocks = Array.isArray(cached.payload?.blocks) ? cached.payload.blocks : [];
    const normalizedChartBlocks = Array.isArray(cached.payload?.chartBlocks) ? cached.payload.chartBlocks : buildChartBlocksList(cachedBlocks);
    return {
      ...cached.payload,
      blocks: normalizedChartBlocks,
      chartBlocks: normalizedChartBlocks,
      syncStatus: liveSyncStatus,
      cacheWarm: Boolean(cached.sourceDate),
      cacheSource: "sqlite",
      generatedAt: cached.updatedAt,
      sourceDate: cached.sourceDate
    };
  }

  console.log(`[${new Date().toISOString()}] /api/dashboard/bootstrap _____________________________________________`);
  void ensureHomepageWarmInBackground("dashboard-bootstrap");
  const payload = await buildLightweightDashboardBootstrapPayload();
  return {
    ...payload,
    cacheWarm: false,
    cacheSource: null,
    generatedAt: null,
    sourceDate: payload.syncStatus?.lastLocalDataDate || null
  };
}

function ensureStartupWarmTasks() {
  if (!startupWarmTask) {
    startupWarmTask = (async () => {
      try {
        await Promise.all([
          warmBlocksCache(),
          warmStationsCache(),
          warmWellsCache()
        ]);
        await ensureHomepageWarmInBackground("startup");
      } finally {
        startupWarmTask = null;
      }
    })();
  }

  return startupWarmTask;
}

function ensureStartupFormulaRepairTask() {
  if (!startupFormulaRepairTask) {
    startupFormulaRepairTask = (async () => {
      try {
        await withTimingLog("措施记录不存在", async () => {
          await ensureWaterCutFormulaVersion();
          await ensureGasFormulaVersion();
        });
      } finally {
        startupFormulaRepairTask = null;
      }
    })();
  }

  return startupFormulaRepairTask;
}

function ensureStartupSyncTask() {
  if (LOCAL_ONLY_MODE) {
    return Promise.resolve();
  }

  if (!startupSyncTask) {
    startupSyncTask = (async () => {
      try {
        await withTimingLog("增量同步", () => performIncrementalSync());
      } finally {
        startupSyncTask = null;
      }
    })();
  } else {
    console.log("[STARTUP] Sync task already exists, returning existing");
  }

  return startupSyncTask;
}

async function initLocalDb() {
  localDb = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await localDb.exec(`
    CREATE TABLE IF NOT EXISTS production (
      jh TEXT,
      rq TEXT,
      liquid REAL,
      oil REAL,
      diluent REAL,
      water_cut REAL,
      gas REAL,
      station TEXT,
      block TEXT,
      remark TEXT,
      UNIQUE(jh, rq) ON CONFLICT REPLACE
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      name TEXT,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS dashboard_summary_daily (
      rq TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_value TEXT NOT NULL,
      liquid REAL NOT NULL DEFAULT 0,
      oil REAL NOT NULL DEFAULT 0,
      diluent REAL NOT NULL DEFAULT 0,
      water_cut REAL NOT NULL DEFAULT 0,
      gas REAL NOT NULL DEFAULT 0,
      well_count INTEGER NOT NULL DEFAULT 0,
      abnormal_well_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(rq, scope_type, scope_value) ON CONFLICT REPLACE
    );
    CREATE TABLE IF NOT EXISTS homepage_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_date TEXT
    );
    CREATE TABLE IF NOT EXISTS measure_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      measure_date TEXT NOT NULL,
      seq_no TEXT,
      jh TEXT,
      block TEXT,
      station TEXT,
      measure_type TEXT,
      measure_name TEXT,
      status TEXT,
      owner TEXT,
      result_text TEXT,
      oil_gain REAL NOT NULL DEFAULT 0,
      liquid_gain REAL NOT NULL DEFAULT 0,
      remark TEXT,
      current_status TEXT,
      current_round_transfer_time TEXT,
      current_round_measure_type TEXT,
      production_days REAL,
      current_liquid REAL,
      current_oil REAL,
      current_diluent REAL,
      current_water_cut REAL,
      cumulative_oil_gain REAL,
      evaluation TEXT,
      pre_measure_daily_oil REAL,
      previous_period_oil_gain REAL,
      batch_year TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      source_batch TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS well_map_markers (
      well_no TEXT PRIMARY KEY,
      block TEXT NOT NULL,
      x_percent REAL NOT NULL,
      y_percent REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS well_map_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      priority INTEGER NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS well_map_category_wells (
      category_id INTEGER NOT NULL,
      well_no TEXT NOT NULL,
      PRIMARY KEY (category_id, well_no),
      FOREIGN KEY (category_id) REFERENCES well_map_categories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_production_rq ON production(rq);
    CREATE INDEX IF NOT EXISTS idx_production_jh ON production(jh);
    CREATE INDEX IF NOT EXISTS idx_production_station ON production(station);
    CREATE INDEX IF NOT EXISTS idx_production_rq_block ON production(rq, block);
    CREATE INDEX IF NOT EXISTS idx_production_rq_station ON production(rq, station);
    CREATE INDEX IF NOT EXISTS idx_production_block_rq ON production(block, rq);
    CREATE INDEX IF NOT EXISTS idx_production_station_rq ON production(station, rq);
    CREATE INDEX IF NOT EXISTS idx_dashboard_summary_scope ON dashboard_summary_daily(scope_type, scope_value, rq);
    CREATE INDEX IF NOT EXISTS idx_measure_tracking_date ON measure_tracking(measure_date);
    CREATE INDEX IF NOT EXISTS idx_measure_tracking_jh ON measure_tracking(jh);
    CREATE INDEX IF NOT EXISTS idx_measure_tracking_status ON measure_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_measure_tracking_block_station ON measure_tracking(block, station);
    CREATE INDEX IF NOT EXISTS idx_well_map_markers_block ON well_map_markers(block);
    CREATE INDEX IF NOT EXISTS idx_well_map_category_wells_well ON well_map_category_wells(well_no);
  `);

  await initWellTemperatureTables(localDb);
  await initMeasureWellSelectionTables(localDb);
  await initInjectionProjectTables(localDb);
  await initMonthlyInjectionPlanImportTables(localDb);
  await initExternalTransferTables(localDb);

  // Bootstrap default admin if no users exist
  const userCount = await localDb.get("SELECT COUNT(*) as count FROM users");
  if (userCount.count === 0) {
    await localDb.run(
      "INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)",
      ["admin", "123456", "登录失败，请重试", "admin"]
    );
    console.log("Default admin user created: admin/123456");
  }

  const latestLocalDate = await getLocalLatestDate();
  await setSyncMeta("last_local_data_date", latestLocalDate);
  await setSyncMeta("last_sync_status", latestLocalDate ? "idle" : "pending");

  const measureColumns = await localDb.all("PRAGMA table_info(measure_tracking)");
  const existingMeasureColumns = new Set((measureColumns || []).map((row: any) => row.name));
  const measureColumnDefinitions = [
    ["seq_no", "TEXT"],
    ["current_status", "TEXT"],
    ["current_round_transfer_time", "TEXT"],
    ["current_round_measure_type", "TEXT"],
    ["production_days", "REAL"],
    ["current_liquid", "REAL"],
    ["current_oil", "REAL"],
    ["current_diluent", "REAL"],
    ["current_water_cut", "REAL"],
    ["cumulative_oil_gain", "REAL"],
    ["evaluation", "TEXT"],
    ["pre_measure_daily_oil", "REAL"],
    ["previous_period_oil_gain", "REAL"],
    ["batch_year", "TEXT NOT NULL DEFAULT ''"],
    ["detail_json", "TEXT NOT NULL DEFAULT '{}'"],
  ] as const;

  for (const [name, definition] of measureColumnDefinitions) {
    if (!existingMeasureColumns.has(name)) {
      await localDb.exec(`ALTER TABLE measure_tracking ADD COLUMN ${name} ${definition}`);
    }
  }

  // Backfill batch_year for existing rows from current_round_transfer_time
  await localDb.run(
    `UPDATE measure_tracking SET batch_year = SUBSTR(current_round_transfer_time, 1, 4) WHERE batch_year = '' AND current_round_transfer_time IS NOT NULL AND current_round_transfer_time != ''`
  );

  console.log("Local SQLite DB initialized with cache, summary, and users tables.");
}

async function refreshDashboardSummary(fromDate: string | null = DEFAULT_SYNC_START_DATE) {
  const rebuildFromDate = fromDate || DEFAULT_SYNC_START_DATE;

  await localDb.run("BEGIN TRANSACTION");
  try {
    await localDb.run("DELETE FROM dashboard_summary_daily WHERE rq >= ?", [rebuildFromDate]);

    await localDb.run(
      `
        INSERT INTO dashboard_summary_daily (
          rq, scope_type, scope_value,
          liquid, oil, diluent, water_cut, gas,
          well_count, abnormal_well_count
        )
        SELECT
          rq,
          'overall' as scope_type,
          ? as scope_value,
          ROUND(SUM(liquid), 1) as liquid,
          ROUND(SUM(oil), 1) as oil,
          ROUND(SUM(diluent), 1) as diluent,
          ${SQLITE_SUMMARY_WATER_CUT_SQL} as water_cut,
          ROUND(SUM(gas), 0) as gas,
          COUNT(DISTINCT jh) as well_count,
          SUM(CASE WHEN water_cut >= 50 THEN 1 ELSE 0 END) as abnormal_well_count
        FROM production
        WHERE rq >= ?
        GROUP BY rq
      `,
      [OVERALL_SCOPE_VALUE, rebuildFromDate]
    );

    await localDb.run(
      `
        INSERT INTO dashboard_summary_daily (
          rq, scope_type, scope_value,
          liquid, oil, diluent, water_cut, gas,
          well_count, abnormal_well_count
        )
        SELECT
          rq,
          'block' as scope_type,
          block as scope_value,
          ROUND(SUM(liquid), 1) as liquid,
          ROUND(SUM(oil), 1) as oil,
          ROUND(SUM(diluent), 1) as diluent,
          ${SQLITE_SUMMARY_WATER_CUT_SQL} as water_cut,
          ROUND(SUM(gas), 0) as gas,
          COUNT(DISTINCT jh) as well_count,
          SUM(CASE WHEN water_cut >= 50 THEN 1 ELSE 0 END) as abnormal_well_count
        FROM production
        WHERE rq >= ? AND block IS NOT NULL AND block != ''
        GROUP BY rq, block
      `,
      [rebuildFromDate]
    );

    await localDb.run("COMMIT");
  } catch (err) {
    await localDb.run("ROLLBACK");
    throw err;
  }
}

async function getSyncStatus() {
  const meta = await getSyncMetaMap();
  const lastLocalDataDate = meta.last_local_data_date || (await getLocalLatestDate()) || null;
  return {
    syncing: isSyncing,
    lastSuccessfulSyncAt: meta.last_successful_sync_at || null,
    lastLocalDataDate,
    lastSyncStatus: isSyncing ? "syncing" : meta.last_sync_status || (lastLocalDataDate ? "idle" : "pending"),
    lastError: meta.last_error || null,
    hasData: Boolean(lastLocalDataDate)
  };
}

async function getOverallChartRows() {
  const summaryRows = await localDb.all(
    `
      SELECT rq as "date", liquid, oil, diluent, water_cut, gas
      FROM dashboard_summary_daily
      WHERE scope_type = 'overall' AND scope_value = ?
      ORDER BY rq
    `,
    [OVERALL_SCOPE_VALUE]
  );

  if (summaryRows.length > 0) {
    return summaryRows;
  }

  return localDb.all(`
    SELECT
      rq as "date",
      ROUND(SUM(liquid), 1) as "liquid",
      ROUND(SUM(oil), 1) as "oil",
      ROUND(SUM(diluent), 1) as "diluent",
      ${SQLITE_SUMMARY_WATER_CUT_SQL} as "water_cut",
      ROUND(SUM(gas), 0) as "gas"
    FROM production
    GROUP BY rq
    ORDER BY rq
  `);
}

async function getBlockChartRows(blocks: string[]) {
  const normalizedBlocks = normalizeSelectedChartBlocks(blocks);
  const cacheKey = buildBlockChartCacheKey(normalizedBlocks);
  const cacheLabel = normalizedBlocks.join(",") || "(empty)";
  const cached = getMemoryCacheEntry(blockChartMemoryCache, cacheKey);
  if (cached) {
    console.log(`[${new Date().toISOString()}] /api/chart/block?blocks=${cacheLabel} ___________________________`);
    return { rows: cached, source: "memory" };
  }

  const sourceBlocks = expandChartBlocksToSourceBlocks(normalizedBlocks);
  if (sourceBlocks.length === 0) {
    return { rows: [], source: "summary" };
  }

  const placeholders = sourceBlocks.map(() => "?").join(", ");

  const summaryQueryBlocks = Array.from(new Set(sourceBlocks.flatMap((block) => getQueryBlocksForSourceBlock(block))));
  const summaryPlaceholders = summaryQueryBlocks.map(() => "?").join(", ");

  const summaryRows = summaryQueryBlocks.length === 1
    ? await localDb.all(
        `
          SELECT rq as "date", liquid, oil, diluent, water_cut, gas
          FROM dashboard_summary_daily
          WHERE scope_type = 'block' AND scope_value = ?
          ORDER BY rq
        `,
        [summaryQueryBlocks[0]]
      )
    : await localDb.all(
        `
          SELECT
            rq as "date",
            ROUND(SUM(liquid), 1) as "liquid",
            ROUND(SUM(oil), 1) as "oil",
            ROUND(SUM(diluent), 1) as "diluent",
            ${SQLITE_SUMMARY_WATER_CUT_SQL} as "water_cut",
            ROUND(SUM(gas), 0) as "gas"
          FROM dashboard_summary_daily
          WHERE scope_type = 'block' AND scope_value IN (${summaryPlaceholders})
          GROUP BY rq
          ORDER BY rq
        `,
        summaryQueryBlocks
      );

  if (summaryRows.length > 0) {
    console.log(`[${new Date().toISOString()}] /api/chart/block?blocks=${cacheLabel} ________________________`);
    setMemoryCacheEntry(blockChartMemoryCache, cacheKey, summaryRows);
    return { rows: summaryRows, source: "summary" };
  }

  const productionQueryBlocks = Array.from(new Set(sourceBlocks.flatMap((block) => getQueryBlocksForSourceBlock(block))));
  const productionPlaceholders = productionQueryBlocks.map(() => "?").join(", ");

  const rows = productionQueryBlocks.length === 1
    ? await localDb.all(
        `
          SELECT
            rq as "date",
            ROUND(SUM(liquid), 1) as "liquid",
            ROUND(SUM(oil), 1) as "oil",
            ROUND(SUM(diluent), 1) as "diluent",
            ${SQLITE_SUMMARY_WATER_CUT_SQL} as "water_cut",
            ROUND(SUM(gas), 0) as "gas"
          FROM production
          WHERE block = ?
          GROUP BY rq
          ORDER BY rq
        `,
        [productionQueryBlocks[0]]
      )
    : await localDb.all(
        `
          SELECT
            rq as "date",
            ROUND(SUM(liquid), 1) as "liquid",
            ROUND(SUM(oil), 1) as "oil",
            ROUND(SUM(diluent), 1) as "diluent",
            ${SQLITE_SUMMARY_WATER_CUT_SQL} as "water_cut",
            ROUND(SUM(gas), 0) as "gas"
          FROM production
          WHERE block IN (${productionPlaceholders})
          GROUP BY rq
          ORDER BY rq
        `,
        productionQueryBlocks
      );
  console.log(`[${new Date().toISOString()}] /api/chart/block?blocks=${cacheLabel} _____________________`);
  setMemoryCacheEntry(blockChartMemoryCache, cacheKey, rows);
  return { rows, source: "local_production" };
}

async function getWellChartData(jh: string, startDate: string, endDate: string) {
  const cacheKey = `${jh.trim()}::${startDate}::${endDate}`;
  const cached = getMemoryCacheEntry(wellChartMemoryCache, cacheKey);
  if (cached) {
    console.log(`[${new Date().toISOString()}] /api/chart/well?jh=${jh} ___________________________`);
    return { data: cached, source: "memory" };
  }

  const rows = await localDb.all(
    `
      SELECT rq as "date", liquid, oil, diluent, water_cut, gas
      FROM production
      WHERE jh = ? AND rq BETWEEN ? AND ?
      ORDER BY rq
    `,
    [jh, startDate, endDate]
  );

  if (rows && rows.length > 0) {
    console.log(`[${new Date().toISOString()}] /api/chart/well?jh=${jh} ______________________________`);
    const data = buildChartData(rows);
    setMemoryCacheEntry(wellChartMemoryCache, cacheKey, data);
    return { data, source: "local_production" };
  }

  const result = await queryDB(
    `
      SELECT TO_CHAR(a.rq, 'YYYY-MM-DD') as "date",
             ${ORACLE_PRODUCTION_METRICS_SQL}
      FROM dba01 a, daa01 c
      WHERE ${ORACLE_PRODUCTION_SCOPE_SQL}
        AND a.jh = :p_jh
        AND a.rq BETWEEN TO_DATE(:p_start_date, 'YYYY-MM-DD') AND TO_DATE(:p_end_date, 'YYYY-MM-DD')
      ORDER BY a.rq
    `,
    { p_jh: jh, p_start_date: startDate, p_end_date: endDate }
  );

  if (result.success && result.rows && (result.rows as any[]).length > 0) {
    console.log(`[${new Date().toISOString()}] /api/chart/well?jh=${jh} _________Oracle`);
    const data = buildChartData(result.rows as any[]);
    setMemoryCacheEntry(wellChartMemoryCache, cacheKey, data);
    return { data, source: "oracle" };
  }

  if (result.success) {
    console.log(`[${new Date().toISOString()}] /api/chart/well?jh=${jh} ________________________`);
    const emptyData = { dates: [], liquid: [], oil: [], diluent: [], water_cut: [], gas: [] };
    setMemoryCacheEntry(wellChartMemoryCache, cacheKey, emptyData);
    return { data: emptyData, source: "oracle" };
  }

  throw new Error("数据获取失败");
}

// --- Incremental Sync Logic ---
async function performIncrementalSync(forceSummaryRebuild: boolean = false) {
  const JOB_KEY = "incremental_sync";
  const existingJob = activeRefreshJobs.get(JOB_KEY);
  if (existingJob) {
    return { success: false, error: "同步任务正在执行中", startTime: new Date(), endTime: new Date(), duration: 0, count: 0 };
  }

  const startTime = new Date();
  if (isSyncing) {
    return { success: false, error: "同步任务正在执行中", startTime, endTime: startTime, duration: 0, count: 0 };
  }

  isSyncing = true;
  activeRefreshJobs.set(JOB_KEY, Promise.resolve());
  console.log(`[${startTime.toISOString()}] >>> ___________________________?..`);

  try {
    await setSyncMeta("last_sync_status", "syncing");
    await setSyncMeta("last_error", "");

    if (!hasOracleConfig()) {
      throw new Error("DB_NOT_CONFIGURED");
    }

    const latestLocalDateBeforeSync = (await getLocalLatestDate()) || DEFAULT_SYNC_START_DATE;
    console.log(`[${new Date().toISOString()}] ___________________________? ${latestLocalDateBeforeSync}__________________ Oracle _____________________?..`);

    const result = await queryDB(
      `
        SELECT a.jh as "jh", TO_CHAR(a.rq, 'YYYY-MM-DD') as "rq",
               ${ORACLE_PRODUCTION_METRICS_SQL},
               c.jlzh as "station",
               c.qkdy as "block",
               a.bz as "remark"
        FROM dba01 a, daa01 c
        WHERE ${ORACLE_PRODUCTION_SCOPE_SQL}
          AND a.rq >= TO_DATE(:p_last_date, 'YYYY-MM-DD')
          AND a.jh IS NOT NULL
      `,
      { p_last_date: latestLocalDateBeforeSync }
    );

    if (!result.success) {
      throw new Error(result.error || "Oracle ___________________________");
    }

    let syncedCount = 0;
    if (result.rows && result.rows.length > 0) {
      syncedCount = result.rows.length;
      const stmt = await localDb.prepare(`
        INSERT INTO production (jh, rq, liquid, oil, diluent, water_cut, gas, station, block, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let transactionStarted = false;

      try {
        await localDb.run("BEGIN TRANSACTION");
        transactionStarted = true;
        for (const row of result.rows) {
          await stmt.run(
            row.jh,
            row.rq,
            row.liquid,
            row.oil,
            row.diluent,
            row.water_cut,
            row.gas,
            row.station,
            row.block,
            row.remark
          );
        }
        await localDb.run("COMMIT");
        transactionStarted = false;
      } catch (err) {
        if (transactionStarted) {
          await localDb.run("ROLLBACK");
        }
        throw err;
      } finally {
        await stmt.finalize();
      }
    }

    const summaryCount = await getSummaryRowCount();
    if (syncedCount > 0 || forceSummaryRebuild || (summaryCount === 0 && (await getLocalLatestDate()))) {
      await refreshDashboardSummary(forceSummaryRebuild ? DEFAULT_SYNC_START_DATE : latestLocalDateBeforeSync);
    }

    if (syncedCount > 0 || forceSummaryRebuild) {
      clearChartMemoryCache();
      console.log(`[${new Date().toISOString()}] __________________________________________`);
    }

    await Promise.all([
      warmBlocksCache(),
      warmStationsCache(),
      warmWellsCache(),
      warmHomepageCache()
    ]);

    const latestLocalDataDate = await getLocalLatestDate();
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;

    await setSyncMeta("last_successful_sync_at", endTime.toISOString());
    await setSyncMeta("last_local_data_date", latestLocalDataDate);
    await setSyncMeta("last_sync_status", "success");
    await setSyncMeta("last_error", "");

    console.log(`[${endTime.toISOString()}] <<< _________________________________`);
    console.log(`[__________________] _________? _________ | _____________________? ${syncedCount} | _________: ${duration}s`);

    return { success: true, count: syncedCount, startTime, endTime, duration, lastLocalDataDate: latestLocalDataDate };
  } catch (err: any) {
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;

    await setSyncMeta("last_sync_status", "error");
    await setSyncMeta("last_error", err.message || "__________________");
    await setSyncMeta("last_local_data_date", await getLocalLatestDate());

    console.error(`[${endTime.toISOString()}] !!! ___________________________ !!!`);
    console.error(`[__________________] ${err.message}`);
    console.error(`[__________________] _________? _________ | _________: ${duration}s`);

    return { success: false, error: err.message, startTime, endTime, duration, count: 0 };
  } finally {
    activeRefreshJobs.delete("incremental_sync");
    isSyncing = false;
  }
}

function scheduleSyncJobs() {
  if (LOCAL_ONLY_MODE) {
    console.log("Local-only mode enabled; Oracle sync jobs are disabled.");
    return;
  }

  setInterval(() => {
    void performIncrementalSync();
  }, INCREMENTAL_SYNC_INTERVAL_MS);

  setInterval(() => {
    const now = new Date();
    const today = formatDate(now);
    if (now.getHours() === 2 && lastDailyRepairDate !== today) {
      lastDailyRepairDate = today;
      void performIncrementalSync(true);
    }
  }, DAILY_REBUILD_CHECK_INTERVAL_MS);
}

type CompareRangeInput = {
  start: string;
  end: string;
};

type CompareMetricKey = "liquid" | "oil" | "diluent" | "water_cut" | "gas";

type CompareMetrics = Record<CompareMetricKey, number>;

type CompareHistoryEntry = {
  date: string;
  remark: string;
};

type CompareHistoryData = {
  entries: CompareHistoryEntry[];
  dates: string[];
};

type CompareTypeStat = {
  label: string;
  wellCount: number;
  liquidDiff: number;
  oilDiff: number;
};

type CompareResultRow = {
  jh: string;
  station: string;
  block: string;
  avgA: CompareMetrics;
  avgB: CompareMetrics;
  diff: CompareMetrics;
  note: string;
  openWellType: string | null;
  closedWellType: string | null;
  incrementType: string | null;
  decrementType: string | null;
};

type MeasureDetailPayload = {
  currentRound: Record<string, string | number>;
  previousRound: Record<string, string | number>;
  rawExtras: Record<string, string | number>;
  rawStatus?: string;
  rawEvaluation?: string;
};

type MeasureRecord = {
  measure_date: string;
  seq_no: string;
  jh: string;
  block: string;
  station: string;
  measure_type: string;
  measure_name: string;
  status: string;
  owner: string;
  result_text: string;
  oil_gain: number;
  liquid_gain: number;
  remark: string;
  current_status: string;
  current_round_transfer_time: string;
  current_round_measure_type: string;
  production_days: number | null;
  current_liquid: number | null;
  current_oil: number | null;
  current_diluent: number | null;
  current_water_cut: number | null;
  cumulative_oil: number | null;
  cumulative_oil_gain: number | null;
  evaluation: string;
  evaluation_by_cumulative_oil?: string;
  evaluation_by_cumulative_oil_gain?: string;
  pre_measure_daily_oil: number | null;
  previous_period_cumulative_oil?: number | null;
  previous_period_oil_gain?: number | null;
  detail_json: string;
  source_batch: string;
  created_at: string;
  updated_at: string;
};

const COMPARE_METRIC_KEYS: CompareMetricKey[] = ["liquid", "oil", "diluent", "water_cut", "gas"];
const OPEN_WELL_TYPE_LABELS = ["_________", "_________", "_________", "_________", "_________", "____________"] as const;
const CLOSED_WELL_TYPE_LABELS = ["_________", "_________", "_________", "____________", "____________"] as const;
const INCREMENT_TYPE_LABELS = ["_________", "_________", "_________", "____________"] as const;
const DECREMENT_TYPE_LABELS = ["______", "______", "_________", "数据获取失败", "数据获取失败", "____________", "____________"] as const;

function parseIsoDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatCompareShortDate(dateString: string) {
  const date = parseIsoDate(dateString);
  return `${date.getUTCMonth() + 1}.${date.getUTCDate()}`;
}

function getInclusiveDayCount(startDate: string, endDate: string) {
  return Math.floor((parseIsoDate(endDate).getTime() - parseIsoDate(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function shiftDateDays(dateString: string, offsetDays: number) {
  const date = parseIsoDate(dateString);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatUtcDate(date);
}

function roundCompareValue(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function buildEmptyCompareMetrics(): CompareMetrics {
  return {
    liquid: 0,
    oil: 0,
    diluent: 0,
    water_cut: 0,
    gas: 0
  };
}

function buildCompareStationFilter(stationList: string[], columnName: string = "station") {
  if (stationList.length === 0) {
    return { clause: "", params: [] as string[] };
  }

  return {
    clause: ` AND ${columnName} IN (${stationList.map(() => "?").join(",")})`,
    params: stationList
  };
}

function buildComparePhaseParams(range: CompareRangeInput) {
  return [...COMPARE_METRIC_KEYS.flatMap(() => [range.start, range.end]), range.start, range.end];
}

async function loadCompareBaseRows(rangeA: CompareRangeInput, rangeB: CompareRangeInput, stationList: string[]) {
  const stationFilter = buildCompareStationFilter(stationList);
  const sql = `
    SELECT
      jh,
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(liquid, 0) ELSE 0 END) as "sumA_liquid",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(oil, 0) ELSE 0 END) as "sumA_oil",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(diluent, 0) ELSE 0 END) as "sumA_diluent",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(water_cut, 0) ELSE 0 END) as "sumA_water_cut",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(gas, 0) ELSE 0 END) as "sumA_gas",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN 1 ELSE 0 END) as "countA",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(liquid, 0) ELSE 0 END) as "sumB_liquid",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(oil, 0) ELSE 0 END) as "sumB_oil",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(diluent, 0) ELSE 0 END) as "sumB_diluent",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(water_cut, 0) ELSE 0 END) as "sumB_water_cut",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN COALESCE(gas, 0) ELSE 0 END) as "sumB_gas",
      SUM(CASE WHEN rq BETWEEN ? AND ? THEN 1 ELSE 0 END) as "countB"
    FROM production
    WHERE jh IS NOT NULL AND jh != ''
      AND ((rq BETWEEN ? AND ?) OR (rq BETWEEN ? AND ?))
      ${stationFilter.clause}
    GROUP BY jh
    ORDER BY jh
  `;

  return localDb.all(sql, [
    ...buildComparePhaseParams(rangeA),
    ...buildComparePhaseParams(rangeB),
    rangeA.start,
    rangeA.end,
    rangeB.start,
    rangeB.end,
    ...stationFilter.params
  ]);
}

async function loadCompareWellMeta(rangeA: CompareRangeInput, rangeB: CompareRangeInput, stationList: string[]) {
  const stationFilter = buildCompareStationFilter(stationList);
  const rows = await localDb.all(
    `
      SELECT jh as "jh", station as "station", block as "block"
      FROM production
      WHERE jh IS NOT NULL AND jh != ''
        AND ((rq BETWEEN ? AND ?) OR (rq BETWEEN ? AND ?))
        ${stationFilter.clause}
      ORDER BY jh ASC, rq ASC, rowid ASC
    `,
    [rangeA.start, rangeA.end, rangeB.start, rangeB.end, ...stationFilter.params]
  );

  const metaMap = new Map<string, { station: string; block: string }>();
  for (const row of rows) {
    metaMap.set(row.jh, {
      station: row.station || "",
      block: normalizeChartBlock(row.block || "")
    });
  }

  return metaMap;
}

async function loadCompareRemarkHistory(rangeA: CompareRangeInput, rangeB: CompareRangeInput, stationList: string[]) {
  const stationFilter = buildCompareStationFilter(stationList);
  const lookbackStart = shiftDateDays(rangeB.start, -300);
  const rows = await localDb.all(
    `
      WITH compare_wells AS (
        SELECT DISTINCT jh
        FROM production
        WHERE jh IS NOT NULL AND jh != ''
          AND ((rq BETWEEN ? AND ?) OR (rq BETWEEN ? AND ?))
          ${stationFilter.clause}
      )
      SELECT
        p.jh as "jh",
        p.rq as "rq",
        GROUP_CONCAT(CASE WHEN p.remark IS NOT NULL AND TRIM(p.remark) != '' THEN TRIM(p.remark) END, '___') as "remark"
      FROM production p
      INNER JOIN compare_wells w ON w.jh = p.jh
      WHERE p.rq BETWEEN ? AND ?
      GROUP BY p.jh, p.rq
      ORDER BY p.jh ASC, p.rq ASC
    `,
    [rangeA.start, rangeA.end, rangeB.start, rangeB.end, ...stationFilter.params, lookbackStart, rangeB.end]
  );

  const historyMap = new Map<string, CompareHistoryData>();
  for (const row of rows) {
    const history = historyMap.get(row.jh) || { entries: [], dates: [] };
    history.dates.push(row.rq);
    if (row.remark) {
      history.entries.push({
        date: row.rq,
        remark: row.remark
      });
    }
    historyMap.set(row.jh, history);
  }

  return historyMap;
}

function findFirstRemarkMatch(entries: CompareHistoryEntry[], startDate: string, endDate: string, keywords: string[]) {
  for (const entry of entries) {
    if (entry.date < startDate) {
      continue;
    }
    if (entry.date > endDate) {
      break;
    }
    if (keywords.some((keyword) => entry.remark.includes(keyword))) {
      return entry.date;
    }
  }

  return null;
}

function hasAnyRemarkKeyword(history: CompareHistoryData | undefined, keywords: string[]) {
  if (!history) {
    return false;
  }

  return history.entries.some((entry) => keywords.some((keyword) => entry.remark.includes(keyword)));
}

function hasHistoryInWindow(history: CompareHistoryData | undefined, startDate: string, endDate: string) {
  if (!history) {
    return false;
  }

  return history.dates.some((date) => date >= startDate && date <= endDate);
}

function appendNoteReason(baseNote: string, reason: string) {
  if (!reason) {
    return baseNote;
  }
  return baseNote ? `${baseNote}___?{reason}` : reason;
}

function buildIncreaseReason(history: CompareHistoryData | undefined, rangeB: CompareRangeInput, waterDiff: number) {
  const transferOpenDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -60), rangeB.end, ["_______________", "_________"]);
  if (transferOpenDate) {
    return `${formatCompareShortDate(transferOpenDate)}________________________`;
  }

  const channelOpenDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -60), rangeB.end, ["_______________"]);
  if (channelOpenDate) {
    return `${formatCompareShortDate(channelOpenDate)}________________________`;
  }

  const pumpOpenDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -30), rangeB.end, ["_________", "______"]);
  if (pumpOpenDate) {
    return `${formatCompareShortDate(pumpOpenDate)}________________________`;
  }

  if (waterDiff < 0 && hasHistoryInWindow(history, shiftDateDays(rangeB.start, -200), rangeB.end)) {
    return "数据获取失败";
  }

  return "";
}

function buildDecreaseReason(history: CompareHistoryData | undefined, rangeB: CompareRangeInput, waterDiff: number) {
  const transferInjectDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -30), rangeB.end, ["_________"]);
  if (transferInjectDate) {
    return `${formatCompareShortDate(transferInjectDate)}___________________________`;
  }

  const channelDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -30), rangeB.end, ["_________"]);
  if (channelDate) {
    return `${formatCompareShortDate(channelDate)}___________________________`;
  }

  const waitPumpDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -30), rangeB.end, ["_________"]);
  if (waitPumpDate) {
    return `${formatCompareShortDate(waitPumpDate)}_____________________`;
  }

  const transferOpenDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -200), rangeB.end, ["_______________", "_________"]);
  if (transferOpenDate) {
    return `${formatCompareShortDate(transferOpenDate)}________________________________________________`;
  }

  const pumpOpenDate = findFirstRemarkMatch(history?.entries || [], shiftDateDays(rangeB.start, -100), rangeB.end, ["_________", "______"]);
  if (pumpOpenDate) {
    return "______________________________";
  }

  if (waterDiff > 0 && hasHistoryInWindow(history, shiftDateDays(rangeB.start, -100), rangeB.end)) {
    return "数据获取失败";
  }

  if (hasHistoryInWindow(history, shiftDateDays(rangeB.start, -200), rangeB.end)) {
    return "数据获取失败";
  }

  return "";
}

function classifyOpenWell(history: CompareHistoryData | undefined, note: string) {
  if (note.includes("_________") || hasAnyRemarkKeyword(history, ["_________", "___?"])) {
    return "_______________";
  }
  if (note.includes("_______________") || hasAnyRemarkKeyword(history, ["_______________"])) {
    return "_______________";
  }
  if (note.includes("_______________") || note.includes("_________") || hasAnyRemarkKeyword(history, ["_______________", "_________"])) {
    return "_______________";
  }
  if (note.includes("_________?") || hasAnyRemarkKeyword(history, ["_______________", "_________?"])) {
    return "_______________";
  }
  if (note.includes("_________") || hasAnyRemarkKeyword(history, ["_________"])) {
    return "_______________";
  }
  return "____________?";
}

function classifyClosedWell(history: CompareHistoryData | undefined, note: string) {
  if (note.includes("_________") || hasAnyRemarkKeyword(history, ["_________", "___?"])) {
    return "____________?";
  }
  if (note.includes("_________") || hasAnyRemarkKeyword(history, ["_________"])) {
    return "____________?";
  }
  if (note.includes("_________") || hasAnyRemarkKeyword(history, ["_________"])) {
    return "____________?";
  }
  if (note.includes("____________?") || hasAnyRemarkKeyword(history, ["____________?"])) {
    return "__________________";
  }
  return "__________________";
}

function classifyIncrement(reason: string) {
  if (reason.includes("请选择区块")) {
    return "_______________";
  }
  if (reason.includes("请选择区块")) {
    return "_______________";
  }
  if (reason.includes("请选择区块")) {
    return "_______________";
  }
  if (reason.includes("数据获取失败")) {
    return "__________________";
  }
  return null;
}

function classifyDecrement(reason: string) {
  if (reason.includes("数据获取失败")) {
    return "_________";
  }
  if (reason.includes("数据获取失败")) {
    return "_________";
  }
  if (reason.includes("_____________________________?")) {
    return "____________?";
  }
  if (reason.includes("________________________________________________")) {
    return "__________________________________________?";
  }
  if (reason.includes("______________________________")) {
    return "__________________________________________?";
  }
  if (reason.includes("数据获取失败")) {
    return "__________________";
  }
  if (reason.includes("数据获取失败")) {
    return "__________________";
  }
  return null;
}

function createCompareTypeStats(labels: readonly string[]) {
  return new Map(labels.map((label) => [label, { label, wellCount: 0, liquidDiff: 0, oilDiff: 0 }]));
}

function formatMeasureDateParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeExcelSerialDate(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }

  const wholeDays = Math.floor(value);
  const fractionalDay = value - wholeDays;
  const adjustedDays = wholeDays >= 60 ? wholeDays - 1 : wholeDays;
  const excelEpochUtc = Date.UTC(1899, 11, 31);
  const date = new Date(excelEpochUtc + adjustedDays * 24 * 60 * 60 * 1000 + Math.round(fractionalDay * 24 * 60 * 60 * 1000));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatMeasureDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function normalizeMeasureDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsedDate = normalizeExcelSerialDate(value);
    if (parsedDate) {
      return parsedDate;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatMeasureDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const text = String(value || "").trim().replace(/["']/g, "");
  if (!text) {
    return "";
  }

  const normalized = text.replace(/[-./]/g, "-").replace(/[_]/g, "-").replace(/[_]/g, "").replace("T", " ").trim();
  const datePart = normalized.split(/\s+/)[0];
  const match = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    return "";
  }

  const [, year, month, day] = match;
  return formatMeasureDateParts(Number(year), Number(month), Number(day));
}

function normalizeMeasureText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeMeasureNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeNullableMeasureNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMeasureStatus(value: unknown) {
  const text = normalizeMeasureText(value);
  if (!text) return "_________";
  if (text.includes("___?")) return "_________";
  if (text.includes("_________")) return "_________";
  if (text.includes("_________") || text.includes("_________") || text === "___?") return "_________";
  if (text.includes("_________") || text.includes("_________") || text.includes("___?")) return "_________";
  return text;
}

function normalizeMeasureEvaluation(value: unknown) {
  const text = normalizeMeasureText(value).toUpperCase();
  if (!text) return "";
  const match = text.match(/[ABCD]/);
  return match ? match[0] : text;
}

function normalizeMeasureDetailKey(value: unknown) {
  return normalizeMeasureText(value)
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, "")
    .replace(/[()（）?""'：:]/g, "")
    .replace(/[-_]/g, "");
}

function getMeasureDetailValue(section: Record<string, string | number> | undefined, aliases: string[]) {
  if (!section) {
    return undefined;
  }

  for (const alias of aliases) {
    if (alias in section) {
      const value = section[alias];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return value;
      }
    }
  }

  const normalizedAliases = new Set(aliases.map((alias) => normalizeMeasureDetailKey(alias)));
  for (const [key, value] of Object.entries(section)) {
    if (!normalizedAliases.has(normalizeMeasureDetailKey(key))) {
      continue;
    }
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function getMeasureDetailDate(section: Record<string, string | number> | undefined, aliases: string[]) {
  return normalizeMeasureDate(getMeasureDetailValue(section, aliases));
}

function getMeasureDetailNumber(section: Record<string, string | number> | undefined, aliases: string[]) {
  return normalizeNullableMeasureNumber(getMeasureDetailValue(section, aliases));
}

const CURRENT_BASELINE_OIL_ALIASES = ["措前产油", "措前日产油", "基准日产油", "基准产油", "措前日油"];
const PREVIOUS_BASELINE_OIL_ALIASES = ["上轮措前产油", "上轮措前日产油", "上轮基准产油", "上轮基准日产油", "措前产油_1", "措前日产油_1"];
const PREVIOUS_TRANSFER_TIME_ALIASES = ["上轮转抽时间", "上轮转抽日期", "上次转抽时间", "上次转抽日期", "上一轮转抽时间", "上轮措施时间", "转注时间_1", "转抽时间_1"];
const MEASURE_IMPORT_FIELD_ALIASES = {
  seq_no: ["序号", "编号"],
  jh: ["井号", "井名", "油井", "井号/井名", "井号（井名）"],
  block: ["区块", "所属区块", "区块/所属区块", "断块"],
  station: ["站号", "站名", "station", "集油站", "计量站"],
  current_status: ["目前状态", "当前状态", "状态", "措施状态", "井状态"],
  current_round_transfer_time: ["转注时间", "转抽时间", "本轮转注时间", "转注日期", "本轮转注日期", "本次转注", "转周时间", "注汽日期", "注汽时间"],
  current_round_measure_type: ["措施类型", "本轮措施类型", "工艺类型", "措施工艺", "工艺措施"],
  measure_name: ["措施名称", "措施名", "工艺名称", "具体措施"],
  owner: ["负责人", "施工单位", "施工方", "作业队", "措施单位"],
  pre_measure_daily_oil: ["措前日产油", "措前日油", "措前日产油量", "措施前日产油", "措前产油", "措施前产油"],
  production_days: ["生产天数", "生产 天数", "产油天数", "周期生产天数", "周期生产 天数", "本轮生产天数"],
  current_liquid: ["日产液", "日液", "日产液量", "目前产液", "产液量", "日液量"],
  current_oil: ["日产油", "日油", "日产油量", "目前产油", "产油量", "日油量"],
  current_diluent: ["掺稀油量", "掺稀量", "掺稀", "掺稀油"],
  current_water_cut: ["含水率", "含水", "含水量", "含水比"],
  cumulative_oil_gain: ["累增油", "累计增油", "阶段增油", "增油量"],
  evaluation: ["评价", "效果", "措施效果", "效果评价"],
} as const;

type MeasureImportRow = {
  seq_no: string;
  jh: string;
  block: string;
  station: string;
  current_status: string;
  current_round_transfer_time: string;
  current_round_measure_type: string;
  measure_name: string;
  owner: string;
  pre_measure_daily_oil: number | null;
  production_days: number | null;
  current_liquid: number | null;
  current_oil: number | null;
  current_diluent: number | null;
  current_water_cut: number | null;
  cumulative_oil_gain: number | null;
  evaluation: string;
  detail_json: MeasureDetailPayload;
};

type MeasureImportParseResult = {
  rows: MeasureImportRow[];
  skippedCount: number;
  unknownHeaders: string[];
};

function buildEmptyMeasureDetail(): MeasureDetailPayload {
  return {
    currentRound: {},
    previousRound: {},
    rawExtras: {}
  };
}

function buildDefaultMeasureImportRow(): MeasureImportRow {
  return {
    seq_no: "",
    jh: "",
    block: "",
    station: "",
    current_status: "",
    current_round_transfer_time: "",
    current_round_measure_type: "",
    measure_name: "",
    owner: "",
    pre_measure_daily_oil: null,
    production_days: null,
    current_liquid: null,
    current_oil: null,
    current_diluent: null,
    current_water_cut: null,
    cumulative_oil_gain: null,
    evaluation: "",
    detail_json: buildEmptyMeasureDetail()
  };
}

function normalizeMeasureImportHeader(value: string) {
  return value.trim().toLowerCase().replace(/\uFEFF/g, "").replace(/\s+/g, "").replace(/[\uFF08\uFF09\uFF1F\uFF1A\u201C\u201D\u2018\u2019()?:"'_\-,\.\/]/g, "");
}

function normalizeMeasureImportNumber(value: unknown) {
  const text = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function setMeasureImportDetailValue(section: Record<string, string | number>, key: string, value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return;
  }
  if (!(key in section)) {
    const numeric = normalizeMeasureImportNumber(text);
    section[key] = /^-?\d+(\.\d+)?$/.test(text.replace(/,/g, "")) ? numeric : text;
  }
}

function appendMeasureImportExtra(detail: MeasureDetailPayload, key: string, value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return;
  }
  if (!(key in detail.rawExtras)) {
    detail.rawExtras[key] = text;
  }
}

function getMeasureImportFieldByAlias(normalizedHeader: string) {
  for (const [field, aliases] of Object.entries(MEASURE_IMPORT_FIELD_ALIASES) as Array<[
    keyof typeof MEASURE_IMPORT_FIELD_ALIASES,
    readonly string[]
  ]>) {
    if (aliases.some((alias) => normalizeMeasureImportHeader(alias) === normalizedHeader)) {
      return field;
    }
  }
  return null;
}

function getMeasureImportDetailSection(normalizedHeader: string): keyof MeasureDetailPayload | null {
  if (normalizedHeader.endsWith("1") || normalizedHeader.startsWith("上轮")) return "previousRound";
  return "currentRound";
}

function decodeMeasureCsvBuffer(buffer: Buffer) {
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  if (!utf8Text.includes("___?")) {
    return utf8Text;
  }

  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return utf8Text;
  }
}

function readMeasureImportWorkbook(fileName: string, buffer: Buffer) {
  if (fileName.toLowerCase().endsWith(".csv")) {
    const csvText = decodeMeasureCsvBuffer(buffer);
    return XLSX.read(csvText, { type: "string" });
  }

  return XLSX.read(buffer, { type: "buffer" });
}

function mapMeasureImportRow(row: Record<string, unknown>) {
  const next = buildDefaultMeasureImportRow();
  const unknownHeaders: string[] = [];

  Object.entries(row).forEach(([header, rawValue]) => {
    const normalizedHeader = normalizeMeasureImportHeader(header);
    const text = String(rawValue ?? "").trim();
    if (!normalizedHeader) {
      return;
    }

    const aliasField = getMeasureImportFieldByAlias(normalizedHeader);
    if (aliasField) {
      if (aliasField === "seq_no") {
        next.seq_no = text;
        return;
      }
      if (aliasField === "jh") {
        if (!next.jh) next.jh = text;
        return;
      }
      if (aliasField === "block") {
        next.block = text;
        return;
      }
      if (aliasField === "station") {
        next.station = text;
        return;
      }
      if (aliasField === "current_round_measure_type") {
        if (!next.current_round_measure_type) next.current_round_measure_type = text;
        return;
      }
      if (aliasField === "measure_name") {
        if (!next.measure_name) next.measure_name = text;
        return;
      }
      if (aliasField === "owner") {
        next.owner = text;
        return;
      }
      if (aliasField === "current_status") {
        next.current_status = normalizeMeasureStatus(text);
        if (text && next.current_status !== text) {
          next.detail_json.rawStatus = text;
        }
        return;
      }
      if (aliasField === "current_round_transfer_time") {
        if (!next.current_round_transfer_time) next.current_round_transfer_time = normalizeMeasureDate(rawValue) || text;
        return;
      }
      if (aliasField === "pre_measure_daily_oil") {
        next.pre_measure_daily_oil = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "production_days") {
        next.production_days = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "current_liquid") {
        next.current_liquid = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "current_oil") {
        next.current_oil = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "current_diluent") {
        next.current_diluent = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "current_water_cut") {
        next.current_water_cut = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "cumulative_oil_gain") {
        next.cumulative_oil_gain = text ? normalizeMeasureImportNumber(rawValue) : null;
        return;
      }
      if (aliasField === "evaluation") {
        next.evaluation = normalizeMeasureEvaluation(text);
        if (text && next.evaluation !== text) {
          next.detail_json.rawEvaluation = text;
        }
        return;
      }
    }

    const detailSection = getMeasureImportDetailSection(normalizedHeader);
    if (detailSection) {
      const detailTarget = next.detail_json[detailSection as "currentRound" | "previousRound"];
      setMeasureImportDetailValue(detailTarget, header, text);
      if (!next.current_round_measure_type && detailSection === "currentRound" && normalizedHeader.includes("__________________")) {
        next.current_round_measure_type = text;
      }
      if (!next.measure_name && detailSection === "currentRound" && (normalizedHeader.includes("_________________") || normalizedHeader.includes("__________________"))) {
        next.measure_name = text;
      }
      if (next.pre_measure_daily_oil == null && detailSection === "currentRound" && (normalizedHeader.includes("_________________") || normalizedHeader.includes("登录失败，请重试") || normalizedHeader.includes("__________________________"))) {
        next.pre_measure_daily_oil = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (next.production_days == null && detailSection === "currentRound" && normalizedHeader.includes("__________________")) {
        next.production_days = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (!next.current_round_transfer_time && detailSection === "currentRound" && normalizedHeader.includes("_________") && (normalizedHeader.includes("_________") || normalizedHeader.includes("_________"))) {
        next.current_round_transfer_time = normalizeMeasureDate(rawValue) || text;
      }
      if (next.current_liquid == null && detailSection === "currentRound" && (normalizedHeader.includes("____________?") || normalizedHeader.includes("____________?") || normalizedHeader.includes("____________?"))) {
        next.current_liquid = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (next.current_oil == null && detailSection === "currentRound" && (normalizedHeader.includes("____________?") || normalizedHeader.includes("____________?") || normalizedHeader.includes("____________?"))) {
        next.current_oil = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (next.current_diluent == null && detailSection === "currentRound" && (normalizedHeader.includes("__________________") || normalizedHeader.includes("__________________") || normalizedHeader.includes("_________"))) {
        next.current_diluent = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (next.current_water_cut == null && detailSection === "currentRound" && (normalizedHeader.includes("__________________") || normalizedHeader.includes("__________________") || normalizedHeader.includes("____________?"))) {
        next.current_water_cut = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (next.cumulative_oil_gain == null && (normalizedHeader.includes("____________?") || normalizedHeader.includes("__________________") || normalizedHeader.includes("_________________"))) {
        next.cumulative_oil_gain = text ? normalizeMeasureImportNumber(rawValue) : null;
      }
      if (!next.evaluation && (normalizedHeader.includes("__________________") || normalizedHeader === "_________" || normalizedHeader.includes("__________________"))) {
        next.evaluation = normalizeMeasureEvaluation(text);
        if (text && next.evaluation !== text) {
          next.detail_json.rawEvaluation = text;
        }
      }
      return;
    }

    if (text) {
      appendMeasureImportExtra(next.detail_json, header, text);
      unknownHeaders.push(header);
    }
  });

  if (!next.seq_no) {
    const rawSeqNo = String(row["_________"] ?? row["___?"] ?? "").trim();
    if (rawSeqNo) {
      next.seq_no = rawSeqNo;
    }
  }

  if (!next.current_status) {
    next.current_status = "_________";
  }

  if (!next.jh || !next.current_round_transfer_time) {
    return { row: null, unknownHeaders };
  }

  return { row: next, unknownHeaders };
}

function parseMeasureImportRows(rawRows: Record<string, unknown>[]): MeasureImportParseResult {
  const rows: MeasureImportRow[] = [];
  const unknownHeaders = new Set<string>();
  let skippedCount = 0;

  rawRows.forEach((rawRow, index) => {
    const { row, unknownHeaders: rowUnknownHeaders } = mapMeasureImportRow(rawRow);
    rowUnknownHeaders.forEach((header) => unknownHeaders.add(header));
    if (row) {
      if (!row.seq_no) {
        row.seq_no = String(index + 1);
      }
      rows.push(row);
    } else {
      skippedCount += 1;
    }
  });

  return {
    rows,
    skippedCount,
    unknownHeaders: Array.from(unknownHeaders)
  };
}

class MeasureImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasureImportParseError";
  }
}

function parseMeasureImportFile(fileName: string, buffer: Buffer) {
  try {
    if (isHtmlMeasureImportFile(buffer)) {
      throw new MeasureImportParseError("Excel 文件格式错误或内容无法解析");
    }
    const workbook = readMeasureImportWorkbook(fileName, buffer);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
    if (!worksheet) {
      throw new MeasureImportParseError("Excel 文件中未找到有效工作表");
    }

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const parsed = parseMeasureImportRows(rawRows);
    if (parsed.rows.length === 0) {
      throw new MeasureImportParseError("未从Excel文件中解析到有效的措施记录");
    }

    return {
      ...parsed,
      sheetName: firstSheetName,
      totalRows: rawRows.length,
      validRows: parsed.rows.length
    };
  } catch (error) {
    if (error instanceof MeasureImportParseError) {
      throw error;
    }
    throw new MeasureImportParseError("Excel 文件格式错误或内容无法解析");
  }
}

function handleMeasureImportUpload(upload: ReturnType<typeof multer>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.single("file")(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ success: false, message: `_______________________________________________?${Math.floor(MEASURE_IMPORT_FILE_LIMIT_BYTES / (1024 * 1024))}MB _________` });
        return;
      }
      res.status(400).json({ success: false, message: "导入文件读取失败: " + err.message });
    });
  };
}

function parseMeasureDetailPayload(value: unknown): MeasureDetailPayload {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return {
        currentRound: parsed?.currentRound && typeof parsed.currentRound === "object" ? parsed.currentRound : {},
        previousRound: parsed?.previousRound && typeof parsed.previousRound === "object" ? parsed.previousRound : {},
        rawExtras: parsed?.rawExtras && typeof parsed.rawExtras === "object" ? parsed.rawExtras : {},
        rawStatus: normalizeMeasureText(parsed?.rawStatus) || undefined,
        rawEvaluation: normalizeMeasureText(parsed?.rawEvaluation) || undefined,
      };
    } catch {
      return { currentRound: {}, previousRound: {}, rawExtras: {} };
    }
  }

  if (value && typeof value === "object") {
    const payload = value as MeasureDetailPayload;
    return {
      currentRound: payload.currentRound && typeof payload.currentRound === "object" ? payload.currentRound : {},
      previousRound: payload.previousRound && typeof payload.previousRound === "object" ? payload.previousRound : {},
      rawExtras: payload.rawExtras && typeof payload.rawExtras === "object" ? payload.rawExtras : {},
      rawStatus: normalizeMeasureText(payload.rawStatus) || undefined,
      rawEvaluation: normalizeMeasureText(payload.rawEvaluation) || undefined,
    };
  }

  return { currentRound: {}, previousRound: {}, rawExtras: {} };
}

function normalizeMeasureDetailPayload(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify({
        currentRound: parsed?.currentRound && typeof parsed.currentRound === "object" ? parsed.currentRound : {},
        previousRound: parsed?.previousRound && typeof parsed.previousRound === "object" ? parsed.previousRound : {},
        rawExtras: parsed?.rawExtras && typeof parsed.rawExtras === "object" ? parsed.rawExtras : {},
        rawStatus: normalizeMeasureText(parsed?.rawStatus) || undefined,
        rawEvaluation: normalizeMeasureText(parsed?.rawEvaluation) || undefined,
      });
    } catch {
      return JSON.stringify({ currentRound: {}, previousRound: {}, rawExtras: {} });
    }
  }

  if (value && typeof value === "object") {
    const payload = value as MeasureDetailPayload;
    return JSON.stringify({
      currentRound: payload.currentRound && typeof payload.currentRound === "object" ? payload.currentRound : {},
      previousRound: payload.previousRound && typeof payload.previousRound === "object" ? payload.previousRound : {},
      rawExtras: payload.rawExtras && typeof payload.rawExtras === "object" ? payload.rawExtras : {},
      rawStatus: normalizeMeasureText(payload.rawStatus) || undefined,
      rawEvaluation: normalizeMeasureText(payload.rawEvaluation) || undefined,
    });
  }

  return JSON.stringify({ currentRound: {}, previousRound: {}, rawExtras: {} });
}

function roundMeasureValue(value: number, digits: number = 2) {
  return Number(value.toFixed(digits));
}

async function getLatestProductionRow(jh: string) {
  return localDb.get(
    `
      SELECT rq, liquid, oil, diluent, water_cut
      FROM production
      WHERE jh = ?
      ORDER BY rq DESC
      LIMIT 1
    `,
    [jh]
  );
}

async function getProductionRowsSince(jh: string, startDate: string, dayLimit?: number) {
  const rows = await localDb.all(
    `
      SELECT rq, oil
      FROM production
      WHERE jh = ? AND rq >= ?
      ORDER BY rq ASC
    `,
    [jh, startDate]
  );

  return typeof dayLimit === "number" ? rows.slice(0, dayLimit) : rows;
}

async function getProductionRowsBetween(jh: string, startDate: string, endDate: string) {
  return localDb.all(
    `
      SELECT rq, oil
      FROM production
      WHERE jh = ? AND rq >= ? AND rq <= ?
      ORDER BY rq ASC
    `,
    [jh, startDate, endDate]
  );
}

function buildDailyOilSeries(rows: any[], startDate: string, dayCount: number) {
  const oilByDate = new Map<string, number>();
  for (const row of rows) {
    const date = normalizeMeasureDate(row?.rq);
    if (!date) {
      continue;
    }
    oilByDate.set(date, Number(row?.oil || 0));
  }

  return Array.from({ length: dayCount }, (_, index) => {
    const date = shiftDateDays(startDate, index);
    return {
      rq: date,
      oil: oilByDate.get(date) ?? 0
    };
  });
}

function calculateCumulativeOil(rows: any[]) {
  return roundMeasureValue(
    rows.reduce((sum, row) => sum + Number(row?.oil || 0), 0)
  );
}

function calculateCumulativeOilGain(rows: any[], baselineOil: number) {
  return roundMeasureValue(
    rows.reduce((sum, row) => {
      const dailyOil = Number(row?.oil || 0);
      const dailyGain = Math.max(0, dailyOil - baselineOil);
      return sum + dailyGain;
    }, 0)
  );
}

function calculateEvaluation(currentGain: number, previousGain: number | null) {
  if (previousGain === null || previousGain <= 0) {
    return currentGain > 0 ? "A" : "D";
  }

  const ratio = currentGain / previousGain;
  if (ratio >= 1) return "A";
  if (ratio >= 0.8) return "B";
  if (ratio >= 0.6) return "C";
  return "D";
}

async function enrichMeasureRecord(record: MeasureRecord) {
  if (!record.jh || !record.current_round_transfer_time) {
    return record;
  }

  if (record.current_status !== "生产") {
    return {
      ...record,
      production_days: null,
      cumulative_oil: null,
      cumulative_oil_gain: null,
      evaluation: "",
      evaluation_by_cumulative_oil: "",
      evaluation_by_cumulative_oil_gain: "",
      previous_period_cumulative_oil: null,
      previous_period_oil_gain: null
    };
  }

  const detail = parseMeasureDetailPayload(record.detail_json);

  // Parse raw JSON for top-level field search (GSyuan stores Excel data flat, not nested)
  let rawDetail: Record<string, unknown> = {};
  try {
    if (typeof record.detail_json === "string" && record.detail_json.trim()) {
      rawDetail = JSON.parse(record.detail_json);
    }
  } catch { /* ignore parse errors */ }

  const hasCurrentBaselineInDetail = getMeasureDetailValue(detail.currentRound, CURRENT_BASELINE_OIL_ALIASES) !== undefined || getMeasureDetailValue(rawDetail as Record<string, string | number>, CURRENT_BASELINE_OIL_ALIASES) !== undefined;
  const hasPreviousBaselineInDetail = getMeasureDetailValue(detail.previousRound, PREVIOUS_BASELINE_OIL_ALIASES) !== undefined || getMeasureDetailValue(rawDetail as Record<string, string | number>, PREVIOUS_BASELINE_OIL_ALIASES) !== undefined;
  const baselineOil = normalizeNullableMeasureNumber(record.pre_measure_daily_oil ?? getMeasureDetailValue(detail.currentRound, CURRENT_BASELINE_OIL_ALIASES) ?? getMeasureDetailValue(rawDetail as Record<string, string | number>, CURRENT_BASELINE_OIL_ALIASES));
  const latestProduction = await getLatestProductionRow(record.jh);
  const latestProductionDate = latestProduction?.rq ? normalizeMeasureDate(latestProduction.rq) : "";
  const latestSystemProductionDate = normalizeMeasureDate((await getLocalLatestDate()) || "");
  const evaluationEndDate = latestSystemProductionDate || latestProductionDate;
  const hasNaturalDayWindow = Boolean(evaluationEndDate) && evaluationEndDate >= record.current_round_transfer_time;
  const productionDays = hasNaturalDayWindow ? getInclusiveDayCount(record.current_round_transfer_time, evaluationEndDate) : null;
  const currentWindowEndDate = productionDays ? shiftDateDays(record.current_round_transfer_time, productionDays - 1) : "";
  const currentRows = productionDays ? await getProductionRowsBetween(record.jh, record.current_round_transfer_time, currentWindowEndDate) : [];
  const currentSeries = productionDays ? buildDailyOilSeries(currentRows, record.current_round_transfer_time, productionDays) : [];

  let previousCumulativeOil: number | null = null;
  let previousGain: number | null = null;
  const previousTransferTime = getMeasureDetailDate(detail.previousRound || {}, PREVIOUS_TRANSFER_TIME_ALIASES) || getMeasureDetailDate(rawDetail as Record<string, string | number>, PREVIOUS_TRANSFER_TIME_ALIASES);
  const previousBaselineOil = getMeasureDetailNumber(detail.previousRound || {}, PREVIOUS_BASELINE_OIL_ALIASES) || getMeasureDetailNumber(rawDetail as Record<string, string | number>, PREVIOUS_BASELINE_OIL_ALIASES);
  if (previousTransferTime && productionDays && productionDays > 0) {
    const previousEndDate = shiftDateDays(previousTransferTime, productionDays - 1);
    const previousRows = await getProductionRowsBetween(record.jh, previousTransferTime, previousEndDate);
    const previousSeries = buildDailyOilSeries(previousRows, previousTransferTime, productionDays);
    previousCumulativeOil = calculateCumulativeOil(previousSeries);
    if (previousBaselineOil !== null) {
      previousGain = calculateCumulativeOilGain(previousSeries, previousBaselineOil);
    }
  }

  const currentCumulativeOil = productionDays ? calculateCumulativeOil(currentSeries) : null;
  const currentGain = baselineOil === null || !productionDays ? null : calculateCumulativeOilGain(currentSeries, baselineOil);
  const evaluationByCumulativeOil = currentCumulativeOil === null ? "" : calculateEvaluation(currentCumulativeOil, previousCumulativeOil);
  const evaluationByCumulativeOilGain = currentGain === null ? "" : calculateEvaluation(currentGain, previousGain);
  const hasPreviousTransferInDetail = getMeasureDetailDate(detail.previousRound || {}, PREVIOUS_TRANSFER_TIME_ALIASES) !== "" || getMeasureDetailDate(rawDetail as Record<string, string | number>, PREVIOUS_TRANSFER_TIME_ALIASES) !== "";
  return {
    ...record,
    production_days: productionDays,
    current_liquid: latestProduction ? roundMeasureValue(Number(latestProduction.liquid || 0), 1) : null,
    current_oil: latestProduction ? roundMeasureValue(Number(latestProduction.oil || 0), 1) : null,
    current_diluent: latestProduction ? roundMeasureValue(Number(latestProduction.diluent || 0), 1) : null,
    current_water_cut: latestProduction ? roundMeasureValue(Number(latestProduction.water_cut || 0), 1) : null,
    cumulative_oil: currentCumulativeOil,
    cumulative_oil_gain: currentGain,
    evaluation: evaluationByCumulativeOil,
    evaluation_by_cumulative_oil: evaluationByCumulativeOil,
    evaluation_by_cumulative_oil_gain: evaluationByCumulativeOilGain,
    pre_measure_daily_oil: baselineOil,
    previous_period_cumulative_oil: previousCumulativeOil,
    previous_period_oil_gain: previousGain,
    detail_json: JSON.stringify({
      ...rawDetail,
      previousRound: {
        ...detail.previousRound,
        ...(!hasPreviousBaselineInDetail && previousBaselineOil !== null ? { "上轮措前产油": previousBaselineOil } : {}),
        ...(!hasPreviousTransferInDetail && previousTransferTime ? { "上轮转抽时间": previousTransferTime } : {}),
        "上轮同期累产油(计算)": previousCumulativeOil ?? "",
        "上轮累增油(计算)": previousGain ?? "",
        "上轮生产天数(计算)": productionDays || "",
      },
      currentRound: {
        ...detail.currentRound,
        ...(!hasCurrentBaselineInDetail && baselineOil !== null ? { "措前产油": baselineOil } : {}),
        "本轮累产油(计算)": currentCumulativeOil ?? "",
        "本轮累增油(计算)": currentGain ?? "",
        "本轮生产天数(计算)": productionDays || "",
      },
      rawExtras: {
        ...(detail.rawExtras || {}),
        "评价(累产油)": evaluationByCumulativeOil || "",
        "评价(累增油)": evaluationByCumulativeOilGain || "",
        "计算截止日期": evaluationEndDate || "",
      },
    })
  };
}

function normalizeMeasurePayload(input: any, batchId: string): MeasureRecord | null {
  const measure_date = normalizeMeasureDate(input?.measure_date || input?.current_round_transfer_time);
  const current_round_transfer_time = normalizeMeasureDate(input?.current_round_transfer_time || input?.measure_date);
  const jh = normalizeMeasureText(input?.jh);
  const measure_name = normalizeMeasureText(input?.measure_name);

  if (!current_round_transfer_time || (!jh && !measure_name)) {
    return null;
  }

  const now = new Date().toISOString();
  const currentStatus = normalizeMeasureStatus(input?.current_status ?? input?.status);
  const detailPayload = parseMeasureDetailPayload(input?.detail_json);
  const preMeasureDailyOil = normalizeNullableMeasureNumber(
    input?.pre_measure_daily_oil ?? getMeasureDetailValue(detailPayload.currentRound, CURRENT_BASELINE_OIL_ALIASES)
  );
  const previousBaselineOil = getMeasureDetailNumber(detailPayload.previousRound, PREVIOUS_BASELINE_OIL_ALIASES);
  const evaluation = normalizeMeasureEvaluation(input?.evaluation);
  if (preMeasureDailyOil !== null && getMeasureDetailValue(detailPayload.currentRound, CURRENT_BASELINE_OIL_ALIASES) === undefined) {
    detailPayload.currentRound = {
      ...detailPayload.currentRound,
      "措前产油": preMeasureDailyOil
    };
  }
  if (previousBaselineOil !== null && getMeasureDetailValue(detailPayload.previousRound, PREVIOUS_BASELINE_OIL_ALIASES) === undefined) {
    detailPayload.previousRound = {
      ...detailPayload.previousRound,
      "上轮措前产油": previousBaselineOil
    };
  }
  return {
    measure_date: measure_date || current_round_transfer_time,
    seq_no: normalizeMeasureText(input?.seq_no),
    jh,
    block: normalizeMeasureText(input?.block),
    station: normalizeMeasureText(input?.station),
    measure_type: normalizeMeasureText(input?.measure_type || input?.current_round_measure_type),
    measure_name,
    status: currentStatus,
    owner: normalizeMeasureText(input?.owner),
    result_text: normalizeMeasureText(input?.result_text),
    oil_gain: normalizeMeasureNumber(input?.oil_gain ?? input?.cumulative_oil_gain),
    liquid_gain: normalizeMeasureNumber(input?.liquid_gain ?? input?.current_liquid),
    remark: normalizeMeasureText(input?.remark),
    current_status: currentStatus,
    current_round_transfer_time,
    current_round_measure_type: normalizeMeasureText(input?.current_round_measure_type || input?.measure_type),
    production_days: normalizeNullableMeasureNumber(input?.production_days),
    current_liquid: normalizeNullableMeasureNumber(input?.current_liquid),
    current_oil: normalizeNullableMeasureNumber(input?.current_oil),
    current_diluent: normalizeNullableMeasureNumber(input?.current_diluent),
    current_water_cut: normalizeNullableMeasureNumber(input?.current_water_cut),
    cumulative_oil: normalizeNullableMeasureNumber(input?.cumulative_oil),
    cumulative_oil_gain: normalizeNullableMeasureNumber(input?.cumulative_oil_gain),
    evaluation,
    evaluation_by_cumulative_oil: normalizeMeasureEvaluation(input?.evaluation_by_cumulative_oil),
    evaluation_by_cumulative_oil_gain: normalizeMeasureEvaluation(input?.evaluation_by_cumulative_oil_gain),
    pre_measure_daily_oil: preMeasureDailyOil,
    previous_period_cumulative_oil: normalizeNullableMeasureNumber(input?.previous_period_cumulative_oil),
    previous_period_oil_gain: normalizeNullableMeasureNumber(input?.previous_period_oil_gain),
    detail_json: normalizeMeasureDetailPayload(detailPayload),
    source_batch: batchId,
    created_at: normalizeMeasureText(input?.created_at) || now,
    updated_at: normalizeMeasureText(input?.updated_at) || now
  };
}

function buildMeasuresWhereClause(query: any) {
  const conditions: string[] = [];
  const params: any[] = [];

  const year = normalizeMeasureText(query.year);
  if (year) {
    conditions.push("batch_year = ?");
    params.push(year);
  }

  const start = normalizeMeasureDate(query.start);
  if (start) {
    conditions.push("current_round_transfer_time >= ?");
    params.push(start);
  }

  const end = normalizeMeasureDate(query.end);
  if (end) {
    conditions.push("current_round_transfer_time <= ?");
    params.push(end);
  }

  const status = normalizeMeasureText(query.status);
  if (status) {
    conditions.push("current_status = ?");
    params.push(status);
  }

  const block = normalizeMeasureText(query.block);
  if (block) {
    conditions.push("block = ?");
    params.push(block);
  }

  const station = normalizeMeasureText(query.station);
  if (station) {
    conditions.push("station = ?");
    params.push(station);
  }

  const keyword = normalizeMeasureText(query.keyword);
  if (keyword) {
    conditions.push("(jh LIKE ? OR current_round_measure_type LIKE ? OR detail_json LIKE ?)");
    const keywordLike = `%${keyword}%`;
    params.push(keywordLike, keywordLike, keywordLike);
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

async function getMeasuresData(query: any) {
  const { whereSql, params } = buildMeasuresWhereClause(query);
  const rows = await localDb.all(
    `
      SELECT
        id,
        seq_no,
        measure_date,
        jh,
        block,
        station,
        measure_type,
        measure_name,
        status,
        owner,
        result_text,
        oil_gain,
        liquid_gain,
        remark,
        current_status,
        current_round_transfer_time,
        current_round_measure_type,
        production_days,
        current_liquid,
        current_oil,
        current_diluent,
        current_water_cut,
        cumulative_oil_gain,
        evaluation,
        pre_measure_daily_oil,
        previous_period_oil_gain,
        batch_year,
        detail_json,
        source_batch,
        created_at,
        updated_at
      FROM measure_tracking
      ${whereSql}
      ORDER BY current_round_transfer_time DESC, id DESC
    `,
    params
  );

  const enrichedRows = await Promise.all(rows.map((row: MeasureRecord) => enrichMeasureRecord(row)));
  const metaRows = await localDb.all(`SELECT DISTINCT block, station, current_status FROM measure_tracking`);

  return {
    rows: enrichedRows,
    filters: {
      blocks: Array.from(new Set(metaRows.map((row: any) => row.block).filter(Boolean))),
      stations: Array.from(new Set(metaRows.map((row: any) => row.station).filter(Boolean))),
      statuses: Array.from(new Set(metaRows.map((row: any) => row.current_status).filter(Boolean))),
      years: Array.from(new Set(metaRows.map((row: any) => row.batch_year).filter(Boolean))).sort()
    }
  };
}

async function replaceMeasuresData(rows: any[], year?: string) {
  const batchId = new Date().toISOString();
  const normalizedRows = rows
    .map((row) => normalizeMeasurePayload(row, batchId))
    .filter(Boolean) as MeasureRecord[];

  if (normalizedRows.length === 0) {
    throw new Error("当前筛选条件下没有可导出的措施数据");
  }

  // Derive year from first row's transfer time if not specified
  const batchYear = year || (normalizedRows[0].current_round_transfer_time || "").slice(0, 4) || new Date().getFullYear().toString();

  let transactionStarted = false;
  const stmt = await localDb.prepare(`
    INSERT INTO measure_tracking (
      measure_date,
      seq_no,
      jh,
      block,
      station,
      measure_type,
      measure_name,
      status,
      owner,
      result_text,
      oil_gain,
      liquid_gain,
      remark,
      current_status,
      current_round_transfer_time,
      current_round_measure_type,
      production_days,
      current_liquid,
      current_oil,
      current_diluent,
      current_water_cut,
      cumulative_oil_gain,
      evaluation,
      pre_measure_daily_oil,
      previous_period_oil_gain,
      batch_year,
      detail_json,
      source_batch,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    await localDb.run("BEGIN TRANSACTION");
    transactionStarted = true;
    // Only delete rows for this year, keep other years
    await localDb.run("DELETE FROM measure_tracking WHERE batch_year = ?", [batchYear]);

    for (const row of normalizedRows) {
      await stmt.run(
        row.measure_date,
        row.seq_no,
        row.jh,
        row.block,
        row.station,
        row.measure_type,
        row.measure_name,
        row.status,
        row.owner,
        row.result_text,
        row.oil_gain,
        row.liquid_gain,
        row.remark,
        row.current_status,
        row.current_round_transfer_time,
        row.current_round_measure_type,
        row.production_days,
        row.current_liquid,
        row.current_oil,
        row.current_diluent,
        row.current_water_cut,
        row.cumulative_oil_gain,
        row.evaluation,
        row.pre_measure_daily_oil,
        row.previous_period_oil_gain ?? null,
        batchYear,
        row.detail_json,
        row.source_batch,
        row.created_at,
        row.updated_at
      );
    }

    await localDb.run("COMMIT");
    transactionStarted = false;
    return { count: normalizedRows.length, batchId };
  } catch (err) {
    if (transactionStarted) {
      await localDb.run("ROLLBACK");
    }
    throw err;
  } finally {
    await stmt.finalize();
  }
}

function updateTypeStats(statsMap: Map<string, CompareTypeStat>, label: string | null, row: CompareResultRow) {
  if (!label) {
    return;
  }

  const stats = statsMap.get(label);
  if (!stats) {
    return;
  }

  stats.wellCount += 1;
  stats.liquidDiff += row.diff.liquid;
  stats.oilDiff += row.diff.oil;
}

function finalizeTypeStats(statsMap: Map<string, CompareTypeStat>, labels: readonly string[]) {
  return labels.map((label) => {
    const stats = statsMap.get(label);
    return {
      label,
      wellCount: stats?.wellCount || 0,
      liquidDiff: roundCompareValue(stats?.liquidDiff || 0),
      oilDiff: roundCompareValue(stats?.oilDiff || 0)
    };
  });
}

function buildCompareSummary(rows: CompareResultRow[]) {
  const openStats = createCompareTypeStats(OPEN_WELL_TYPE_LABELS);
  const closedStats = createCompareTypeStats(CLOSED_WELL_TYPE_LABELS);
  const incrementStats = createCompareTypeStats(INCREMENT_TYPE_LABELS);
  const decrementStats = createCompareTypeStats(DECREMENT_TYPE_LABELS);

  let openWellCount = 0;
  let closedWellCount = 0;
  let incrementWellCount = 0;
  let decrementWellCount = 0;
  let totalLiquidDiff = 0;
  let totalOilDiff = 0;

  for (const row of rows) {
    totalLiquidDiff += row.diff.liquid;
    totalOilDiff += row.diff.oil;

    if (row.openWellType) {
      openWellCount += 1;
      updateTypeStats(openStats, row.openWellType, row);
    }
    if (row.closedWellType) {
      closedWellCount += 1;
      updateTypeStats(closedStats, row.closedWellType, row);
    }
    if (row.incrementType) {
      incrementWellCount += 1;
      updateTypeStats(incrementStats, row.incrementType, row);
    }
    if (row.decrementType) {
      decrementWellCount += 1;
      updateTypeStats(decrementStats, row.decrementType, row);
    }
  }

  return {
    totalWellDiff: openWellCount - closedWellCount,
    totalLiquidDiff: roundCompareValue(totalLiquidDiff),
    totalOilDiff: roundCompareValue(totalOilDiff),
    openWellCount,
    closedWellCount,
    incrementWellCount,
    decrementWellCount,
    openWellTypes: finalizeTypeStats(openStats, OPEN_WELL_TYPE_LABELS),
    closedWellTypes: finalizeTypeStats(closedStats, CLOSED_WELL_TYPE_LABELS),
    incrementTypes: finalizeTypeStats(incrementStats, INCREMENT_TYPE_LABELS),
    decrementTypes: finalizeTypeStats(decrementStats, DECREMENT_TYPE_LABELS)
  };
}

function buildLargeChangeData(rows: CompareResultRow[]) {
  const largeChangeRows = rows
    .filter((row) => (
      Math.abs(row.diff.liquid) >= 5 ||
      Math.abs(row.diff.oil) >= 1 ||
      Math.abs(row.diff.diluent) >= 1
    ))
    .map((row) => ({
      jh: row.jh,
      station: row.station,
      block: row.block,
      liquidDiff: row.diff.liquid,
      oilDiff: row.diff.oil,
      diluentDiff: row.diff.diluent,
      waterDiff: row.diff.water_cut,
      note: row.note
    }))
    .sort((a, b) => {
      const leftMax = Math.max(Math.abs(a.liquidDiff), Math.abs(a.oilDiff), Math.abs(a.diluentDiff));
      const rightMax = Math.max(Math.abs(b.liquidDiff), Math.abs(b.oilDiff), Math.abs(b.diluentDiff));
      return rightMax - leftMax;
    });

  let totalLiquidDiff = 0;
  let totalOilDiff = 0;
  let totalDiluentDiff = 0;

  for (const row of largeChangeRows) {
    totalLiquidDiff += row.liquidDiff;
    totalOilDiff += row.oilDiff;
    totalDiluentDiff += row.diluentDiff;
  }

  return {
    rows: largeChangeRows,
    count: largeChangeRows.length,
    totalLiquidDiff: roundCompareValue(totalLiquidDiff),
    totalOilDiff: roundCompareValue(totalOilDiff),
    totalDiluentDiff: roundCompareValue(totalDiluentDiff)
  };
}

async function rebuildMeasureWellSelection() {
  const trackingRows = await localDb.all('SELECT jh, block, station, detail_json FROM measure_tracking');
  const cycles = buildSelectionCyclesFromTrackingRows(trackingRows);
  await upsertSelectionCycles(localDb, cycles);
  const scores = evaluateWells(cycles.filter((cycle) => cycle.actualSteam != null && cycle.cycleOil != null));
  await replaceSelectionScores(localDb, scores);
  return { cycleCount: cycles.length, wellCount: scores.length };
}

async function ensureMeasureWellSelectionScores() {
  const existing = await localDb.get('SELECT COUNT(*) AS count FROM measure_well_scores');
  return Number(existing?.count || 0) > 0 ? undefined : rebuildMeasureWellSelection();
}
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const measureImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEASURE_IMPORT_FILE_LIMIT_BYTES }
  });
  const measureImportUploadMiddleware = handleMeasureImportUpload(measureImportUpload);
  const monthlyInjectionPlanUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEASURE_IMPORT_FILE_LIMIT_BYTES },
  });
  const monthlyInjectionPlanUploadMiddleware = handleMeasureImportUpload(monthlyInjectionPlanUpload);
  const wellMapDailyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEASURE_IMPORT_FILE_LIMIT_BYTES },
  });
  const wellMapDailyUploadMiddleware = handleMeasureImportUpload(wellMapDailyUpload);

  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ limit: REQUEST_BODY_LIMIT, extended: true }));
  app.use("/oil-well-map-assets", express.static(WELL_MAP_DATA_DIR));

  await initLocalDb();
  scheduleSyncJobs();

  app.get("/api/oil-well-map/production-wells", async (_req, res) => {
    try {
      const data = parseProducingWellsWorkbook(await fs.promises.readFile(WELL_MAP_DAILY_FILE));
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: `读取日数据失败：${error?.message || "未知错误"}` });
    }
  });

  app.post("/api/oil-well-map/daily-data", wellMapDailyUploadMiddleware, async (req, res) => {
    const file = (req as any).file;
    if (!file || !file.originalname.toLowerCase().endsWith(".xlsx")) {
      res.status(400).json({ success: false, message: "请上传日数据.xlsx 文件" });
      return;
    }

    try {
      const data = parseProducingWellsWorkbook(file.buffer);
      await fs.promises.writeFile(WELL_MAP_DAILY_FILE, file.buffer);
      res.json({ success: true, data, message: "日数据已更新" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error?.message || "日数据校验失败" });
    }
  });

  app.get("/api/oil-well-map/categories", async (_req, res) => {
    const categories = await localDb.all("SELECT id, name, color, priority, remark FROM well_map_categories ORDER BY priority, id");
    const relations = await localDb.all("SELECT category_id AS categoryId, well_no AS wellNo FROM well_map_category_wells");
    res.json({ success: true, data: { categories, relations } });
  });

  app.post("/api/oil-well-map/categories", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const color = String(req.body?.color || "").trim();
    const priority = Number(req.body?.priority);
    const remark = String(req.body?.remark || "").trim();
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(color) || !Number.isInteger(priority)) {
      res.status(400).json({ success: false, message: "分类名称、颜色和优先级不正确" });
      return;
    }
    const now = new Date().toISOString();
    const result = await localDb.run("INSERT INTO well_map_categories (name, color, priority, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [name, color, priority, remark, now, now]);
    res.json({ success: true, data: { id: result.lastID, name, color, priority, remark } });
  });

  app.put("/api/oil-well-map/categories/:id", async (req, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const color = String(req.body?.color || "").trim();
    const priority = Number(req.body?.priority);
    const remark = String(req.body?.remark || "").trim();
    if (!Number.isInteger(id) || !name || !/^#[0-9a-fA-F]{6}$/.test(color) || !Number.isInteger(priority)) {
      res.status(400).json({ success: false, message: "分类参数不正确" });
      return;
    }
    await localDb.run("UPDATE well_map_categories SET name = ?, color = ?, priority = ?, remark = ?, updated_at = ? WHERE id = ?", [name, color, priority, remark, new Date().toISOString(), id]);
    res.json({ success: true });
  });

  app.delete("/api/oil-well-map/categories/:id", async (req, res) => {
    const id = Number(req.params.id);
    await localDb.run("DELETE FROM well_map_category_wells WHERE category_id = ?", [id]);
    await localDb.run("DELETE FROM well_map_categories WHERE id = ?", [id]);
    res.status(204).end();
  });

  app.put("/api/oil-well-map/categories/:id/wells", async (req, res) => {
    const id = Number(req.params.id);
    const wells = [...new Set((Array.isArray(req.body?.wells) ? req.body.wells : []).map((well) => String(well).trim()).filter(Boolean))];
    await localDb.run("BEGIN");
    try {
      await localDb.run("DELETE FROM well_map_category_wells WHERE category_id = ?", [id]);
      for (const well of wells) await localDb.run("INSERT INTO well_map_category_wells (category_id, well_no) VALUES (?, ?)", [id, well]);
      await localDb.run("COMMIT");
      res.json({ success: true, data: wells });
    } catch (error: any) {
      await localDb.run("ROLLBACK");
      res.status(500).json({ success: false, message: error?.message || "分类井号保存失败" });
    }
  });

  app.get("/api/oil-well-map/markers", async (req, res) => {
    const block = String(req.query.block || "").trim();
    const data = await localDb.all(
      "SELECT well_no AS wellNo, block, x_percent AS xPercent, y_percent AS yPercent FROM well_map_markers WHERE block = ? ORDER BY well_no",
      [block],
    );
    res.json({ success: true, data });
  });

  app.put("/api/oil-well-map/markers/:wellNo", async (req, res) => {
    const wellNo = String(req.params.wellNo || "").trim();
    const marker = validateWellMapMarkerInput(req.body || {});
    if (!wellNo || !marker) {
      res.status(400).json({ success: false, message: "井号、区块和 0 到 100 的坐标不能为空" });
      return;
    }

    const now = new Date().toISOString();
    await localDb.run(
      "INSERT INTO well_map_markers (well_no, block, x_percent, y_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(well_no) DO UPDATE SET block = excluded.block, x_percent = excluded.x_percent, y_percent = excluded.y_percent, updated_at = excluded.updated_at",
      [wellNo, marker.block, marker.xPercent, marker.yPercent, now, now],
    );
    res.json({ success: true, data: { wellNo, ...marker } });
  });

  app.delete("/api/oil-well-map/markers/:wellNo", async (req, res) => {
    await localDb.run("DELETE FROM well_map_markers WHERE well_no = ?", [String(req.params.wellNo || "").trim()]);
    res.status(204).end();
  });

  const wellTemperatureImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEASURE_IMPORT_FILE_LIMIT_BYTES },
  });
  const wellTemperatureImportUploadMiddleware = handleMeasureImportUpload(wellTemperatureImportUpload);

  const measureWellSelectionImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEASURE_IMPORT_FILE_LIMIT_BYTES },
  });
  const measureWellSelectionImportUploadMiddleware = handleMeasureImportUpload(measureWellSelectionImportUpload);

  app.post("/api/measure-well-selection/import", measureWellSelectionImportUploadMiddleware, async (req, res) => {
    const file = (req as any).file;
    if (!file || !file.originalname.toLowerCase().endsWith(".xlsx")) {
      res.status(400).json({ success: false, message: "请上传 .xlsx 文件" });
      return;
    }
    try {
      const workbook = XLSX.read(file.buffer, { type: "buffer" });
      const data = await importMeasureWellWorkbook(localDb, file.originalname, workbook);
      res.json({ success: true, data });
    } catch (error: any) {
      const message = error?.message || "措施选井文件解析失败";
      const clientError = /工作簿|工作表|表头|必填列|不能为空|无效/.test(message);
      res.status(clientError ? 400 : 500).json({ success: false, message });
    }
  });

  app.get("/api/measure-well-selection/wells", async (req, res) => {
    try {
      const readFilter = (name: "block" | "station" | "grade") =>
        typeof req.query[name] === "string" ? req.query[name] : undefined;
      const filter: SelectionFilter = {
        block: readFilter("block"),
        station: readFilter("station"),
        grade: readFilter("grade") as SelectionFilter["grade"],
      };
      res.json({ success: true, data: await listSelectionWells(localDb, filter) });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "措施选井列表加载失败" });
    }
  });

  app.get("/api/measure-well-selection/wells/:wellName", async (req, res) => {
    try {
      const block = typeof req.query.block === "string" ? req.query.block : undefined;
      const data = await getSelectionWellDetail(localDb, req.params.wellName, block);
      if (!data) {
        res.status(404).json({ success: false, message: "未找到措施选井数据" });
        return;
      }
      const curves = await Promise.all(data.cycles.map(async (cycle) => {
        const rows = await localDb.all(
          'SELECT rq AS date, oil FROM production WHERE jh = ? AND rq BETWEEN ? AND ? ORDER BY rq ASC',
          [cycle.wellName, shiftDateDays(cycle.transferDate, -30), shiftDateDays(cycle.transferDate, 180)],
        );
        return {
          round: cycle.round,
          transferDate: cycle.transferDate,
          oilSeeingDay: cycle.oilSeeingDays,
          points: alignOilCurve(cycle.transferDate, rows),
        };
      }));
      res.json({ success: true, data: { ...data, curves } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "措施选井详情加载失败" });
    }
  });

  app.post("/api/well-temperature-tests/import", wellTemperatureImportUploadMiddleware, async (req, res) => {
    const file = (req as any).file;
    if (!file || !file.originalname.toLowerCase().endsWith(".xlsx")) {
      res.status(400).json({ success: false, message: "Please upload a .xlsx file" });
      return;
    }
    try {
      const parsed = parseWellTemperatureWorkbook(file.originalname, file.buffer);
      const data = await replaceWellTemperatureTest(localDb, {
        wellNo: parsed.wellNumber,
        testDate: parsed.date,
        perforationTopDepth: parsed.perforationTopDepth,
        perforationBottomDepth: parsed.perforationBottomDepth,
        points: parsed.points,
        sourceFile: file.originalname,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      const status = isWellTemperatureClientError(error) ? 400 : 500;
      res.status(status).json({ success: false, message: error?.message || "Failed to import well temperature test" });
    }
  });

  app.get("/api/well-temperature-tests", async (req, res) => {
    try {
      const wellNo = typeof req.query.wellNo === "string" ? req.query.wellNo : undefined;
      res.json({ success: true, data: await listWellTemperatureTests(localDb, wellNo) });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "Failed to list well temperature tests" });
    }
  });

  app.get("/api/well-temperature-tests/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ success: false, message: "Invalid test ID" });
      return;
    }
    try {
      const data = await getWellTemperatureTest(localDb, id);
      if (!data) {
        res.status(404).json({ success: false, message: "Well temperature test not found" });
        return;
      }
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "Failed to load well temperature test" });
    }
  });

  app.delete("/api/well-temperature-tests/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ success: false, message: "Invalid test ID" });
      return;
    }
    try {
      if (!await deleteWellTemperatureTest(localDb, id)) {
        res.status(404).json({ success: false, message: "Well temperature test not found" });
        return;
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "Failed to delete well temperature test" });
    }
  });

  // --- Auth APIs ---
  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    try {
      // Try with password_hash column first (new schema)
      let user: any = null;
      try {
        user = await localDb.get("SELECT * FROM users WHERE username = ? AND password_hash = ?", [username, password]);
      } catch {
        // Fallback: try with password column (old schema)
        try {
          user = await localDb.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
        } catch {
          // Column missing - will use hardcoded fallback below
        }
      }
      
      if (user) {
        res.json({ success: true, user: { name: user.name || user.username, role: user.role, username: user.username } });
      } else if (username === "admin" && password === "123456") {
        res.json({ success: true, user: { name: "系统管理员", role: "admin", username: "admin" } });
      } else {
        res.status(401).json({ success: false, message: "用户名或密码错误" });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: "登录失败，请重试" });
    }
  });

app.post("/api/register", async (req, res) => {
    const { username, password, name } = req.body;
    try {
      // Try new schema (password_hash)
      try {
        await localDb.run(
          "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
          [username, password, name, "user"]
        );
      } catch {
        // Fallback to old schema (password)
        await localDb.run(
          "INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)",
          [username, password, name, "user"]
        );
      }
      res.json({ success: true, message: "注册成功" });
    } catch (err: any) {
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        res.status(400).json({ success: false, message: "用户名已存在" });
      } else {
        res.status(500).json({ success: false, message: "注册失败: " + err.message });
      }
    }
  });

// --- Local Cache Logic (SQLite) ---
  app.get("/api/sync", async (req, res) => {
    const syncResult = await performIncrementalSync();
    if (syncResult.success) {
      res.json({
        success: true,
        message: syncResult.count > 0 ? `_________________________________ ${syncResult.count} _________` : "__________________________________________",
        count: syncResult.count,
        lastLocalDataDate: syncResult.lastLocalDataDate || null
      });
    } else {
      const statusCode = syncResult.error === "数据库连接未配置" ? 409 : 500;
      res.status(statusCode).json({ success: false, message: "同步失败: " + syncResult.error });
    }
  });

  app.get("/api/sync/status", async (req, res) => {
    try {
      const status = await getSyncStatus();
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "同步状态查询失败: " + err.message });
    }
  });

  app.get("/api/injection-production/cockpit", async (_req, res) => {
    try {
      const data = await buildInjectionProductionCockpit(localDb, {
        now: new Date().toISOString().slice(0, 10),
        syncStatus: await getSyncStatus(),
      });
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "注采驾驶舱数据加载失败" });
    }
  });

  app.get("/api/injection-production/cockpit/map-wells", async (req, res) => {
    try {
      const data = await buildInjectionProductionCockpit(localDb, {
        now: new Date().toISOString().slice(0, 10),
        syncStatus: await getSyncStatus(),
      });
      const block = typeof req.query.block === "string" ? req.query.block : "";
      res.json({ success: true, data: data.mapWells.filter((well) => !block || well.block === block) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "注采状态地图数据加载失败" });
    }
  });

  app.post("/api/injection-project-imports/preview", monthlyInjectionPlanUploadMiddleware, async (req, res) => {
    try {
      const file = (req as express.Request & { file?: { originalname: string; buffer: Buffer } }).file;
      if (!file) {
        res.status(400).json({ success: false, message: "\u8bf7\u9009\u62e9\u4e3b\u8ba1\u5212\u8868\u6587\u4ef6" });
        return;
      }

      const preview = parseMonthlyInjectionPlan(XLSX.read(file.buffer, { type: "buffer" }));
      if (!preview.sheetName) throw new Error("\u672a\u627e\u5230\u4e3b\u8ba1\u5212\u8868");
      if (!preview.planMonth) throw new Error("\u6807\u9898\u672a\u5305\u542b\u6708\u4efd");

      const data = await createPlanPreview(localDb, { ...preview, fileName: decodeUploadedFileName(file.originalname) });
      res.status(201).json({ success: true, data });
    } catch (error: any) {
      const message = error?.message || "\u4e3b\u8ba1\u5212\u8868\u89e3\u6790\u5931\u8d25";
      const status = /\u672a\u627e\u5230\u4e3b\u8ba1\u5212\u8868|\u6807\u9898\u672a\u5305\u542b\u6708\u4efd/.test(message) ? 400 : 500;
      res.status(status).json({ success: false, message });
    }
  });

  app.post("/api/injection-project-imports/:id/confirm", async (req, res) => {
    try {
      res.json({ success: true, data: await confirmPlanImport(localDb, Number(req.params.id)) });
    } catch (error: any) {
      const message = error?.message || "\u4e3b\u8ba1\u5212\u8868\u786e\u8ba4\u5931\u8d25";
      const status = message === "plan import not found" ? 404 : message === "only preview imports can be confirmed" ? 409 : 500;
      res.status(status).json({ success: false, message });
    }
  });

  app.get("/api/injection-project-imports", async (_req, res) => {
    try {
      res.json({ success: true, data: await listPlanImports(localDb) });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "\u5bfc\u5165\u5386\u53f2\u52a0\u8f7d\u5931\u8d25" });
    }
  });

  app.get("/api/injection-projects/plan-actual-comparison", async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const comparisonStatuses: readonly ComparisonStatus[] = ['not_started', 'in_progress', 'on_schedule', 'early', 'delayed', 'incomplete', 'suspected_other_cycle'];
      if (status && !comparisonStatuses.includes(status as ComparisonStatus)) {
        res.status(400).json({ success: false, message: "\u65e0\u6548\u7684\u5bf9\u6bd4\u72b6\u6001" });
        return;
      }
      const data = await buildInjectionPlanActualComparison(localDb, {
        planMonth: typeof req.query.planMonth === "string" ? req.query.planMonth : undefined,
        unit: typeof req.query.unit === "string" ? req.query.unit : undefined,
        boiler: typeof req.query.boiler === "string" ? req.query.boiler : undefined,
        status: status as ComparisonStatus | undefined,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || "注汽计划实际对比加载失败" });
    }
  });

  app.get("/api/injection-projects", async (_req, res) => {
    res.json({ success: true, data: await listInjectionProjects(localDb) });
  });
  app.post("/api/injection-projects", async (req, res) => {
    try { res.status(201).json({ success: true, data: await createInjectionProject(localDb, req.body) }); }
    catch (error: any) { res.status(400).json({ success: false, message: error.message }); }
  });
  app.post("/api/injection-projects/:id/plan-status", async (req, res) => {
    try { res.json({ success: true, data: await updatePlanStatus(localDb, Number(req.params.id), req.body.status) }); }
    catch (error: any) { res.status(error.message === '项目不存在' ? 404 : 409).json({ success: false, message: error.message }); }
  });
  app.post("/api/injection-projects/:id/transitions", async (req, res) => {
    try { res.json({ success: true, data: await transitionInjectionProject(localDb, Number(req.params.id), req.body.status, req.body.actualDate, req.body.remark) }); }
    catch (error: any) { res.status(error.message === '项目不存在' ? 404 : 409).json({ success: false, message: error.message }); }
  });
  app.get("/api/injection-projects/pending", async (req, res) => {
    res.json({ success: true, data: await listProjectPendingItems(localDb, typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10)) });
  });

  app.get("/api/dashboard/bootstrap", async (req, res) => {
    try {
      const data = await withTimingLog("/api/dashboard/bootstrap", () => getDashboardBootstrapData());
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "首页数据加载失败: " + err.message });
    }
  });

  app.get("/api/measures/years", async (_req, res) => {
    try {
      const rows = await localDb.all("SELECT DISTINCT batch_year FROM measure_tracking WHERE batch_year != '' ORDER BY batch_year DESC");
      res.json({ success: true, data: (rows || []).map((r: any) => r.batch_year) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/measures", async (req, res) => {
    try {
      const data = await withTimingLog("/api/measures", () => getMeasuresData(req.query));
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "措施数据查询失败: " + err.message });
    }
  });

  app.post("/api/measures", async (req, res) => {
    try {
      const record = normalizeMeasurePayload(req.body, "manual");
      if (!record) {
        res.status(400).json({ success: false, message: "请填写有效的本轮转抽时间，并至少提供井号" });
        return;
      }

      const result = await localDb.run(
        `
          INSERT INTO measure_tracking (
            measure_date,
            seq_no,
            jh,
            block,
            station,
            measure_type,
            measure_name,
            status,
            owner,
            result_text,
            oil_gain,
            liquid_gain,
            remark,
            current_status,
            current_round_transfer_time,
            current_round_measure_type,
            production_days,
            current_liquid,
            current_oil,
            current_diluent,
            current_water_cut,
            cumulative_oil_gain,
            evaluation,
            pre_measure_daily_oil,
            previous_period_oil_gain,
            detail_json,
            source_batch,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.measure_date,
          record.seq_no,
          record.jh,
          record.block,
          record.station,
          record.measure_type,
          record.measure_name,
          record.status,
          record.owner,
          record.result_text,
          record.oil_gain,
          record.liquid_gain,
          record.remark,
          record.current_status,
          record.current_round_transfer_time,
          record.current_round_measure_type,
          record.production_days,
          record.current_liquid,
          record.current_oil,
          record.current_diluent,
          record.current_water_cut,
          record.cumulative_oil_gain,
          record.evaluation,
          record.pre_measure_daily_oil,
          record.previous_period_oil_gain ?? null,
          record.detail_json,
          record.source_batch,
          record.created_at,
          record.updated_at
        ]
      );

      const created = await localDb.get("SELECT * FROM measure_tracking WHERE id = ?", [result.lastID]);
      res.json({ success: true, data: created });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  app.put("/api/measures/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, message: "用户名或密码错误" });
        return;
      }

      const existing = await localDb.get("SELECT * FROM measure_tracking WHERE id = ?", [id]);
      if (!existing) {
        res.status(404).json({ success: false, message: "措施记录不存在" });
        return;
      }

      const payload = normalizeMeasurePayload(
        {
          ...existing,
          ...req.body,
          created_at: existing.created_at,
          updated_at: new Date().toISOString()
        },
        existing.source_batch === "manual" ? "manual" : (existing.source_batch || "manual")
      );

      if (!payload) {
        res.status(400).json({ success: false, message: "请填写有效的本轮转抽时间，并至少提供井号" });
        return;
      }

      await localDb.run(
        `
          UPDATE measure_tracking
          SET measure_date = ?,
              seq_no = ?,
              jh = ?,
              block = ?,
              station = ?,
              measure_type = ?,
              measure_name = ?,
              status = ?,
              owner = ?,
              result_text = ?,
              oil_gain = ?,
              liquid_gain = ?,
              remark = ?,
              current_status = ?,
              current_round_transfer_time = ?,
              current_round_measure_type = ?,
              production_days = ?,
              current_liquid = ?,
              current_oil = ?,
              current_diluent = ?,
              current_water_cut = ?,
              cumulative_oil_gain = ?,
              evaluation = ?,
              pre_measure_daily_oil = ?,
              previous_period_oil_gain = ?,
              detail_json = ?,
              source_batch = ?,
              created_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
        [
          payload.measure_date,
          payload.seq_no,
          payload.jh,
          payload.block,
          payload.station,
          payload.measure_type,
          payload.measure_name,
          payload.status,
          payload.owner,
          payload.result_text,
          payload.oil_gain,
          payload.liquid_gain,
          payload.remark,
          payload.current_status,
          payload.current_round_transfer_time,
          payload.current_round_measure_type,
          payload.production_days,
          payload.current_liquid,
          payload.current_oil,
          payload.current_diluent,
          payload.current_water_cut,
          payload.cumulative_oil_gain,
          payload.evaluation,
          payload.pre_measure_daily_oil,
          payload.previous_period_oil_gain ?? null,
          payload.detail_json,
          payload.source_batch,
          payload.created_at,
          payload.updated_at,
          id
        ]
      );

      const updated = await localDb.get("SELECT * FROM measure_tracking WHERE id = ?", [id]);
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  app.delete("/api/measures/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, message: "用户名或密码错误" });
        return;
      }

      const result = await localDb.run("DELETE FROM measure_tracking WHERE id = ?", [id]);
      if (!result.changes) {
        res.status(404).json({ success: false, message: "措施记录不存在" });
        return;
      }

      res.json({ success: true, message: "措施记录不存在" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  app.post("/api/measures/import/preview", measureImportUploadMiddleware, async (req, res) => {
    try {
      const uploadedFile = (req as express.Request & { file?: { originalname: string; buffer: Buffer } }).file;
      if (!uploadedFile) {
        res.status(400).json({ success: false, message: "未接收到待预检的 Excel 文件" });
        return;
      }
      if (!isMeasureImportWorkbookFile(uploadedFile.originalname)) {
        res.status(400).json({ success: false, message: MEASURE_IMPORT_FILE_TYPE_MESSAGE });
        return;
      }
      const parsedImport = parseMeasureImportFile(uploadedFile.originalname, uploadedFile.buffer);

      // Detect year from parsed rows
      const expectedYear = (typeof req.query.year === 'string' && req.query.year.trim()) || undefined;
      const dataYears = new Set<string>();
      for (const row of parsedImport.rows) {
        const yearMatch = String(row.current_round_transfer_time || "").match(/^(\d{4})/);
        if (yearMatch) dataYears.add(yearMatch[1]);
      }
      const dataYearsSorted = Array.from(dataYears).sort();
      const dataYear = dataYearsSorted.length > 0 ? dataYearsSorted.join(', ') : '';
      const yearMismatch = expectedYear && dataYearsSorted.length > 0 && !dataYears.has(expectedYear);

      res.json({
        success: true,
        message: `预览完成，共解析 ${parsedImport.validRows} 条有效记录`,
        meta: {
          sheetName: parsedImport.sheetName,
          totalRows: parsedImport.totalRows,
          validRows: parsedImport.validRows,
          skippedCount: parsedImport.skippedCount,
          unknownHeaders: parsedImport.unknownHeaders,
          dataYear,
          yearMismatch,
          expectedYear: expectedYear || ''
        }
      });
    } catch (err: any) {
      const message = err?.message || "导入处理异常";
      const statusCode = err instanceof MeasureImportParseError ? 400 : 500;
      res.status(statusCode).json({ success: false, message: "措施数据导入预览失败: " + message });
    }
  });

  app.post("/api/measures/import", measureImportUploadMiddleware, async (req, res) => {
    try {
      const uploadedFile = (req as express.Request & { file?: { originalname: string; buffer: Buffer } }).file;
      const parsedImport = uploadedFile ? parseMeasureImportFile(uploadedFile.originalname, uploadedFile.buffer) : null;
      const rows = parsedImport?.rows ?? (Array.isArray(req.body?.rows) ? req.body.rows : []);
      if (rows.length === 0) {
        res.status(400).json({ success: false, message: "未接收到可导入的 Excel 数据" });
        return;
      }
      const year = (typeof req.query.year === 'string' && req.query.year) || (typeof req.body?.year === 'string' ? req.body.year : undefined);
      const result = await replaceMeasuresData(rows, year);
      res.json({
        success: true,
        message: `导入成功，${year ? year + '年 ' : ''}共 ${result.count} 条记录`,
        count: result.count,
        batchId: result.batchId,
        year: year || result.batchId?.slice(0, 4),
        meta: parsedImport
          ? {
              sheetName: parsedImport.sheetName,
              totalRows: parsedImport.totalRows,
              validRows: parsedImport.validRows,
              skippedCount: parsedImport.skippedCount,
              unknownHeaders: parsedImport.unknownHeaders
            }
          : null
      });
    } catch (err: any) {
      const message = err?.message || "导入处理异常";
      const statusCode = err instanceof MeasureImportParseError ? 400 : 500;
      res.status(statusCode).json({ success: false, message: "措施数据导入失败: " + message });
    }
  });

  // --- Occupancy APIs ---
  const occupancyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEASURE_IMPORT_FILE_LIMIT_BYTES }
  });
  const occupancyUploadMiddleware = handleMeasureImportUpload(occupancyUpload);

  const OCCUPANCY_IMPORT_FIELD_ALIASES = {
    report_date: ["日期", "报表日期", "上报日期"],
    occupancy_type: ["占产类型", "类型", "影响类型"],
    jh: ["井号", "井 号", "井名"],
    block: ["区块", "所属区块"],
    stop_or_decline_date: ["停产/降产日期", "停产日期", "降产日期", "堵停日期"],
    open_date: ["开井日期", "恢复日期"],
    normal_liquid: ["正常液", "正常产液", "正常日产液"],
    normal_oil: ["正常油", "正常产油", "正常日产油"],
    normal_diluent: ["正常掺油", "正常掺稀"],
    normal_water_cut: ["正常含水", "正常含水率"],
    current_liquid: ["目前液", "目前产液", "目前日产液", "当前液"],
    current_oil: ["目前油", "目前产油", "目前日产油", "当前油"],
    current_diluent: ["目前掺油", "目前掺稀", "当前掺油"],
    current_water_cut: ["目前含水", "目前含水率", "当前含水"],
    affected_liquid: ["影响液", "影响产液", "影响日产液"],
    affected_oil: ["影响油", "影响产油", "影响日产油"],
    affected_diluent: ["影响掺油", "影响掺稀"],
    affected_water_cut: ["影响含水", "影响含水率"],
    remark: ["备注", "说明", "原因"]
  };

  function mapOccupancyImportRow(rawRow: Record<string, unknown>) {
    const row: Record<string, unknown> = {};
    const headers = Object.keys(rawRow);
    for (const header of headers) {
      const normalizedHeader = normalizeMeasureImportHeader(header);
      for (const [field, aliases] of Object.entries(OCCUPANCY_IMPORT_FIELD_ALIASES)) {
        if ((aliases as readonly string[]).some((alias) => normalizeMeasureImportHeader(alias) === normalizedHeader)) {
          if (!(field in row)) {
            const rawValue = rawRow[header];
            const text = typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "");
            if (["normal_liquid", "normal_oil", "normal_diluent", "normal_water_cut", "current_liquid", "current_oil", "current_diluent", "current_water_cut", "affected_liquid", "affected_oil", "affected_diluent", "affected_water_cut"].includes(field)) {
              row[field] = normalizeMeasureImportNumber(rawValue);
            } else {
              row[field] = text;
            }
          }
          break;
        }
      }
      if (!(header in row) && !(normalizedHeader in row)) {
        row[header] = rawRow[header];
      }
    }
    return row;
  }

  app.post("/api/occupancy/import", occupancyUploadMiddleware, async (req, res) => {
    try {
      const uploadedFile = (req as express.Request & { file?: { originalname: string; buffer: Buffer } }).file;
      if (!uploadedFile) {
        res.status(400).json({ success: false, message: "请上传 Excel 文件" });
        return;
      }

      const workbook = XLSX.read(uploadedFile.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames.find((name) => name.includes("2026")) || workbook.SheetNames[0] || "";
      if (!sheetName) {
        res.status(400).json({ success: false, message: "未找到有效的工作表" });
        return;
      }

      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
      if (rawRows.length === 0) {
        res.status(400).json({ success: false, message: "工作表中没有数据" });
        return;
      }

      const rows = rawRows.map(mapOccupancyImportRow);
      const now = new Date().toISOString();

      const stmt = await localDb.prepare(`
        INSERT INTO occupancy_records (
          report_date, occupancy_type, jh, block, stop_or_decline_date, open_date,
          normal_liquid, normal_oil, normal_diluent, normal_water_cut,
          current_liquid, current_oil, current_diluent, current_water_cut,
          affected_liquid, affected_oil, affected_diluent, affected_water_cut,
          remark, raw_json, source_file, sheet_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      await localDb.run("BEGIN TRANSACTION");
      await localDb.run("DELETE FROM occupancy_records");

      for (const row of rows) {
        const rawJson = JSON.stringify(rawRows[rows.indexOf(row)] || {});
        await stmt.run(
          String(row.report_date || ""),
          String(row.occupancy_type || ""),
          String(row.jh || ""),
          String(row.block || ""),
          String(row.stop_or_decline_date || ""),
          String(row.open_date || ""),
          Number(row.normal_liquid || 0),
          Number(row.normal_oil || 0),
          Number(row.normal_diluent || 0),
          Number(row.normal_water_cut || 0),
          Number(row.current_liquid || 0),
          Number(row.current_oil || 0),
          Number(row.current_diluent || 0),
          Number(row.current_water_cut || 0),
          Number(row.affected_liquid || 0),
          Number(row.affected_oil || 0),
          Number(row.affected_diluent || 0),
          Number(row.affected_water_cut || 0),
          String(row.remark || ""),
          rawJson,
          uploadedFile.originalname,
          sheetName,
          now
        );
      }

      await localDb.run("COMMIT");
      await stmt.finalize();

      const summary = await buildOccupancySummary(uploadedFile.originalname, sheetName);
      res.json({ success: true, data: { summary }, message: `导入成功，共 ${rows.length} 条记录` });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "占产数据导入失败: " + (err?.message || "未知错误") });
    }
  });

  async function buildOccupancySummary(fileName: string, sheetName: string) {
    const countRow = await localDb.get("SELECT COUNT(*) as cnt FROM occupancy_records");
    const count = countRow?.cnt || 0;
    const types = await localDb.all(
      "SELECT occupancy_type as type, COUNT(*) as cnt, SUM(affected_oil) as affectedOil FROM occupancy_records GROUP BY occupancy_type ORDER BY affectedOil DESC"
    );
    const preview = await localDb.all("SELECT * FROM occupancy_records ORDER BY id ASC LIMIT 10");
    const columns = await localDb.all("PRAGMA table_info(occupancy_records)");
    const createdAt = new Date().toISOString();

    return {
      count,
      fileName,
      sheetName,
      createdAt,
      types: (types || []).map((t: any) => ({ type: t.type, count: t.cnt, affectedOil: Number(t.affectedOil || 0) })),
      preview: preview || [],
      columns: (columns || []).map((c: any) => c.name)
    };
  }

  app.get("/api/occupancy/summary", async (_req, res) => {
    try {
      const row = await localDb.get("SELECT source_file, sheet_name, created_at FROM occupancy_records ORDER BY id DESC LIMIT 1");
      const summary = row
        ? await buildOccupancySummary(row.source_file || "", row.sheet_name || "")
        : null;
      res.json({ success: true, data: summary });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "获取占产汇总失败: " + err.message });
    }
  });

  function computeMovingAverage(dailyValues: Map<string, number>, labels: string[], intervalDays: number) {
    const data = labels.map((label) => Number(dailyValues.get(label) || 0));
    if (intervalDays <= 1) return data;
    const result: number[] = [];
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - intervalDays + 1); j <= i; j++) {
        sum += data[j];
        count++;
      }
      result.push(count > 0 ? Number((sum / count).toFixed(1)) : 0);
    }
    return result;
  }

  app.get("/api/occupancy/type-analysis", async (req, res) => {
    try {
      const intervalDays = Math.max(1, Math.min(30, Number(req.query.intervalDays) || 5));

      const rows = await localDb.all(
        "SELECT report_date, occupancy_type, SUM(affected_oil) as total_oil FROM occupancy_records WHERE report_date IS NOT NULL AND report_date != '' GROUP BY report_date, occupancy_type ORDER BY report_date ASC"
      );

      const labels = Array.from(new Set((rows || []).map((r: any) => r.report_date))).sort();
      const typeSet = new Map<string, Map<string, number>>();
      for (const r of (rows || [])) {
        if (!typeSet.has(r.occupancy_type)) typeSet.set(r.occupancy_type, new Map());
        typeSet.get(r.occupancy_type)!.set(r.report_date, Number(r.total_oil || 0));
      }

      const series = Array.from(typeSet.entries()).map(([name, dailyMap]) => ({
        name,
        data: computeMovingAverage(dailyMap, labels, intervalDays)
      }));

      res.json({ success: true, data: { intervalDays, labels, series } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "占产类型分析失败: " + err.message });
    }
  });

  app.get("/api/occupancy/block-analysis", async (req, res) => {
    try {
      const intervalDays = Math.max(1, Math.min(30, Number(req.query.intervalDays) || 5));

      const rows = await localDb.all(
        "SELECT block, report_date, occupancy_type, SUM(affected_oil) as total_oil FROM occupancy_records WHERE block IS NOT NULL AND block != '' AND report_date IS NOT NULL AND report_date != '' GROUP BY block, report_date, occupancy_type ORDER BY block, report_date ASC"
      );

      const labels = Array.from(new Set((rows || []).map((r: any) => r.report_date))).sort();
      const blockMap = new Map<string, Map<string, Map<string, number>>>();
      for (const r of (rows || [])) {
        if (!blockMap.has(r.block)) blockMap.set(r.block, new Map());
        const typeMap = blockMap.get(r.block)!;
        if (!typeMap.has(r.occupancy_type)) typeMap.set(r.occupancy_type, new Map());
        typeMap.get(r.occupancy_type)!.set(r.report_date, Number(r.total_oil || 0));
      }

      const blocks = Array.from(blockMap.entries()).map(([block, typeMap]) => {
        const series = Array.from(typeMap.entries()).map(([name, dailyMap]) => ({
          name,
          data: computeMovingAverage(dailyMap, labels, intervalDays)
        }));
        const total = labels.map((_, idx) => {
          let sum = 0;
          for (const s of series) sum += s.data[idx] || 0;
          return Number(sum.toFixed(1));
        });
        const count = series.reduce((acc, s) => acc + s.data.reduce((a, v) => a + v, 0), 0);
        const affectedOil = series.reduce((acc, s) => acc + s.data[s.data.length - 1] || 0, 0);
        return { block, labels, series, total, count: Math.round(count), affectedOil: Number(affectedOil.toFixed(1)) };
      }).filter(b => b.count > 0).sort((a, b) => b.affectedOil - a.affectedOil);

      res.json({ success: true, data: { intervalDays, blocks } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "区块占产分析失败: " + err.message });
    }
  });

  // --- Pump Tracking APIs ---
  app.post("/api/external-transfer/upload", async (req, res) => {
    try {
      const { fileName, records } = req.body || {};
      if (!Array.isArray(records) || records.length === 0) {
        res.status(400).json({ success: false, message: "缺少有效外输数据" });
        return;
      }
      await replaceExternalTransferUpload(localDb, { fileName: String(fileName || ''), records });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: `保存外输数据失败: ${err.message}` });
    }
  });

  app.get("/api/external-transfer/upload", async (_req, res) => {
    try {
      res.json({ success: true, data: await getExternalTransferUpload(localDb) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: `读取外输数据失败: ${err.message}` });
    }
  });

  app.post("/api/pump-tracking/upload-data", async (req, res) => {
    try {
      const { fileName, sheetName, rows, columns } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ success: false, message: "缺少有效数据行" });
        return;
      }
      const now = new Date().toISOString();
      await localDb.run("DELETE FROM pump_tracking_uploads");
      await localDb.run(
        "INSERT INTO pump_tracking_uploads (source_file, sheet_name, columns_json, rows_json, created_at) VALUES (?, ?, ?, ?, ?)",
        [fileName || "", sheetName || "", JSON.stringify(columns || []), JSON.stringify(rows), now]
      );
      res.json({ success: true, data: { fileName, sheetName, rows, columns }, message: "检泵跟踪数据保存成功" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "检泵跟踪数据保存失败: " + err.message });
    }
  });

  app.get("/api/pump-tracking/upload-data", async (_req, res) => {
    try {
      const row = await localDb.get("SELECT source_file, sheet_name, columns_json, rows_json FROM pump_tracking_uploads ORDER BY id DESC LIMIT 1");
      if (!row) {
        res.json({ success: true, data: null });
        return;
      }
      res.json({
        success: true,
        data: {
          fileName: row.source_file,
          sheetName: row.sheet_name,
          columns: JSON.parse(row.columns_json || "[]"),
          rows: JSON.parse(row.rows_json || "[]")
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "获取检泵跟踪数据失败: " + err.message });
    }
  });

  app.post("/api/pump-tracking/old-well-recovered-oil", async (req, res) => {
    try {
      const { intervalDays = 5, groups = [] } = req.body || {};
      if (!Array.isArray(groups) || groups.length === 0) {
        res.status(400).json({ success: false, message: "缺少分组参数" });
        return;
      }

      const latestDate = await getLocalLatestDate();
      const endDate = latestDate || new Date().toISOString().slice(0, 10);

      const resultGroups = await Promise.all(groups.map(async (group: any) => {
        const wells = Array.isArray(group.wells) ? group.wells : [];
        if (wells.length === 0) {
          return { key: group.key, title: group.title, labels: [], oil: [], previousOil: [], matchedRows: 0, matchedWells: 0, source: "local_production", wellDetails: [] };
        }

        let maxDays = 0;
        const wellRanges: Array<{ jh: string; block: string; type: string; status: string; openDate: string; previousOpenDate: string; dayCount: number; currentRows: any[]; previousRows: any[] }> = [];

        for (const well of wells) {
          const openDate = String(well.openDate || "").trim();
          const previousOpenDate = String(well.previousOpenDate || "").trim();
          if (!openDate || openDate < "2020-01-01") continue;

          const currentEnd = openDate <= endDate ? endDate : openDate;
          const dayCount = getInclusiveDayCount(openDate, currentEnd);
          if (dayCount <= 0) continue;

          const [currentRows, previousRows] = await Promise.all([
            getProductionRowsBetween(well.jh, openDate, currentEnd),
            previousOpenDate && previousOpenDate >= "2020-01-01"
              ? getProductionRowsBetween(well.jh, previousOpenDate, shiftDateDays(previousOpenDate, dayCount - 1))
              : Promise.resolve([] as any[])
          ]);

          if (dayCount > maxDays) maxDays = dayCount;
          wellRanges.push({
            jh: well.jh,
            block: well.block || "",
            type: well.type || "",
            status: well.status || "",
            openDate,
            previousOpenDate,
            dayCount,
            currentRows,
            previousRows
          });
        }

        if (wellRanges.length === 0) {
          return { key: group.key, title: group.title, labels: [], oil: [], previousOil: [], matchedRows: 0, matchedWells: 0, source: "local_production", wellDetails: [] };
        }

        const labels = Array.from({ length: maxDays }, (_, i) => shiftDateDays(wellRanges[0].openDate, i));
        const oil: number[] = Array(maxDays).fill(0);
        const previousOil: number[] = Array(maxDays).fill(0);

        for (const range of wellRanges) {
          const currentSeries = buildDailyOilSeries(range.currentRows, range.openDate, range.dayCount);
          const previousSeries = buildDailyOilSeries(range.previousRows, range.previousOpenDate, range.dayCount);
          for (let i = 0; i < range.dayCount; i++) {
            oil[i] += currentSeries[i]?.oil || 0;
            if (range.previousOpenDate) {
              previousOil[i] += previousSeries[i]?.oil || 0;
            }
          }
        }

        const movingAvg = (data: number[]) => {
          const result: number[] = [];
          for (let i = 0; i < data.length; i++) {
            let sum = 0, cnt = 0;
            for (let j = Math.max(0, i - intervalDays + 1); j <= i; j++) { sum += data[j]; cnt++; }
            result.push(cnt > 0 ? Number((sum / cnt).toFixed(1)) : 0);
          }
          return result;
        };

        return {
          key: group.key,
          title: group.title,
          labels,
          oil: movingAvg(oil),
          previousOil: movingAvg(previousOil),
          matchedRows: wellRanges.length,
          matchedWells: wellRanges.length,
          source: "local_production",
          wellDetails: wellRanges.map(r => ({
            jh: r.jh, block: r.block, type: r.type, status: r.status,
            openDate: r.openDate, previousOpenDate: r.previousOpenDate,
            currentRecentOil: r.currentRows.length > 0 ? Number(r.currentRows[r.currentRows.length - 1]?.oil || 0) : null,
            previousRecentOil: r.previousRows.length > 0 ? Number(r.previousRows[r.previousRows.length - 1]?.oil || 0) : null,
            recoverableOil: null, reason: "", interval: null, preOil: null, potentialOil: null, remark: ""
          }))
        };
      }));

      res.json({ success: true, data: { groups: resultGroups } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "检泵跟踪曲线生成失败: " + err.message });
    }
  });

  // --- Pump Deep Analysis APIs ---
  app.post("/api/pump-deep-analysis/upload-data", async (req, res) => {
    try {
      const { fileName, sheetName, rows, columns, sheets } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ success: false, message: "缺少有效数据行" });
        return;
      }
      const now = new Date().toISOString();
      await localDb.run("DELETE FROM pump_deep_analysis_uploads");
      await localDb.run(
        "INSERT INTO pump_deep_analysis_uploads (source_file, sheet_name, columns_json, rows_json, sheets_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [fileName || "", sheetName || "", JSON.stringify(columns || []), JSON.stringify(rows), JSON.stringify(sheets || {}), now]
      );
      res.json({ success: true, data: { fileName, sheetName, rows, columns, sheets }, message: "检泵分析数据保存成功" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "检泵分析数据保存失败: " + err.message });
    }
  });

  app.get("/api/pump-deep-analysis/upload-data", async (_req, res) => {
    try {
      const row = await localDb.get("SELECT source_file, sheet_name, columns_json, rows_json, sheets_json FROM pump_deep_analysis_uploads ORDER BY id DESC LIMIT 1");
      if (!row) {
        res.json({ success: true, data: null });
        return;
      }
      res.json({
        success: true,
        data: {
          fileName: row.source_file,
          sheetName: row.sheet_name,
          columns: JSON.parse(row.columns_json || "[]"),
          rows: JSON.parse(row.rows_json || "[]"),
          sheets: JSON.parse(row.sheets_json || "{}")
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "获取检泵分析数据失败: " + err.message });
    }
  });

  // --- Water Lab APIs ---
  function parseWaterLabMonth(sheetName: string) {
    const match = String(sheetName || "").match(/(\d{1,2})\s*月/);
    return match ? Number(match[1]) : null;
  }

  function parseWaterLabDayColumn(colName: string) {
    const text = String(colName || "").replace(/\s+/g, "");
    const match = text.match(/(\d{1,2})月_?(\d{1,2})/);
    if (match) return { month: Number(match[1]), day: Number(match[2]) };
    const singleMatch = text.match(/^(\d{1,2})月$/);
    if (singleMatch) return { month: Number(singleMatch[1]), day: 1 };
    return null;
  }

  app.post("/api/water-lab/upload-data", async (req, res) => {
    try {
      const { fileName, sheetName, rows, columns, sheets } = req.body || {};
      const allSheets = (sheets && typeof sheets === "object" ? sheets : {}) as Record<string, { sheetName: string; rows: Record<string, unknown>[]; columns: string[] }>;

      const now = new Date().toISOString();
      await localDb.run("DELETE FROM water_lab_uploads");
      await localDb.run(
        "INSERT INTO water_lab_uploads (source_file, sheet_name, columns_json, rows_json, sheets_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [fileName || "", sheetName || "", JSON.stringify(columns || []), JSON.stringify(rows || []), JSON.stringify(sheets || {}), now]
      );

      await localDb.run("DELETE FROM water_lab_records");

      let inserted = 0;
      const year = 2026;
      const sheetEntries = Object.keys(allSheets).length > 0 ? Object.values(allSheets) : [{ sheetName, rows, columns }];

      // Build all rows first, then batch insert in a transaction
      const toInsert: Array<[string, string, number, string, string, string]> = [];

      for (const sheet of sheetEntries) {
        if (!Array.isArray(sheet.rows) || sheet.rows.length === 0) continue;
        const dayColumns: Array<{ column: string; month: number; day: number }> = [];

        for (const col of (sheet.columns || Object.keys(sheet.rows[0] || {}))) {
          if (/^井号|^作业区|^区块|^站名|^井\s*号|^站\s*名/.test(String(col))) continue;
          if (/\d+月_?\d+/.test(String(col)) || /^\d+月$/.test(String(col))) {
            const parsed = parseWaterLabDayColumn(String(col));
            if (parsed) dayColumns.push({ column: String(col), month: parsed.month, day: parsed.day });
          }
        }

        for (const row of sheet.rows) {
          const jh = String(row["井号"] || row["井 号"] || "").trim();
          if (!jh || jh === "井号" || jh === "井 号") continue;
          if (!/^[A-Za-z0-9一-鿿\-]+/.test(jh)) continue;
          const block = String(row["区块"] || "").trim();
          const area = String(row["作业区"] || "").trim();
          const station = String(row["站名"] || row["站号"] || "").trim();

          for (const { column, month, day } of dayColumns) {
            const value = row[column];
            if (value === undefined || value === null || value === "") continue;
            const waterCut = Number(String(value).replace(/[,%]/g, ""));
            if (!Number.isFinite(waterCut)) continue;
            const dayStr = String(day).padStart(2, "0");
            const monthStr = String(month).padStart(2, "0");
            const date = `${year}-${monthStr}-${dayStr}`;
            toInsert.push([jh, date, waterCut, block, station, area]);
          }
        }
      }

      if (toInsert.length > 0) {
        await localDb.run("BEGIN TRANSACTION");
        const stmt = await localDb.prepare(
          "INSERT INTO water_lab_records (jh, record_date, water_cut, block, station, area, source_file, sheet_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const [jh, date, waterCut, block, station, area] of toInsert) {
          await stmt.run(jh, date, waterCut, block, station, area, fileName || "", sheetName || "", now);
          inserted++;
        }
        await stmt.finalize();
        await localDb.run("COMMIT");
      }

      res.json({ success: true, message: `含水化验数据导入成功，共 ${inserted} 条记录`, count: inserted });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "含水化验数据导入失败: " + err.message });
    }
  });

  app.get("/api/water-lab/upload-data", async (_req, res) => {
    try {
      const row = await localDb.get("SELECT source_file, sheet_name, columns_json, rows_json, sheets_json FROM water_lab_uploads ORDER BY id DESC LIMIT 1");
      if (!row) { res.json({ success: true, data: null }); return; }
      res.json({ success: true, data: { fileName: row.source_file, sheetName: row.sheet_name, columns: JSON.parse(row.columns_json || "[]"), rows: JSON.parse(row.rows_json || "[]"), sheets: JSON.parse(row.sheets_json || "{}") } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/well-list", async (_req, res) => {
    try {
      const rows = await localDb.all("SELECT DISTINCT jh, block, station, area FROM water_lab_records ORDER BY jh");
      res.json({ success: true, data: rows || [] });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/block-list", async (_req, res) => {
    try {
      const rows = await localDb.all("SELECT block, COUNT(DISTINCT jh) as well_count, COUNT(DISTINCT record_date) as record_days FROM water_lab_records WHERE block IS NOT NULL AND block != '' GROUP BY block ORDER BY well_count DESC");
      res.json({ success: true, data: rows || [] });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/well-trend", async (req, res) => {
    try {
      const jh = String(req.query.jh || "").trim();
      if (!jh) { res.status(400).json({ success: false, message: "请选择井号" }); return; }
      const labRows = await localDb.all("SELECT record_date, water_cut, block, station FROM water_lab_records WHERE jh = ? ORDER BY record_date ASC", [jh]);
      if (!labRows || labRows.length === 0) { res.json({ success: true, data: null }); return; }
      const dates = labRows.map((r: any) => r.record_date);
      const labWaterCut = labRows.map((r: any) => Number(r.water_cut || 0));
      const prodRows = await localDb.all("SELECT rq, water_cut FROM production WHERE jh = ? AND rq BETWEEN ? AND ? ORDER BY rq ASC", [jh, dates[0], dates[dates.length - 1]]);
      const prodMap = new Map((prodRows || []).map((r: any) => [r.rq, Number(r.water_cut || 0)]));
      const prodWaterCut = dates.map((d: string) => prodMap.has(d) ? prodMap.get(d)! : null);
      res.json({ success: true, data: { dates, lab_water_cut: labWaterCut, prod_water_cut: prodWaterCut, block: labRows[0].block || "", station: labRows[0].station || "" } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/block-trend", async (req, res) => {
    try {
      const block = String(req.query.block || "").trim();
      if (!block) { res.status(400).json({ success: false, message: "请选择区块" }); return; }
      const rows = await localDb.all("SELECT record_date, AVG(water_cut) as avg_water_cut, COUNT(DISTINCT jh) as well_count FROM water_lab_records WHERE block = ? GROUP BY record_date ORDER BY record_date ASC", [block]);
      const dates = (rows || []).map((r: any) => r.record_date);
      res.json({ success: true, data: { dates, avg_water_cut: (rows || []).map((r: any) => Number((r.avg_water_cut || 0).toFixed(1))), well_count: (rows || []).map((r: any) => Number(r.well_count)) } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/station-trend", async (req, res) => {
    try {
      const station = String(req.query.station || "").trim();
      if (!station) { res.status(400).json({ success: false, message: "请输入站名" }); return; }
      const rows = await localDb.all("SELECT record_date, AVG(water_cut) as avg_water_cut, COUNT(DISTINCT jh) as well_count FROM water_lab_records WHERE station = ? GROUP BY record_date ORDER BY record_date ASC", [station]);
      const dates = (rows || []).map((r: any) => r.record_date);
      res.json({ success: true, data: { dates, avg_water_cut: (rows || []).map((r: any) => Number((r.avg_water_cut || 0).toFixed(1))), well_count: (rows || []).map((r: any) => Number(r.well_count)) } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/anomalies", async (req, res) => {
    try {
      const threshold = Math.max(1, Number(req.query.threshold) || 20);
      const dateRows = await localDb.all("SELECT MIN(record_date) as min_date, MAX(record_date) as max_date FROM water_lab_records");
      const minDate = dateRows?.[0]?.min_date || "";
      const maxDate = dateRows?.[0]?.max_date || "";
      const currentMonth = maxDate ? maxDate.slice(0, 7) : "";
      const previousMonth = minDate ? minDate.slice(0, 7) : "";

      const wells = await localDb.all("SELECT DISTINCT jh FROM water_lab_records");
      const anomalies: Array<{ jh: string; block: string; station: string; current_water_cut: number; previous_water_cut: number; rise: number; record_date: string }> = [];
      for (const { jh } of (wells || [])) {
        const first = await localDb.get("SELECT record_date, water_cut FROM water_lab_records WHERE jh = ? ORDER BY record_date ASC LIMIT 1", [jh]);
        const last = await localDb.get("SELECT record_date, water_cut FROM water_lab_records WHERE jh = ? ORDER BY record_date DESC LIMIT 1", [jh]);
        const meta = await localDb.get("SELECT block, station FROM water_lab_records WHERE jh = ? LIMIT 1", [jh]);
        if (first && last && first.record_date !== last.record_date) {
          const rise = Number((last.water_cut || 0)) - Number((first.water_cut || 0));
          if (Math.abs(rise) >= threshold) {
            anomalies.push({ jh, block: meta?.block || "", station: meta?.station || "", current_water_cut: Number((last.water_cut || 0).toFixed(1)), previous_water_cut: Number((first.water_cut || 0).toFixed(1)), rise: Number(rise.toFixed(1)), record_date: last.record_date });
          }
        }
      }
      anomalies.sort((a, b) => Math.abs(b.rise) - Math.abs(a.rise));
      res.json({ success: true, data: { threshold, currentMonth, previousMonth, anomalies } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/compare-prod", async (req, res) => {
    try {
      const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
      const threshold = Math.max(1, Number(req.query.threshold) || 30);
      const dateRows = await localDb.all("SELECT MIN(record_date) as min_date, MAX(record_date) as max_date FROM water_lab_records");
      const startDate = dateRows?.[0]?.min_date || "";
      const endDate = dateRows?.[0]?.max_date || "";

      const rows = await localDb.all(
        `SELECT w.jh, w.block, w.station,
                ROUND(AVG(w.water_cut), 1) as lab_avg,
                ROUND(AVG(p.water_cut), 1) as prod_avg,
                COUNT(DISTINCT w.record_date) as lab_count,
                COUNT(DISTINCT p.rq) as prod_days
         FROM water_lab_records w
         LEFT JOIN production p ON w.jh = p.jh AND p.rq = w.record_date
         GROUP BY w.jh, w.block, w.station
         HAVING lab_avg IS NOT NULL AND prod_avg IS NOT NULL`
      );
      const deviations = (rows || []).map((r: any) => ({
        jh: r.jh, block: r.block, station: r.station,
        lab_count: r.lab_count,
        lab_avg: Number(r.lab_avg || 0),
        prod_avg: Number(r.prod_avg || 0),
        deviation: Number((Math.abs((r.lab_avg || 0) - (r.prod_avg || 0))).toFixed(1))
      })).filter((r: any) => r.deviation >= threshold).sort((a: any, b: any) => b.deviation - a.deviation);
      res.json({ success: true, data: { threshold, days, startDate, endDate, deviations } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/water-lab/key-well-tracking", async (req, res) => {
    try {
      const highWcThreshold = Math.max(50, Math.min(100, Number(req.query.highWc) || 80));
      const labGapDays = Math.max(1, Math.min(30, Number(req.query.labGap) || 3));
      const wcDiffThreshold = Math.max(5, Math.min(50, Number(req.query.wcDiff) || 20));
      const now = new Date().toISOString().slice(0, 10);
      const labDateRows = await localDb.all("SELECT MIN(record_date) as min_date, MAX(record_date) as max_date FROM water_lab_records");
      const labMaxDate = labDateRows?.[0]?.max_date || now;

      // --- Feature 1: High water cut wells ---
      const wellMetaMap = new Map<string, { block: string; station: string }>();

      // Latest lab water cut per well
      const labLatest = await localDb.all(
        `SELECT w.jh, w.water_cut, w.record_date, w.block, w.station
         FROM water_lab_records w
         INNER JOIN (SELECT jh, MAX(record_date) as max_date FROM water_lab_records GROUP BY jh) latest
           ON w.jh = latest.jh AND w.record_date = latest.max_date`
      );
      const labWcMap = new Map<string, { wc: number; date: string }>();
      for (const r of (labLatest || [])) {
        labWcMap.set(r.jh, { wc: Number(r.water_cut || 0), date: r.record_date });
        if (!wellMetaMap.has(r.jh)) wellMetaMap.set(r.jh, { block: r.block, station: r.station });
      }

      // Latest production water cut per well (from production table, last 7 days)
      const prodLatest = await localDb.all(
        `SELECT p.jh, p.water_cut, p.rq as record_date
         FROM production p
         INNER JOIN (SELECT jh, MAX(rq) as max_rq FROM production WHERE rq >= date(?) GROUP BY jh) latest
           ON p.jh = latest.jh AND p.rq = latest.max_rq`,
        [shiftDateDays(now, -30)]
      );
      const prodWcMap = new Map<string, { wc: number; date: string }>();
      for (const r of (prodLatest || [])) {
        prodWcMap.set(r.jh, { wc: Number(r.water_cut || 0), date: r.record_date });
      }

      // Get measure tracking wells for metadata
      const measureMeta = await localDb.all("SELECT DISTINCT jh, block FROM measure_tracking WHERE current_status = '生产'");
      for (const r of (measureMeta || [])) {
        if (!wellMetaMap.has(r.jh)) wellMetaMap.set(r.jh, { block: r.block, station: "" });
      }

      const highWaterWells: Array<{
        jh: string; block: string; station: string;
        latest_lab_wc: number | null; latest_lab_date: string | null;
        latest_prod_wc: number | null; latest_prod_date: string | null;
        days_since_last_lab: number | null; no_lab_alert: boolean;
      }> = [];

      const allWellJhs = new Set([...labWcMap.keys(), ...prodWcMap.keys(), ...(measureMeta || []).map((r: any) => r.jh)]);
      for (const jh of allWellJhs) {
        const lab = labWcMap.get(jh);
        const prod = prodWcMap.get(jh);
        const meta = wellMetaMap.get(jh) || { block: "", station: "" };

        const maxWc = Math.max(lab?.wc || 0, prod?.wc || 0);
        if (maxWc < highWcThreshold) continue;

        let daysSinceLastLab: number | null = null;
        if (lab) {
          daysSinceLastLab = getInclusiveDayCount(lab.date, labMaxDate) - 1;
        }

        highWaterWells.push({
          jh, block: meta.block, station: meta.station,
          latest_lab_wc: lab?.wc ?? null,
          latest_lab_date: lab?.date ?? null,
          latest_prod_wc: prod?.wc ?? null,
          latest_prod_date: prod?.date ?? null,
          days_since_last_lab: daysSinceLastLab,
          no_lab_alert: daysSinceLastLab === null || daysSinceLastLab > labGapDays
        });
      }
      highWaterWells.sort((a, b) => Math.max(b.latest_prod_wc || 0, b.latest_lab_wc || 0) - Math.max(a.latest_prod_wc || 0, a.latest_lab_wc || 0));

      // --- Feature 2: Measure wells water cut comparison ---
      const measureWcAlerts: Array<{
        jh: string; block: string;
        production_days: number; current_transfer_time: string;
        current_avg_wc: number; previous_avg_wc: number; diff: number;
      }> = [];

      const measureRows = await localDb.all(
        "SELECT * FROM measure_tracking WHERE current_status = '生产' AND current_round_transfer_time IS NOT NULL AND current_round_transfer_time != ''"
      );

      for (const record of (measureRows || [])) {
        const detail = JSON.parse(record.detail_json || "{}");
        const previousTransferTime = detail?.previousRound?.["上轮转抽时间"] || detail?.previousRound?.["上轮转抽日期"] || "";

        const latestProdDate = (await localDb.get("SELECT MAX(rq) as lastDate FROM production"))?.lastDate || now;
        if (latestProdDate < record.current_round_transfer_time) continue;

        const productionDays = getInclusiveDayCount(record.current_round_transfer_time, latestProdDate);
        if (productionDays <= 0) continue;

        // Current round: average water_cut since transfer time
        const currentEndDate = shiftDateDays(record.current_round_transfer_time, productionDays - 1);
        const currentWcRow = await localDb.get(
          "SELECT AVG(water_cut) as avg_wc FROM production WHERE jh = ? AND rq BETWEEN ? AND ? AND water_cut IS NOT NULL",
          [record.jh, record.current_round_transfer_time, currentEndDate]
        );
        const currentAvgWc = currentWcRow?.avg_wc != null ? Number(Number(currentWcRow.avg_wc).toFixed(1)) : null;

        // Previous round: average water_cut for same number of days from previous transfer time
        let previousAvgWc: number | null = null;
        if (previousTransferTime && previousTransferTime >= "2020-01-01") {
          const previousEndDate = shiftDateDays(previousTransferTime, productionDays - 1);
          const prevWcRow = await localDb.get(
            "SELECT AVG(water_cut) as avg_wc FROM production WHERE jh = ? AND rq BETWEEN ? AND ? AND water_cut IS NOT NULL",
            [record.jh, previousTransferTime, previousEndDate]
          );
          previousAvgWc = prevWcRow?.avg_wc != null ? Number(Number(prevWcRow.avg_wc).toFixed(1)) : null;
        }

        if (currentAvgWc !== null && previousAvgWc !== null) {
          const diff = Number((currentAvgWc - previousAvgWc).toFixed(1));
          if (Math.abs(diff) >= wcDiffThreshold) {
            measureWcAlerts.push({
              jh: record.jh,
              block: record.block || "",
              production_days: productionDays,
              current_transfer_time: record.current_round_transfer_time,
              current_avg_wc: currentAvgWc,
              previous_avg_wc: previousAvgWc,
              diff
            });
          }
        }
      }
      measureWcAlerts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

      res.json({ success: true, data: { highWaterWells, measureWcAlerts, labMaxDate } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  // --- Production Forecast API ---
  const FORECAST_DAYS = 365;
  const PREDICT_TRANSFER_ALIASES: Record<string, { aliases: string[]; offsetDays: number }> = {
    '转注': { aliases: ["转注时间", "转注日期", "注汽日期", "注汽时间"], offsetDays: 30 },
    '正注': { aliases: ["开注时间", "开注日期"], offsetDays: 20 },
    '焖井': { aliases: ["停注时间", "停注日期"], offsetDays: 10 }
  };

  app.get("/api/production-forecast", async (req, res) => {
    try {
      const year = (typeof req.query.year === 'string' && req.query.year.trim()) || undefined;

      let whereSql = "WHERE current_round_transfer_time IS NOT NULL AND current_round_transfer_time != ''";
      const params: string[] = [];
      if (year) {
        whereSql += " AND batch_year = ?";
        params.push(year);
      }

      const measures = await localDb.all(`SELECT * FROM measure_tracking ${whereSql}`, params);

      const categories: Record<string, {
        label: string;
        wells: Array<{ jh: string; block: string; predictedStart: string; previousStart: string }>;
        aggregate: { dates: string[]; oil: number[]; tenDayOil: number[] };
        wellCount: number;
        minPredictedStart: string;
      }> = {
        '生产': { label: '生产井预测', wells: [], aggregate: { dates: [], oil: [], tenDayOil: [] }, wellCount: 0, minPredictedStart: '' },
        '转注': { label: '转注井预测（转注+30天）', wells: [], aggregate: { dates: [], oil: [], tenDayOil: [] }, wellCount: 0, minPredictedStart: '' },
        '正注': { label: '正注井预测（开注+20天）', wells: [], aggregate: { dates: [], oil: [], tenDayOil: [] }, wellCount: 0, minPredictedStart: '' },
        '焖井': { label: '焖井井预测（停注+10天）', wells: [], aggregate: { dates: [], oil: [], tenDayOil: [] }, wellCount: 0, minPredictedStart: '' }
      };

      for (const record of measures) {
        const status = record.current_status;
        if (!categories[status]) continue;

        const detail = JSON.parse(record.detail_json || "{}");
        let predictedStart = "";

        if (status === '生产') {
          predictedStart = record.current_round_transfer_time;
        } else {
          const cfg = PREDICT_TRANSFER_ALIASES[status];
          if (cfg) {
            const rawValue = getMeasureDetailValue(detail.currentRound || detail, cfg.aliases);
            if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
              const baseDate = normalizeMeasureDate(rawValue);
              if (baseDate) {
                predictedStart = shiftDateDays(baseDate, cfg.offsetDays);
              }
            }
          }
        }

        if (!predictedStart) continue;

        const previousStart = getMeasureDetailDate(detail.previousRound || detail, PREVIOUS_TRANSFER_TIME_ALIASES);
        if (!previousStart) continue;

        // Track earliest predicted start for date labels
        if (!categories[status].minPredictedStart || predictedStart < categories[status].minPredictedStart) {
          categories[status].minPredictedStart = predictedStart;
        }

        const previousEnd = shiftDateDays(previousStart, FORECAST_DAYS - 1);
        const prodRows = await getProductionRowsBetween(record.jh, previousStart, previousEnd);
        const oilSeries = buildDailyOilSeries(prodRows, previousStart, FORECAST_DAYS);

        categories[status].wells.push({
          jh: record.jh,
          block: record.block || "",
          predictedStart,
          previousStart
        });

        // Initialize aggregate arrays if needed
        if (categories[status].aggregate.oil.length === 0) {
          categories[status].aggregate.oil = Array(FORECAST_DAYS).fill(0);
        }

        for (let i = 0; i < FORECAST_DAYS; i++) {
          categories[status].aggregate.oil[i] += oilSeries[i]?.oil || 0;
        }
      }

      // Compute dates from minPredictedStart, well counts, and ten-day oil
      for (const key of Object.keys(categories)) {
        const cat = categories[key];
        cat.wellCount = cat.wells.length;
        if (cat.minPredictedStart && cat.wellCount > 0) {
          cat.aggregate.dates = Array.from({ length: FORECAST_DAYS }, (_, i) => shiftDateDays(cat.minPredictedStart, i));

          // 旬度 (10-day) average oil
          cat.aggregate.tenDayOil = [];
          for (let i = 0; i < FORECAST_DAYS; i++) {
            const start = Math.max(0, i - 9);
            let sum = 0;
            for (let j = start; j <= i; j++) sum += cat.aggregate.oil[j] || 0;
            cat.aggregate.tenDayOil.push(Number((sum / (i - start + 1)).toFixed(1)));
          }
        }
      }

      res.json({ success: true, data: categories });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "产量预测生成失败: " + err.message });
    }
  });

  // --- Inventory Forecast API ---
  app.post("/api/inventory-forecast", async (req, res) => {
    try {
      const { rows = [] } = req.body || {};
      if (!Array.isArray(rows) || rows.length < 3) {
        res.status(400).json({ success: false, message: "至少需要3个旬度盘库数据点" });
        return;
      }

      // Compute ten-day wellhead total oil for each uploaded date (旬度 oil from production)
      const tenDayWellhead: number[] = [];
      for (const row of rows) {
        const endDate = String(row.date || "").trim();
        const startDate = shiftDateDays(endDate, -9);
        const prod = await localDb.get(
          "SELECT COALESCE(SUM(oil), 0) as total FROM production WHERE rq BETWEEN ? AND ?",
          [startDate, endDate]
        );
        // Ten-day average daily oil
        tenDayWellhead.push(Number(((prod?.total || 0) / 10).toFixed(1)));
      }

      // Simple ratio: 盘库产量 / 井口日产油
      const inventories = rows.map((r: any) => Number(r.inventory || 0));
      const ratios = tenDayWellhead.map((v, i) => v > 0 ? inventories[i] / v : 0).filter(r => r > 0);
      const avgRatio = ratios.length > 0 ? ratios.reduce((s, r) => s + r, 0) / ratios.length : 1;

      // Linear regression: 盘库 = slope × 井口 + intercept
      const n = rows.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      for (let i = 0; i < n; i++) {
        sumX += tenDayWellhead[i];
        sumY += inventories[i];
        sumXY += tenDayWellhead[i] * inventories[i];
        sumXX += tenDayWellhead[i] * tenDayWellhead[i];
      }
      const denom = n * sumXX - sumX * sumX;
      const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : avgRatio;
      const intercept = denom !== 0 ? (sumY - slope * sumX) / n : 0;
      const ratio = Number.isFinite(slope) && slope > 0 ? slope : avgRatio;

      // Compute future wellhead oil trend: use last 3 ten-day periods' moving average
      const recentWellhead = tenDayWellhead.slice(-3);
      const avgWellhead = recentWellhead.reduce((s, v) => s + v, 0) / recentWellhead.length;

      // Get measure forecast contribution: use the forecast API's tenDayOil total
      const forecastTotal = tenDayWellhead.length > 0 ? 0 : 1; // placeholder

      // Predict next 6 ten-day periods (2 months, ~20 days apart for旬度)
      const lastDate = String(rows[rows.length - 1].date || "").trim();
      const predictions: Array<{ date: string; actual: number | null; predicted: number | null }> = [];

      for (const row of rows) {
        predictions.push({ date: String(row.date || "").trim(), actual: Number(row.inventory || 0), predicted: null });
      }

      for (let p = 1; p <= 6; p++) {
        const predDate = shiftDateDays(lastDate, p * 10);
        // Estimate future wellhead oil with slight decline trend
        const trend = tenDayWellhead.length >= 6
          ? (tenDayWellhead.slice(-3).reduce((s, v) => s + v, 0) / 3 - tenDayWellhead.slice(-6, -3).reduce((s, v) => s + v, 0) / 3) / 3
          : 0;
        const estWellhead = Math.max(0, avgWellhead + trend * p);
        const predInventory = Number((ratio * estWellhead + (Number.isFinite(intercept) ? intercept : 0)).toFixed(0));
        predictions.push({ date: predDate, actual: null, predicted: Math.max(0, predInventory) });
      }

      const dates = predictions.map(r => r.date);
      const actual = predictions.map(r => r.actual);
      const predicted = predictions.map(r => r.predicted);

      // R²
      const yMean = sumY / n;
      let ssRes = 0, ssTot = 0;
      for (let i = 0; i < n; i++) {
        const est = ratio * tenDayWellhead[i] + intercept;
        ssRes += Math.pow(inventories[i] - est, 2);
        ssTot += Math.pow(inventories[i] - yMean, 2);
      }
      const r2 = ssTot > 0 ? Number((1 - ssRes / ssTot).toFixed(3)) : 0;

      res.json({ success: true, data: { dates, actual, predicted, ratio: Number(ratio.toFixed(2)), r2 } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "盘库产量预测失败: " + err.message });
    }
  });

  // ___________________________ (SQLite ____________?
  app.post("/api/analysis/compare", async (req, res) => {
    const { rangeA, rangeB, stations } = req.body;

    try {
      if (!rangeA?.start || !rangeA?.end || !rangeB?.start || !rangeB?.end) {
        res.status(400).json({ success: false, message: "用户名或密码错误" });
        return;
      }

      const daysA = getInclusiveDayCount(rangeA.start, rangeA.end);
      const daysB = getInclusiveDayCount(rangeB.start, rangeB.end);
      if (daysA <= 0 || daysB <= 0) {
        res.status(400).json({ success: false, message: "用户名或密码错误" });
        return;
      }

      const data = await withTimingLog("/api/analysis/compare", async () => {
        const stationList = Array.isArray(stations) ? stations.filter((value: unknown) => typeof value === "string" && value.trim()) : [];
        const [baseRows, metaMap, historyMap] = await Promise.all([
          loadCompareBaseRows(rangeA, rangeB, stationList),
          loadCompareWellMeta(rangeA, rangeB, stationList),
          loadCompareRemarkHistory(rangeA, rangeB, stationList)
        ]);

        const rows: CompareResultRow[] = baseRows
          .map((row: any) => {
            const avgA = buildEmptyCompareMetrics();
            const avgB = buildEmptyCompareMetrics();
            const diff = buildEmptyCompareMetrics();

            for (const metric of COMPARE_METRIC_KEYS) {
              avgA[metric] = roundCompareValue(Number(row[`sumA_${metric}`] || 0) / daysA);
              avgB[metric] = roundCompareValue(Number(row[`sumB_${metric}`] || 0) / daysB);
              diff[metric] = roundCompareValue(avgB[metric] - avgA[metric]);
            }

            const countA = Number(row.countA || 0);
            const countB = Number(row.countB || 0);
            const history = historyMap.get(row.jh);
            const meta = metaMap.get(row.jh) || { station: "", block: "" };

            let note = "";
            if (countA > 0 && countB === 0) {
              note = "__________________";
            } else if (countA === 0 && countB > 0) {
              note = "__________________";
            }

            let reason = "";
            if (hasAnyRemarkKeyword(history, ["______", "___"])) {
              reason = "______";
            } else if (diff.oil > 0) {
              reason = buildIncreaseReason(history, rangeB, diff.water_cut);
            } else if (diff.oil < 0) {
              reason = buildDecreaseReason(history, rangeB, diff.water_cut);
            }

            const finalNote = appendNoteReason(note, reason);
            const openWellType = note.includes("__________________") ? classifyOpenWell(history, finalNote) : null;
            const closedWellType = note.includes("__________________") ? classifyClosedWell(history, finalNote) : null;
            const incrementType = diff.oil > 0 ? classifyIncrement(reason) : null;
            const decrementType = diff.oil < 0 ? classifyDecrement(reason) : null;

            return {
              jh: row.jh,
              station: meta.station,
              block: meta.block,
              avgA,
              avgB,
              diff,
              note: finalNote,
              openWellType,
              closedWellType,
              incrementType,
              decrementType
            };
          })
          .filter((row) => row.avgA.liquid > 0 || row.avgB.liquid > 0 || row.note);

        return {
          rows,
          summary: buildCompareSummary(rows),
          largeChange: buildLargeChangeData(rows),
          hasRangeAData: baseRows.some((row) => Number(row.countA || 0) > 0),
          hasRangeBData: baseRows.some((row) => Number(row.countB || 0) > 0)
        };
      });

      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  app.post('/api/measure-well-selection/recalculate', async (_req, res) => {
    try { res.json({ success: true, data: await rebuildMeasureWellSelection() }); }
    catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get('/api/measure-well-selection/wells', async (req, res) => {
    try {
      await ensureMeasureWellSelectionScores();
      const data = await listSelectionWells(localDb, {
        block: typeof req.query.block === 'string' ? req.query.block : undefined,
        station: typeof req.query.station === 'string' ? req.query.station : undefined,
        grade: typeof req.query.grade === 'string' ? req.query.grade as any : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get('/api/measure-well-selection/wells/:wellName', async (req, res) => {
    try {
      await ensureMeasureWellSelectionScores();
      const detail = await getSelectionWellDetail(localDb, req.params.wellName);
      if (!detail) { res.status(404).json({ success: false, message: 'well not found' }); return; }
      const curves = await Promise.all(detail.cycles.map(async (cycle) => {
        const rows = await localDb.all('SELECT rq AS date, oil FROM production WHERE jh = ? AND rq BETWEEN ? AND ? ORDER BY rq ASC', [
          cycle.wellName, shiftDateDays(cycle.transferDate, -30), shiftDateDays(cycle.transferDate, 180),
        ]);
        return { round: cycle.round, transferDate: cycle.transferDate, oilSeeingDay: cycle.oilSeeingDays, points: alignOilCurve(cycle.transferDate, rows) };
      }));
      res.json({ success: true, data: { ...detail, curves } });
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });
  // --- API Routes ---

  // ___________________________________
  app.get("/api/chart/overall", async (req, res) => {
    try {
      const rows = await withTimingLog("/api/chart/overall", () => getOverallChartRows());
      res.json({ success: true, data: buildChartData(rows) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  // _______________________________________?
  app.get("/api/wells", async (req, res) => {
    try {
      const rows = await withTimingLog("/api/wells", () => getWellsCacheData());
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  // ___________________________
  app.get("/api/blocks", async (req, res) => {
    try {
      const rows = await withTimingLog("/api/blocks", () => getBlocksCacheData());
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  // ______________________________?
  app.get("/api/stations", async (req, res) => {
    try {
      const rows = await withTimingLog("/api/stations", () => getStationsCacheData());
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  // _____________________________________________
  app.get("/api/chart/block", async (req, res) => {
    const rawBlocks = Array.isArray(req.query.block)
      ? req.query.block
      : req.query.block
        ? [req.query.block]
        : [];
    const selectedBlocks = normalizeSelectedChartBlocks(
      rawBlocks
        .map((block) => String(block || "").trim())
        .filter(Boolean)
    );

    if (selectedBlocks.length === 0) {
      res.status(400).json({ success: false, message: "请选择区块" });
      return;
    }

    try {
      const label = `/api/chart/block?block=${selectedBlocks.join(",")}`;
      const result = await withTimingLog(label, () => getBlockChartRows(selectedBlocks));
      res.json({ success: true, data: buildChartData(result.rows), dataSource: result.source });
    } catch (err: any) {
      res.status(500).json({ success: false, message: "数据获取失败: " + err.message });
    }
  });

  // _____________________________________________ (_________ SQLite ___________________________)
  app.get("/api/chart/well", async (req, res) => {
    const { jh, start, end } = req.query;
    const well = String(jh || "").trim();
    const label = `/api/chart/well?jh=${well}`;

    if (!well) {
      res.status(400).json({ success: false, message: "请选择区块" });
      return;
    }

    try {
      const startDate = String(start || "2025-01-01");
      const endDate = String(end || new Date().toISOString().split("T")[0]);
      const result = await withTimingLog(label, () => getWellChartData(well, startDate, endDate));

      res.json({ success: true, data: result.data, dataSource: result.source });
    } catch (err: any) {
      console.error("Well chart query failed:", err.message);
      res.status(500).json({ success: false, message: "数据获取失败" });
    }
  });

  // ________________________________________________________________________
  app.get("/api/analysis/issues", async (req, res) => {
    try {
      const data = await withTimingLog("/api/analysis/issues", () => getIssueAnalysisData());
      res.json({ success: true, data });
    } catch (err: any) {
      console.error("Issue analysis query failed:", err.message);
      res.status(500).json({ success: false, message: "数据获取失败" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    void ensureStartupWarmTasks().catch((err: any) => {
      console.error("预热任务失败:", err.message);
    });
    setTimeout(() => {
      void ensureStartupFormulaRepairTask().catch((err: any) => {
        console.error("公式修复失败:", err.message);
      });
    }, 300);
    setTimeout(() => {
      void ensureStartupSyncTask().catch((err: any) => {
        console.error("同步任务失败:", err.message);
      });
    }, 1500);
  });
}

startServer();
