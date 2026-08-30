const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;

export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? '');
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function csvCell(value: unknown): string {
  return `"${spreadsheetSafeText(value).replace(/"/g, '""')}"`;
}

export function buildCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
