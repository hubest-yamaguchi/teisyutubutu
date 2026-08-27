// gas-app-liff/Drive.gs, gas-app/Drive.gs の移植。
// 命名規則: {EmployeeId}/{連番}_{書類名}.{拡張子} 。再提出は同じキーへの上書き(R2のputは上書きで済むため、
// Driveのように「同名ファイルを探して削除してから保存」という手順は不要)。

function base64ToBytes(base64Data: string): Uint8Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function employeeFileKey(employeeId: string, seq: number, docLabel: string, fileExt: string): string {
  const safeLabel = docLabel.replace(/[\\/]/g, '_');
  const ext = fileExt ? `.${fileExt}` : '';
  return `${employeeId}/${seq}_${safeLabel}${ext}`;
}

export async function getEmployeeFile(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function saveEmployeeFile(
  bucket: R2Bucket,
  employeeId: string,
  docLabel: string,
  seq: number,
  base64Data: string,
  mimeType: string,
  fileExt: string
): Promise<string> {
  const key = employeeFileKey(employeeId, seq, docLabel, fileExt);
  const bytes = base64ToBytes(base64Data);
  await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  return key;
}
