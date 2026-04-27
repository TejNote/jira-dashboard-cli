// lib/time.ts — KST 기준 ISO 시각/날짜 포맷 유틸

function kstParts(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

export function isoKST(d: Date = new Date()): string {
  const p = kstParts(d);
  // en-US "2-digit" hour returns "24" at midnight — 정상 범위로 교정
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}+09:00`;
}

export function dateKST(d: Date = new Date()): string {
  const p = kstParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
