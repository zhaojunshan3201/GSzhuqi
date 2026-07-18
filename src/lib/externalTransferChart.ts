export function getDateLabelInterval(pointCount: number): number {
  return Math.max(0, Math.ceil(pointCount / 12) - 1);
}
