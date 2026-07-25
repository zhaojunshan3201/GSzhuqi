export const MEASURE_IMPORT_FILE_TYPE_MESSAGE = "??? .xlsx ? .xls ??";

export function isMeasureImportWorkbookFile(fileName: string) {
  return /\.(xlsx|xls)$/i.test(fileName.trim());
}

export function isHtmlMeasureImportFile(buffer: Buffer) {
  const prefix = buffer.subarray(0, 1024).toString("utf8").trimStart();
  return /^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<table\b)/i.test(prefix);
}
