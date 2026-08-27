// nowStr_ / todayStr_ (Sheets.gs) の移植。Asia/Tokyo基準で 'yyyy-MM-dd HH:mm:ss' / 'yyyy-MM-dd' を返す。

const PARTS_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function tokyoParts(date: Date): Record<string, string> {
  const parts = PARTS_FORMATTER.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

export function nowStr(date: Date = new Date()): string {
  const p = tokyoParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function todayStr(date: Date = new Date()): string {
  const p = tokyoParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
