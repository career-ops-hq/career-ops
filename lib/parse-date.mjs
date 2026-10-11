export function parseDate(dateStr) {
  const iso = String(dateStr || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return null;
  }

  const date = new Date(`${iso}T00:00:00Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    return null;
  }

  return date;
}
