export function getExternalTransferStationSummary(selectedStations: Set<string>) {
  return `已选 ${selectedStations.size} 个：${Array.from(selectedStations).join('、')}`;
}

export function selectAllExternalTransferStations(stations: string[]) {
  return new Set(stations);
}

export function toggleExternalTransferStation(selectedStations: Set<string>, station: string) {
  const next = new Set(selectedStations);
  if (next.has(station)) next.delete(station);
  else next.add(station);
  return next;
}
