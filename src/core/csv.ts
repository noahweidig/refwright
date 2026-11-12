export function csvCell(v: string): string {
  // leading = + - @ can run as formulas in spreadsheets
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: string[][]): string {
  return (
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
  );
}
