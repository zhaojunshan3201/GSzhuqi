export function decodeUploadedFileName(fileName: string): string {
  const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
  return Buffer.from(decoded, 'utf8').toString('latin1') === fileName ? decoded : fileName;
}
