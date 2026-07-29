export function normalizeProductionBlockGroup(block: string | null | undefined): string {
  const trimmed = block?.trim() ?? '';
  if (!trimmed) return '';

  const normalized = trimmed
    .replace(/\s+/gu, '')
    .replace(/（/gu, '(')
    .replace(/）/gu, ')');

  if (/^(?:246块L|高246$)/u.test(normalized)) return '高246';
  if (/^(?:3块L|高3$)/u.test(normalized)) return '高3';
  if (/^(?:3618块L|高3618$)/u.test(normalized)) return '高3618';
  if (/^(?:3624块|高3624$)/u.test(normalized)) return '高3624';
  if (normalized === '高21' || /^高21块?(?:\([南北]\)|[南北])$/u.test(normalized)) {
    return '高21';
  }

  return trimmed;
}

export function buildProductionBlockGroups(blocks: string[]): string[] {
  return [...new Set(blocks.map(normalizeProductionBlockGroup).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
}

export function expandProductionBlockGroups(
  selectedGroups: string[],
  rawBlocks: string[],
): string[] {
  const selected = new Set(
    selectedGroups.map(normalizeProductionBlockGroup).filter(Boolean),
  );

  return [
    ...new Set(
      rawBlocks
        .map((block) => block.trim())
        .filter((block) => block && selected.has(normalizeProductionBlockGroup(block))),
    ),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
