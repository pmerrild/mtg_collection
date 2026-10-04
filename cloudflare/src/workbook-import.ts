import {
  findQuantityReductions,
  mapInputSheet,
  workbookFingerprint,
  type FoilMode,
  type ImportIssue,
  type ImportedHolding,
  type WorkbookSnapshot,
} from './importer.ts';
import { downloadPinnedWorkbook, OneDriveRequestError, type OneDriveEnv } from './onedrive.ts';
import { parseInputWorkbook } from './xlsx.ts';

interface ImportRecord {
  id: number;
  fingerprint: string;
  status: string;
  payload: string;
}

interface StoredHolding {
  printing_key: string;
  finish: string;
  name: string;
  quantity: number;
}

interface ImportPayload extends WorkbookSnapshot {
  fingerprint: string;
  source: string;
  drive_id: string;
  item_id: string;
  etag: string;
  reductions: ReturnType<typeof findQuantityReductions>;
}

function jsonSetting<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

async function setting<T>(env: OneDriveEnv, key: string, fallback: T): Promise<T> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return jsonSetting(row?.value, fallback);
}

function recordPayload(record: ImportRecord): ImportPayload {
  try {
    return JSON.parse(record.payload) as ImportPayload;
  } catch {
    throw new OneDriveRequestError('The saved import preview is invalid. Scan the workbook again.', 500);
  }
}

function summarize(payload: ImportPayload, id: number, applied = false) {
  return {
    id,
    unchanged: false,
    applied,
    pending_review: !applied,
    needs_reduction_review: payload.reductions.length > 0,
    rows: payload.rows,
    copies: payload.copies,
    issue_count: payload.issues.length,
    issue_samples: payload.issues.slice(0, 50).map(({ source_row, name, message }) => ({ source_row, name, message })),
    reductions: payload.reductions,
  };
}

export async function previewPinnedWorkbookImport(env: OneDriveEnv): Promise<Record<string, unknown>> {
  const download = await downloadPinnedWorkbook(env);
  const foilMode = await setting<FoilMode>(env, 'foil_mode', 'total');
  const parsed = parseInputWorkbook(download.bytes);
  const snapshot = mapInputSheet(parsed, foilMode);
  const fingerprint = await workbookFingerprint(download.bytes, foilMode);
  const previous = await env.DB.prepare(`SELECT id, fingerprint FROM imports WHERE status = 'applied'
    ORDER BY id DESC LIMIT 1`).first<{ id: number; fingerprint: string }>();
  if (previous?.fingerprint === fingerprint) {
    return { id: previous.id, unchanged: true, applied: true, rows: snapshot.rows, copies: snapshot.copies, issue_count: snapshot.issues.length, issue_samples: [] , reductions: [] };
  }

  const old = await env.DB.prepare(`SELECT printing_key, finish, name, SUM(quantity) AS quantity
    FROM holdings GROUP BY printing_key, finish, lower(name)`).all<StoredHolding>();
  const reductions = findQuantityReductions(old.results, snapshot.holdings);
  const payload: ImportPayload = {
    ...snapshot,
    fingerprint,
    source: `OneDrive/${download.workbook.path}`,
    drive_id: download.workbook.drive_id,
    item_id: download.workbook.item_id,
    etag: download.etag,
    reductions,
  };
  const encodedPayload = JSON.stringify(payload);
  if (new TextEncoder().encode(encodedPayload).length > 1_500_000) {
    throw new OneDriveRequestError('The parsed workbook is too large to stage safely in D1.', 413);
  }

  const existing = await env.DB.prepare(`SELECT id FROM imports WHERE status = 'pending' AND fingerprint = ?
    ORDER BY id DESC LIMIT 1`).bind(fingerprint).first<{ id: number }>();
  let importId = existing?.id;
  if (!importId) {
    await env.DB.prepare(`INSERT INTO imports (fingerprint, created_at, source, status, payload)
      VALUES (?, ?, ?, 'pending', ?)`)
      .bind(fingerprint, new Date().toISOString(), payload.source, encodedPayload).run();
    const inserted = await env.DB.prepare(`SELECT id FROM imports WHERE status = 'pending' AND fingerprint = ?
      ORDER BY id DESC LIMIT 1`).bind(fingerprint).first<{ id: number }>();
    if (!inserted) throw new OneDriveRequestError('The import preview could not be saved.', 503);
    importId = inserted.id;
  }

  return summarize(payload, importId);
}

