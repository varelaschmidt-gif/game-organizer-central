import { parseMoneyToCents } from "./finance";

export function requireMoneyCents(value: string): number {
  const cents = parseMoneyToCents(value);
  if (cents === null)
    throw new Error("Informe um valor monetário válido, com até duas casas decimais.");
  return cents;
}

// Reports must never silently stop at the API's default page size.
export async function readAllFinanceRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 500,
): Promise<{ data: T[]; error: null }> {
  if (!Number.isInteger(size) || size < 1) throw new Error("Tamanho de página inválido");
  const data: T[] = [];
  for (let offset = 0; ; offset += size) {
    const result = await page(offset, offset + size - 1);
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    data.push(...rows);
    if (rows.length < size) return { data, error: null };
  }
}

export function financialCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0] ?? {});
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    // Spreadsheet formula injection can originate in player names/descriptions.
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    keys.map(cell).join(";"),
    ...rows.map((row) => keys.map((key) => cell(row[key])).join(";")),
  ].join("\r\n");
}
