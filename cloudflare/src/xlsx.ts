import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

type XmlNode = Record<string, unknown>;

export interface WorkbookInputRow {
  source_row: number;
  values: Record<string, unknown>;
}

export interface ParsedInputSheet {
  headers: string[];
  rows: WorkbookInputRow[];
}

const maximumWorkbookBytes = 32 * 1024 * 1024;
const maximumRows = 100_000;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
});

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function object(value: unknown): XmlNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as XmlNode : {};
}

function attribute(node: unknown, name: string): string | undefined {
  const value = object(node)[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const record = value as XmlNode;
  let text = typeof record['#text'] === 'string' ? record['#text'] : '';
  for (const [key, child] of Object.entries(record)) {
    if (key !== '#text' && !key.startsWith('@_')) text += textContent(child);
  }
  return text;
}

function xmlFile(files: Record<string, Uint8Array>, path: string): XmlNode {
  const bytes = files[path];
  if (!bytes) throw new Error('The workbook is missing required Excel metadata.');
  try {
    return object(parser.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('The workbook contains invalid Excel metadata.');
  }
}

function relationshipPath(target: string): string {
  const segments: string[] = [];
  const source = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  for (const segment of source.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) throw new Error('The workbook contains an invalid sheet path.');
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const path = segments.join('/');
  if (!path.startsWith('xl/worksheets/')) throw new Error('The Input worksheet path is invalid.');
  return path;
}

function columnIndex(reference: string | undefined): number | null {
  const letters = reference?.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function cellValue(cellValue: unknown, sharedStrings: string[]): unknown {
  const cell = object(cellValue);
  const type = attribute(cell, 't');
  if (type === 'inlineStr') return textContent(cell.is);
  const raw = cell.v;
  if (raw === undefined) return null;
  const text = textContent(raw);
  if (type === 's') {
    const index = Number(text);
    return Number.isInteger(index) ? sharedStrings[index] ?? '' : '';
  }
  if (type === 'b') return text === '1';
  if (type === 'str' || type === 'e') return text;
  const numeric = Number(text);
  return Number.isFinite(numeric) && text.trim() !== '' ? numeric : text;
}

function rowValues(row: unknown, sharedStrings: string[]): unknown[] {
  const cells = array(object(row).c);
  const indexed = cells.flatMap((cell) => {
    const index = columnIndex(attribute(cell, 'r'));
    return index === null ? [] : [{ index, value: cellValue(cell, sharedStrings) }];
  });
  const values: unknown[] = [];
  for (const cell of indexed) values[cell.index] = cell.value;
  return values;
}

export function parseInputWorkbook(bytes: Uint8Array): ParsedInputSheet {
  if (!bytes.length || bytes.length > maximumWorkbookBytes) {
    throw new Error('The workbook must be a non-empty .xlsx file no larger than 32 MB.');
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('The workbook could not be opened as an .xlsx file.');
  }

  const workbook = xmlFile(files, 'xl/workbook.xml');
  const relationships = xmlFile(files, 'xl/_rels/workbook.xml.rels');
  const sheets = array(object(object(workbook.workbook).sheets).sheet);
  const inputSheet = sheets.find((sheet) => attribute(sheet, 'name') === 'Input');
  if (!inputSheet) throw new Error('The workbook has no Input worksheet.');
  const relationshipId = attribute(inputSheet, 'r:id');
  const relationship = array(object(relationships.Relationships).Relationship)
    .find((entry) => attribute(entry, 'Id') === relationshipId);
  const target = relationship && attribute(relationship, 'Target');
  if (!target || attribute(relationship, 'TargetMode') === 'External') {
    throw new Error('The Input worksheet relationship is invalid.');
  }

  const sheet = xmlFile(files, relationshipPath(target));
  const sharedStringsFile = files['xl/sharedStrings.xml'];
  const sharedStrings = sharedStringsFile
    ? array(object(object(parser.parse(new TextDecoder().decode(sharedStringsFile))).sst).si).map(textContent)
    : [];
  const rows = array(object(object(sheet.worksheet).sheetData).row);
  const numberedRows = rows.map((row, index) => ({
    row,
    source_row: Number(attribute(row, 'r')) || index + 1,
  }));
  if (numberedRows.some((row) => row.source_row > maximumRows)) {
    throw new Error('The Input sheet exceeds the 100,000-row limit.');
  }

  const headerRow = numberedRows.find((row) => row.source_row === 1);
  const headers = (headerRow ? rowValues(headerRow.row, sharedStrings) : [])
    .map((value) => String(value ?? '').trim());
  if (!headers.length) throw new Error('The Input worksheet is missing its header row.');
  if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) {
    throw new Error('Input contains duplicate column headings.');
  }
  const required = ['Name', 'Set', 'Set#', 'Count', 'Foil', 'Deck'];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`Input is missing columns: ${missing.sort().join(', ')}.`);

  const dataRows = numberedRows.filter((row) => row.source_row > 1).flatMap(({ row, source_row }) => {
    const cells = rowValues(row, sharedStrings);
    if (!cells.some((value) => value !== undefined && value !== null)) return [];
    const values: Record<string, unknown> = {};
    headers.forEach((header, index) => { if (header) values[header] = cells[index] ?? null; });
    return [{ source_row, values }];
  });
  return { headers, rows: dataRows };
}