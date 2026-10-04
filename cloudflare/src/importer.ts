import type { ParsedInputSheet } from './xlsx.ts';

export type FoilMode = 'total' | 'additional' | 'flag';

export interface ImportedHolding {
  source_row: number;
  name: string;
  card_type: string;
  color: string;
  rarity: string;
  set_code: string;
  collector_number: string;
  printing_key: string;
  quantity: number;
  finish: 'nonfoil' | 'foil';
  notes: string;
  deck_label: string;
}

export interface ImportIssue {
  source_row: number;
  name: string;
  message: string;
  raw: Record<string, unknown>;
}

export interface WorkbookSnapshot {
  headers: string[];
  rows: number;
  holdings: ImportedHolding[];
  issues: ImportIssue[];
  copies: number;
  foil_mode: FoilMode;
}

export interface ExistingHoldingCount {
  printing_key: string;
  finish: string;
  name: string;
  quantity: number;
}

function stringValue(value: unknown): string {
  return value ? String(value) : '';
}

function integer(value: unknown, field: string, blankZero = false): number {
  if (value === null || value === undefined || value === '') {
    if (blankZero) return 0;
    throw new Error(`${field} is blank. Enter a quantity in Excel.`);
  }
  if (typeof value === 'boolean') throw new Error(`${field} must be a whole number.`);
  const number = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
    throw new Error(`${field} must be a nonnegative whole number.`);
  }
  return number;
}

function collector(value: string): string {
  return /^\d+$/.test(value) ? String(Number(value)) : value;
}

function printingKey(setCode: string, number: string): string {
  return `${setCode.trim().toLowerCase()}:${collector(number)}`;
}

export function mapInputSheet(sheet: ParsedInputSheet, foilMode: FoilMode): WorkbookSnapshot {
  if (!['total', 'additional', 'flag'].includes(foilMode)) {
    throw new Error('Choose the meaning of Count and Foil before importing.');
  }

  const holdings: ImportedHolding[] = [];
  const issues: ImportIssue[] = [];
  for (const { source_row, values: row } of sheet.rows) {
    const name = stringValue(row.Name).trim();
    const messages: string[] = [];
    let quantities: { finish: 'nonfoil' | 'foil'; quantity: number }[] = [];
    try {
      const count = integer(row.Count, 'Count');
      const foil = integer(row.Foil, 'Foil', true);
      if (foilMode === 'total') {
        if (foil > count) throw new Error('Foil count exceeds Count. Check this row in Excel.');
        quantities = [{ finish: 'nonfoil', quantity: count - foil }, { finish: 'foil', quantity: foil }];
      } else if (foilMode === 'additional') {
        quantities = [{ finish: 'nonfoil', quantity: count }, { finish: 'foil', quantity: foil }];
      } else {
        if (foil !== 0 && foil !== 1) throw new Error('Foil flags must be blank, 0, or 1.');
        quantities = [{ finish: foil ? 'foil' : 'nonfoil', quantity: count }];
      }
    } catch (error) {
      messages.push((error as Error).message);
    }

    const setValue = row.Set;
    const setCode = stringValue(setValue).trim().toLowerCase();
    const number = row['Set#'] === null || row['Set#'] === undefined ? '' : String(row['Set#']).trim();
    if (!name) {
      messages.push('Name is blank.');
      quantities = [];
    }
    if (typeof setValue !== 'string' || !/^[a-z0-9]{2,8}$/.test(setCode)) {
      messages.push('Set must be a confirmed Scryfall set code; no edition was guessed.');
    }
    if (!number) messages.push('Collector number is blank.');
    if (messages.length) issues.push({ source_row, name: name || '(unnamed)', message: messages.join(' '), raw: row });

    for (const { finish, quantity } of quantities) {
      if (!quantity) continue;
      holdings.push({
        source_row,
        name,
        card_type: stringValue(row.Type),
        color: stringValue(row.Color),
        rarity: stringValue(row.Rarity),
        set_code: setCode,
        collector_number: number,
        printing_key: printingKey(setCode, number),
        quantity,
        finish,
        notes: stringValue(row.Notes),
        deck_label: stringValue(row.Deck).trim(),
      });
    }
  }

  return {
    headers: sheet.headers,
    rows: sheet.rows.length,
    holdings,
    issues,
    copies: holdings.reduce((sum, holding) => sum + holding.quantity, 0),
    foil_mode: foilMode,
  };
}

export async function workbookFingerprint(bytes: Uint8Array, foilMode: FoilMode): Promise<string> {
  const modeBytes = new TextEncoder().encode(foilMode);
  const input = new Uint8Array(bytes.length + modeBytes.length);
  input.set(bytes);
  input.set(modeBytes, bytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotKey(printingKey: string, finish: string, name: string): string {
  return `${printingKey}\u0000${finish}\u0000${name.toLocaleLowerCase()}`;
}

export function findQuantityReductions(
  oldRows: ExistingHoldingCount[],
  newRows: ImportedHolding[],
): { name: string; printing_key: string; finish: string; before: number; after: number }[] {
  const oldCounts = new Map<string, { name: string; printing_key: string; finish: string; quantity: number }>();
  const newCounts = new Map<string, number>();
  for (const row of oldRows) {
    const key = snapshotKey(row.printing_key, row.finish, row.name);
    const current = oldCounts.get(key);
    oldCounts.set(key, { ...row, quantity: (current?.quantity || 0) + row.quantity });
  }
  for (const row of newRows) {
    const key = snapshotKey(row.printing_key, row.finish, row.name);
    newCounts.set(key, (newCounts.get(key) || 0) + row.quantity);
  }
  return [...oldCounts.entries()].flatMap(([key, before]) => {
    const after = newCounts.get(key) || 0;
    return after < before.quantity
      ? [{ name: before.name, printing_key: before.printing_key, finish: before.finish, before: before.quantity, after }]
      : [];
  });
}