export async function applyStagedWorkbookImport(env: OneDriveEnv, importId: number): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(importId) || importId < 1) throw new OneDriveRequestError('Import not found.', 404);
  const record = await env.DB.prepare('SELECT id, fingerprint, status, payload FROM imports WHERE id = ?')
    .bind(importId).first<ImportRecord>();
  if (!record) throw new OneDriveRequestError('Import not found.', 404);
  if (record.status !== 'pending') throw new OneDriveRequestError('This import preview is no longer pending.', 409);
  const latest = await env.DB.prepare(`SELECT id FROM imports WHERE status = 'pending' ORDER BY id DESC LIMIT 1`)
    .first<{ id: number }>();
  if (latest && latest.id !== importId) throw new OneDriveRequestError('A newer workbook preview exists. Review it first.', 409);

  const payload = recordPayload(record);
  const download = await downloadPinnedWorkbook(env);
  if (download.workbook.drive_id !== payload.drive_id || download.workbook.item_id !== payload.item_id) {
    throw new OneDriveRequestError('The pinned workbook changed since this preview. Scan and review again.', 409);
  }
  if (download.etag !== payload.etag) {
    throw new OneDriveRequestError('The workbook changed since this preview. Scan and review again.', 409);
  }
  const foilMode = await setting<FoilMode>(env, 'foil_mode', 'total');
  const currentFingerprint = await workbookFingerprint(download.bytes, foilMode);
  if (currentFingerprint !== record.fingerprint) {
    throw new OneDriveRequestError('The workbook changed since this preview. Scan and review again.', 409);
  }

  const statements = [
    env.DB.prepare('DELETE FROM holdings'),
    env.DB.prepare('DELETE FROM issues'),
    env.DB.prepare(`INSERT INTO holdings
      (source_row, name, card_type, color, rarity, set_code, collector_number, printing_key, quantity, finish, notes, deck_label)
      SELECT json_extract(value, '$.source_row'), json_extract(value, '$.name'), json_extract(value, '$.card_type'),
        json_extract(value, '$.color'), json_extract(value, '$.rarity'), json_extract(value, '$.set_code'),
        json_extract(value, '$.collector_number'), json_extract(value, '$.printing_key'), json_extract(value, '$.quantity'),
        json_extract(value, '$.finish'), json_extract(value, '$.notes'), json_extract(value, '$.deck_label')
      FROM json_each(?)`).bind(JSON.stringify(payload.holdings)),
    env.DB.prepare(`INSERT OR IGNORE INTO matches (printing_key, status)
      SELECT DISTINCT json_extract(value, '$.printing_key'), 'unresolved' FROM json_each(?)`)
      .bind(JSON.stringify(payload.holdings)),
    env.DB.prepare(`INSERT INTO issues (source_row, name, message, raw)
      SELECT json_extract(value, '$.source_row'), json_extract(value, '$.name'), json_extract(value, '$.message'),
        json_extract(value, '$.raw') FROM json_each(?)`).bind(JSON.stringify(payload.issues)),
  ];

  const seededLabels = new Set(await setting<string[]>(env, 'seeded_deck_labels', []));
  const seededDecks = await env.DB.prepare('SELECT source_label FROM decks WHERE source_label IS NOT NULL').all<{ source_label: string }>();
  const existingLabels = new Set(seededDecks.results.map((deck) => deck.source_label));
  const deckCards = new Map<string, Map<string, number>>();
  for (const holding of payload.holdings) {
    if (!holding.deck_label) continue;
    const cards = deckCards.get(holding.deck_label) || new Map<string, number>();
    cards.set(holding.name, (cards.get(holding.name) || 0) + holding.quantity);
    deckCards.set(holding.deck_label, cards);
  }
  for (const [label, cards] of deckCards) {
    if (existingLabels.has(label) || seededLabels.has(label)) continue;
    statements.push(env.DB.prepare(`INSERT INTO decks (name, format, source_label, seeded, updated_at)
      VALUES (?, ?, ?, 1, ?)`)
      .bind(label, label.toLowerCase().includes('commander') ? 'commander' : 'casual60', label, new Date().toISOString()));
    for (const [name, quantity] of cards) {
      statements.push(env.DB.prepare(`INSERT INTO entries (deck_id, name, quantity)
        SELECT id, ?, ? FROM decks WHERE source_label = ?`)
        .bind(name, quantity, label));
    }
    seededLabels.add(label);
  }

  statements.push(
    env.DB.prepare(`UPDATE imports SET status = 'superseded' WHERE status = 'pending' AND id <> ?`).bind(importId),
    env.DB.prepare(`UPDATE imports SET status = 'applied' WHERE id = ?`).bind(importId),
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('workbook_path', JSON.stringify(payload.source)),
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('foil_mode', JSON.stringify(payload.foil_mode)),
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('last_import_error', JSON.stringify('')),
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('seeded_deck_labels', JSON.stringify([...seededLabels].sort())),
  );

  try {
    await env.DB.batch(statements);
  } catch {
    throw new OneDriveRequestError('The workbook import could not be committed; the previous collection was preserved.', 503);
  }
  return summarize(payload, importId, true);
}

export async function dismissStagedWorkbookImport(env: OneDriveEnv, importId: number): Promise<{ dismissed: boolean }> {
  if (!Number.isSafeInteger(importId) || importId < 1) throw new OneDriveRequestError('Import not found.', 404);
  await env.DB.prepare(`UPDATE imports SET status = 'dismissed' WHERE id = ? AND status = 'pending'`)
    .bind(importId).run();
  return { dismissed: true };
}