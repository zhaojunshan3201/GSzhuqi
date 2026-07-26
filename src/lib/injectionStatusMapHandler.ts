import { buildInjectionStatusMapResponse, type InjectionMapWell } from './injectionStatusMap.ts';

type InjectionStatusMapBuildResult = { wells: InjectionMapWell[] };
type InjectionStatusMapRequest = { query: unknown };
type InjectionStatusMapResponseWriter = {
  json(payload: unknown): unknown;
  status(statusCode: number): { json(payload: unknown): unknown };
};

type InjectionStatusMapHandlerOptions = {
  buildMap(options: { today: string }): Promise<InjectionStatusMapBuildResult>;
  today(): string;
};

const INJECTION_STATUS_MAP_ERROR_MESSAGE = '注采状态地图数据加载失败';

export function createInjectionStatusMapHandler({
  buildMap,
  today,
}: InjectionStatusMapHandlerOptions) {
  return async function injectionStatusMapHandler(
    req: InjectionStatusMapRequest,
    res: InjectionStatusMapResponseWriter,
  ): Promise<void> {
    try {
      const result = await buildMap({ today: today() });
      res.json({ success: true, data: buildInjectionStatusMapResponse(result, req.query) });
    } catch (caughtError: unknown) {
      const error = caughtError && typeof caughtError === 'object' ? caughtError as { message?: string } : undefined;
      res.status(500).json({ success: false, message: error?.message || INJECTION_STATUS_MAP_ERROR_MESSAGE });
    }
  };
}
