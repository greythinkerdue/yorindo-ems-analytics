export type CsvColumn<T> = {
  key: string;
  label: string;
  value?: (row: T) => string | number | null | undefined;
};

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Export baris ke file CSV langsung di browser (tanpa endpoint backend).
 * BOM ditambahkan supaya Excel membaca UTF-8 dengan benar.
 */
export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  const header = columns.map((column) => escapeCsvValue(column.label)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((column) => {
          const raw = column.value
            ? column.value(row)
            : (row as Record<string, unknown>)[column.key];
          return escapeCsvValue(raw);
        })
        .join(","),
    )
    .join("\r\n");

  const csv = `\uFEFF${header}\r\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
