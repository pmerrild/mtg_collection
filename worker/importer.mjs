import * as XLSX from "xlsx";
import { printingKey } from "./domain.mjs";
export const MAX_BYTES = 4 * 1024 * 1024;
function validateZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0,
    entries = 0;
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (v.getUint32(i, true) !== 0x02014b50) continue;
    const size = v.getUint32(i + 24, true);
    total += size;
    entries++;
    if (total > 24 * 1024 * 1024 || entries > 2500)
      throw Error(
        "Workbook expands beyond the supported import size. Keep the complete Input inventory and remove unused worksheets or excess formatting. Do not split the inventory across uploads.",
      );
    i +=
      45 +
      v.getUint16(i + 28, true) +
      v.getUint16(i + 30, true) +
      v.getUint16(i + 32, true);
  }
  if (!entries) throw Error("Upload a valid .xlsx workbook.");
}
export async function parseWorkbook(buffer, source = "inventory.xlsx") {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > MAX_BYTES)
    throw Error("Workbook exceeds the 4 MB hosted import limit.");
  validateZip(bytes);
  let workbook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
      sheetRows: 20002,
    });
  } catch {
    throw Error(
      "Could not read this workbook. Upload an .xlsx file with an Input worksheet.",
    );
  }
  const sheet = workbook.Sheets.Input;
  if (!sheet) throw Error("The workbook has no Input worksheet.");
  const range = XLSX.utils.decode_range(
    sheet["!fullref"] || sheet["!ref"] || "A1",
  );
  if (range.e.r > 20000)
    throw Error("Input exceeds the 20,000-row hosted import limit.");
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });
  const headers = (rows[0] || []).map((x) => String(x || "").trim());
  const present = headers.filter(Boolean);
  if (new Set(present).size !== present.length)
    throw Error("Input contains duplicate column headings.");
  const required = ["Name", "Set", "Set#", "Count", "Foil", "Deck"];
  const missing = required.filter((x) => !headers.includes(x));
  if (missing.length)
    throw Error("Input is missing columns: " + missing.join(", "));
  const holdings = [],
    issues = [];
  let populated = 0;
  const integer = (value, field, blank = false) => {
    if (value === null || value === undefined || value === "") {
      if (blank) return 0;
      throw Error(`${field} is blank. Enter a quantity in Excel.`);
    }
    if (
      typeof value === "boolean" ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 0
    )
      throw Error(`${field} must be a nonnegative whole number.`);
    return Number(value);
  };
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.some((x) => x !== null && x !== "")) continue;
    populated++;
    const raw = Object.fromEntries(
      headers.map((h, j) => [h, cells[j] ?? null]),
    );
    const name = String(raw.Name || "").trim(),
      set = String(raw.Set ?? "")
        .trim()
        .toLowerCase(),
      number = String(raw["Set#"] ?? "").trim(),
      messages = [];
    let quantities = {};
    try {
      const count = integer(raw.Count, "Count"),
        foil = integer(raw.Foil, "Foil", true);
      if (foil > count)
        throw Error("Foil count exceeds Count. Check this row in Excel.");
      quantities = { nonfoil: count - foil, foil };
    } catch (e) {
      messages.push(e.message);
    }
    if (!name) {
      messages.push("Name is blank.");
      quantities = {};
    }
    if (typeof raw.Set !== "string" || !/^[a-z0-9]{2,8}$/.test(set))
      messages.push(
        "Set must be a confirmed Scryfall set code; no edition was guessed.",
      );
    if (!number) messages.push("Collector number is blank.");
    if (messages.length)
      issues.push({
        source_row: i + 1,
        name: name || "(unnamed)",
        message: messages.join(" "),
        raw,
      });
    for (const [finish, quantity] of Object.entries(quantities))
      if (quantity)
        holdings.push({
          source_row: i + 1,
          name,
          card_type: String(raw.Type || ""),
          color: String(raw.Color || ""),
          rarity: String(raw.Rarity || ""),
          set_code: set,
          collector_number: number,
          printing_key: printingKey(set, number),
          quantity,
          finish,
          notes: String(raw.Notes || ""),
          deck_label: String(raw.Deck || "").trim(),
        });
  }
  const hashInput = new Uint8Array(bytes.length + 5);
  hashInput.set(bytes);
  hashInput.set(new TextEncoder().encode("total"), bytes.length);
  const hash = await crypto.subtle.digest("SHA-256", hashInput);
  const fingerprint = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const result = {
    source: String(source)
      .replace(/[\/\\]/g, "_")
      .slice(0, 200),
    rows: populated,
    copies: holdings.reduce((a, h) => a + h.quantity, 0),
    foil_mode: "total",
    fingerprint,
    holdings,
    issues,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 1200000)
    throw Error(
      "This inventory exceeds the hosted snapshot size. Keep your complete workbook; do not split inventory across uploads because each snapshot replaces ownership. The previous inventory is retained.",
    );
  return result;
}
