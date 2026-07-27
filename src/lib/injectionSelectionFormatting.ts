export type SelectionSourceType = 'stage' | 'daily';

type SelectionScorePart = {
  score: number;
  maxScore: number;
};

export type SelectionScoreBreakdown = {
  oilSteamRatio: SelectionScorePart;
  stageOil: SelectionScorePart;
  stability: SelectionScorePart;
  dailyCompleteness: SelectionScorePart;
};

export function selectionSourceLabel(source: SelectionSourceType): string {
  return source === 'stage' ? '阶段产油' : '注汽日数据';
}

export function formatSelectionImportError(message: string): string {
  const legacyError = message.match(/^\?\s*(\d+)\s*\?\?(.*)$/);
  return legacyError
    ? `第 ${legacyError[1]} 行：${legacyError[2]}`
    : message;
}

export function formatSelectionScoreBreakdown(parts: SelectionScoreBreakdown): string {
  return [
    `油汽比 ${parts.oilSteamRatio.score}/${parts.oilSteamRatio.maxScore}`,
    `阶段产油 ${parts.stageOil.score}/${parts.stageOil.maxScore}`,
    `稳定性 ${parts.stability.score}/${parts.stability.maxScore}`,
    `日数据完整性 ${parts.dailyCompleteness.score}/${parts.dailyCompleteness.maxScore}`,
  ].join('；');
}
