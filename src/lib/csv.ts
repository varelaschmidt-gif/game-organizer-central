export function toCsv(rows: Record<string, unknown>[], headers: string[]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("|") : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  const sep = (text.split("\n")[0] ?? "").includes(";") && !(text.split("\n")[0] ?? "").includes(",") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  const [h, ...rest] = rows;
  if (!h) return [];
  const headers = h.map((x) => x.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(headers.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function download(name: string, content: string) {
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
