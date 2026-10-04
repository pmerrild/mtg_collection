import { getHostedCollection } from './collection.ts';
import { OneDriveRequestError, type OneDriveEnv } from './onedrive.ts';
import { hostedWishlist } from './decks.ts';

interface ExportEntry {
  name: string;
  quantity: number;
  printing_key?: string | null;
  nonfoil?: number;
  foil?: number;
  zone?: string;
  decks?: string[];
  notes?: string[];
  source_rows?: number[];
  value?: number | null;
  priced_copies?: number;
  fetched_at?: string | null;
}

function textExport(rows: ExportEntry[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.quantity > 0) counts.set(row.name, (counts.get(row.name) || 0) + row.quantity);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .map(([name, quantity]) => `${quantity} ${name}`).join('\n') + (counts.size ? '\n' : '');
}

function csvCell(value: unknown): string {
  let text = Array.isArray(value) ? value.map(String).join('; ') : value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvExport(rows: ExportEntry[]): string {
  const columns = ['name', 'quantity', 'printing_key', 'nonfoil', 'foil', 'zone', 'decks', 'notes', 'source_rows', 'value', 'priced_copies', 'fetched_at'] as const;
  return `\uFEFF${[columns.join(','), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(','))].join('\r\n')}`;
}

export async function exportHostedData(env: OneDriveEnv, params: URLSearchParams): Promise<Response> {
  const kind = params.get('kind') || 'collection';
  const format = params.get('format') || 'txt';
  const zone = params.get('zone') || 'all';
  let rows: ExportEntry[];
  let filename: string;

  if (kind === 'collection') {
    const query = (params.get('q') || '').trim().toLowerCase();
    rows = (await getHostedCollection(env)).filter((row) => row.name.toLowerCase().includes(query));
    filename = 'collection';
  } else if (kind === 'deck') {
    const deckId = Number(params.get('deck_id'));
    if (!Number.isSafeInteger(deckId) || deckId < 1) throw new OneDriveRequestError('Choose a valid deck.');
    if (!['all', 'commander', 'main', 'sideboard'].includes(zone)) throw new OneDriveRequestError('Choose a valid deck zone.');
    const deck = await env.DB.prepare('SELECT id FROM decks WHERE id = ?').bind(deckId).first<{ id: number }>();
    if (!deck) throw new OneDriveRequestError('Deck not found.', 404);
    const entries = await env.DB.prepare('SELECT name, quantity, zone, printing_key FROM entries WHERE deck_id = ? ORDER BY id')
      .bind(deckId).all<ExportEntry>();
    rows = entries.results.filter((entry) => zone === 'all' || entry.zone === zone);
    filename = `deck-${deckId}`;
  } else if (kind === 'missing') {
    const rawIds = params.get('deck_ids') || '';
    const ids = rawIds ? rawIds.split(',').map(Number) : [];
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new OneDriveRequestError('Deck IDs must be positive integers.');
    const wishlist = await hostedWishlist(env, ids, params.get('mode') || 'assembled');
    rows = wishlist.items;
    filename = 'missing-cards';
  } else {
    throw new OneDriveRequestError('Choose a collection, deck, or missing-card export.');
  }

  if (format === 'txt') {
    return new Response(textExport(rows), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.txt"`,
      },
    });
  }
  if (format === 'csv') {
    return new Response(csvExport(rows), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }
  throw new OneDriveRequestError('Export format must be txt or csv.');
}