export interface WellMapMarker {
  wellNo: string;
  block: string;
  xPercent: number;
  yPercent: number;
}

export function getVisibleProductionMarkers(block: string, producingWells: string[], markers: WellMapMarker[]) {
  const producing = new Set(producingWells);
  return markers.filter((marker) => marker.block === block && producing.has(marker.wellNo));
}
