export interface WellMapMarker {
  wellNo: string;
  block: string;
  xPercent: number;
  yPercent: number;
}

export interface WellMapCategory {
  id: number;
  name: string;
  color: string;
  priority: number;
  visible: boolean;
}

export interface WellMapCategoryWell {
  categoryId: number;
  wellNo: string;
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

export function resolveMarkerColor(wellNo: string, categories: WellMapCategory[], relations: WellMapCategoryWell[]) {
  const categoryIds = new Set(relations.filter((relation) => relation.wellNo === wellNo).map((relation) => relation.categoryId));
  return categories
    .filter((category) => category.visible && categoryIds.has(category.id))
    .sort((left, right) => left.priority - right.priority)[0]?.color || '#dc2626';
}

export function resolveInjectionLifecycleColor(status: 'injecting' | 'soaking' | 'pendingTransfer' | 'producing' | 'needsData') {
  return {
    injecting: '#2563eb',
    soaking: '#f59e0b',
    pendingTransfer: '#8b5cf6',
    producing: '#16a34a',
    needsData: '#94a3b8',
  }[status];
}
