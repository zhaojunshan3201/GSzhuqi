import { WellTemperatureParseError } from './wellTemperature.ts';

export function isWellTemperatureClientError(error: unknown): boolean {
  return error instanceof WellTemperatureParseError;
}
