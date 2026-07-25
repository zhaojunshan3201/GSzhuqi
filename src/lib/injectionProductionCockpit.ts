export type InjectionLifecycleStatus = 'injecting' | 'soaking' | 'pendingTransfer' | 'producing' | 'needsData';

export type InjectionProductionCockpit = {
  generatedAt: string;
  dataFreshness: Array<{ source: 'production' | 'injectionTracking' | 'selection'; status: 'normal' | 'stale' | 'failed' | 'missing'; updatedAt: string | null; message: string }>;
  metrics: { producingWells: number; injectingWells: number; soakingWells: number; pendingTransferWells: number; dailyOil: number | null; cumulativeOilGain: number | null; oilSteamRatio: number | null };
  statusDistribution: Record<InjectionLifecycleStatus, number>;
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
  const mapWells = rows.map((row) => {
    const status = getStatus(row.current_status);
    statusDistribution[status] += 1;
    return { wellNo: row.jh, block: row.block || '', status, evaluation: row.evaluation || null };
  });
  const productionStatus = options.syncStatus?.lastSyncStatus === 'error' ? 'failed' : 'missing';
  return {
    generatedAt: options.now,
    dataFreshness: [
      { source: 'production', status: productionStatus, updatedAt: null, message: productionStatus === 'failed' ? '生产数据同步失败' : '生产数据待导入' },
      { source: 'injectionTracking', status: rows.length ? 'normal' : 'missing', updatedAt: rows[0]?.current_round_transfer_time || null, message: rows.length ? '注汽跟踪数据可用' : '注汽跟踪数据待导入' },
      { source: 'selection', status: 'missing', updatedAt: null, message: '选井数据待导入' },
    ],
    metrics: { producingWells: statusDistribution.producing, injectingWells: statusDistribution.injecting, soakingWells: statusDistribution.soaking, pendingTransferWells: statusDistribution.pendingTransfer, dailyOil: null, cumulativeOilGain: null, oilSteamRatio: null },
    statusDistribution,
    alerts: [],
    mapWells,
  };
}
