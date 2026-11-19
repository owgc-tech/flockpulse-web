export function toLocalDateString(isoDatetime: string): string {
  const d = new Date(isoDatetime);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function filterByLocalDate<T extends { start_datetime: string }>(items: T[], dateStr: string): T[] {
  if (!dateStr) return items;
  return items.filter((item) => toLocalDateString(item.start_datetime) === dateStr);
}
