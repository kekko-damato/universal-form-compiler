import Papa from 'papaparse';

export function parseCsvToText(raw: string): string {
  const result = Papa.parse<string[]>(raw.trim(), {
    skipEmptyLines: true,
  });
  if (result.errors.length) {
    throw new Error(
      `CSV parse error: ${result.errors.map((e) => e.message).join('; ')}`,
    );
  }
  const rows = result.data;
  if (rows.length === 0) return '';

  // Assume first row is header; subsequent rows are key/value pairs
  // where first column is the key and everything after is joined.
  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const [key, ...rest] = row;
    if (!key) continue;
    const value = rest.join(', ').trim();
    lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}
