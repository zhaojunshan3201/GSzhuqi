export type InjectionLifecycleStatus = 'injecting' | 'soaking' | 'pendingTransfer' | 'producing' | 'needsData';

export type BlockStatusSummary = { block: string } & Record<InjectionLifecycleStatus, number>;

export type InjectionProductionCockpit = {
  generatedAt: string;
  dataFreshness: Array<{ source: 'production' | 'injectionTracking' | 'selection'; status: 'normal' | 'stale' | 'failed' | 'missing'; updatedAt: string | null; message: string }>;
  metrics: { producingWells: number; injectingWells: number; soakingWells: number; pendingTransferWells: number; dailyOil: number | null; cumulativeOilGain: number | null; oilSteamRatio: number | null };
  statusDistribution: Record<InjectionLifecycleStatus, number>;
  blockStatusSummary: BlockStatusSummary[];
  alerts: Array<{ id: string; type: 'needsData' | 'notEvaluated' | 'lowEfficiency' | 'soakingOverdue' | 'transferOverdue'; wellNo: string; block: string; message: string; target: 'measures' | 'oilWellMap' }>;
  mapWells: Array<{ wellNo: string; block: string; status: InjectionLifecycleStatus; evaluation: string | null }>;
};

type DatabaseLike = { all(sql: string, params?: unknown[]): Promise<any[]> };
type SyncStatusInput = { lastSyncStatus?: string };

const emptyDistribution = (): Record<InjectionLifecycleStatus, number> => ({ injecting: 0, soaking: 0, pendingTransfer: 0, producing: 0, needsData: 0 });

function getStatus(value: unknown): InjectionLifecycleStatus {
  switch (String(value || '').trim()) {
    case '正注': return 'injecting';
    case '焖井': return 'soaking';
    case '转注': return 'pendingTransfer';
    case '生产': return 'producing';
    default: return 'needsData';
  }
}

export async function buildInjectionProductionCockpit(db: DatabaseLike, options: { now: string; syncStatus?: SyncStatusInput }): Promise<InjectionProductionCockpit> {
  const rows = await db.all(`
    SELECT * FROM (
      SELECT mt.*, ROW_NUMBER() OVER (PARTITION BY jh ORDER BY current_round_transfer_time DESC, id DESC) AS row_number
      FROM measure_tracking mt WHERE TRIM(COALESCE(jh, '')) != ''
    ) WHERE row_number = 1 ORDER BY jh
  `);
  const statusDistribution = emptyDistribution();
  const blockStatusByName = new Map<string, BlockStatusSummary>();
  const alerts: InjectionProductionCockpit['alerts'] = [];
  let dailyOil = 0;
  let hasDailyOil = false;
  let cumulativeOilGain = 0;
  let hasCumulativeOilGain = false;
  const mapWells = rows.map((row) => {
    const status = getStatus(row.current_status);
    statusDistribution[status] += 1;
    const block = String(row.block ?? '').trim() || '未标注区块';
    const blockStatus = blockStatusByName.get(block) || { block, ...emptyDistribution() };
    blockStatus[status] += 1;
    blockStatusByName.set(block, blockStatus);
    const needsData = !row.current_status || !row.current_round_transfer_time ||
      (status === 'producing' && (row.current_oil == null || !row.evaluation));
    if (needsData) {
      alerts.push({ id: `needs-data:${row.jh}`, type: 'needsData', wellNo: row.jh, block: row.block || '', message: '注汽跟踪数据待补全', target: 'measures' });
    } else if (status === 'producing') {
      if (row.evaluation === 'D') alerts.push({ id: `low-efficiency:${row.jh}`, type: 'lowEfficiency', wellNo: row.jh, block: row.block || '', message: '注汽效果评价为 D 类', target: 'measures' });
      if (row.current_oil != null) { dailyOil += Number(row.current_oil); hasDailyOil = true; }
      if (row.cumulative_oil_gain != null) { cumulativeOilGain += Number(row.cumulative_oil_gain); hasCumulativeOilGain = true; }
    }
    const days = Math.floor((Date.parse(`${options.now}T00:00:00Z`) - Date.parse(`${row.current_round_transfer_time}T00:00:00Z`)) / 86400000);
    if (!needsData && status === 'soaking' && days > 30) alerts.push({ id: `soaking-overdue:${row.jh}`, type: 'soakingOverdue', wellNo: row.jh, block: row.block || '', message: '焖井超过 30 天', target: 'measures' });
    if (!needsData && status === 'pendingTransfer' && days > 7) alerts.push({ id: `transfer-overdue:${row.jh}`, type: 'transferOverdue', wellNo: row.jh, block: row.block || '', message: '待转抽超过 7 天', target: 'measures' });
    return { wellNo: row.jh, block: row.block || '', status, evaluation: row.evaluation || null };
  });
  const steamRows = await db.all(`SELECT SUM(actual_steam) AS steam, SUM(cycle_oil) AS oil FROM measure_well_cycles`);
  const steam = Number(steamRows[0]?.steam || 0);
  const cycleOil = Number(steamRows[0]?.oil || 0);
  const productionDate = (await db.all(`SELECT MAX(rq) AS updated_at FROM production`))[0]?.updated_at || null;
  const trackingDate = (await db.all(`SELECT MAX(current_round_transfer_time) AS updated_at FROM measure_tracking`))[0]?.updated_at || null;
  const selectionDate = (await db.all(`SELECT MAX(imported_at) AS updated_at FROM measure_well_imports`))[0]?.updated_at || null;
  const productionStatus = options.syncStatus?.lastSyncStatus === 'error' ? 'failed' : productionDate ? 'normal' : 'missing';
  return {
    generatedAt: options.now,
    dataFreshness: [
      { source: 'production', status: productionStatus, updatedAt: productionDate, message: productionStatus === 'failed' ? '生产数据同步失败' : '生产数据待导入' },
      { source: 'injectionTracking', status: trackingDate ? 'normal' : 'missing', updatedAt: trackingDate, message: trackingDate ? '注汽跟踪数据可用' : '注汽跟踪数据待导入' },
      { source: 'selection', status: selectionDate ? 'normal' : 'missing', updatedAt: selectionDate, message: selectionDate ? '选井数据可用' : '选井数据待导入' },
    ],
    metrics: { producingWells: statusDistribution.producing, injectingWells: statusDistribution.injecting, soakingWells: statusDistribution.soaking, pendingTransferWells: statusDistribution.pendingTransfer, dailyOil: hasDailyOil ? dailyOil : null, cumulativeOilGain: hasCumulativeOilGain ? cumulativeOilGain : null, oilSteamRatio: steam > 0 && cycleOil > 0 ? cycleOil / steam : null },
    statusDistribution,
    blockStatusSummary: [...blockStatusByName.values()].sort((left, right) => left.block.localeCompare(right.block, 'zh-CN')),
    alerts,
    mapWells,
  };
}
