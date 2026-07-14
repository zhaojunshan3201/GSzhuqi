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

export function fitWellMapToViewport(imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number) {
  const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return { width: Math.round(imageWidth * scale), height: Math.round(imageHeight * scale) };
}

export function fitWellMapToWidth(imageWidth: number, imageHeight: number, viewportWidth: number) {
  const scale = viewportWidth / imageWidth;
  return { width: Math.round(imageWidth * scale), height: Math.round(imageHeight * scale) };
}

export function getMarkerAnchorStyle(xPercent: number, yPercent: number) {
  return { left: `${xPercent}%`, top: `${yPercent}%`, transform: 'translate(-50%, -50%)' };
}
