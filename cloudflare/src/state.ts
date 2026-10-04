import { getHostedCollection } from './collection.ts';

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface StateEnv {
  DB: D1Database;
}

interface SettingRow { key: string; value: string }
interface ImportRow { id: number; created_at: string; source: string; status: string; payload: string }
interface DeckRow { id: number; name: string; format: string; active: number; priority: number; source_label: string | null; seeded: number }
interface EntryRow { id: number; deck_id: number; name: string; quantity: number; zone: string; printing_key: string | null }
interface HoldingRow { id: number; name: string; quantity: number; printing_key: string; deck_label: string }

function decode(value: string | undefined, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/’/g, "'").toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
}

function deckWarnings(deck: DeckRow, entries: EntryRow[]): string[] {
  const warnings: string[] = [];
  const mainCount = entries.filter((entry) => entry.zone !== 'sideboard')
    .reduce((sum, entry) => sum + entry.quantity, 0);
  if (deck.format === 'commander') {
      if (mainCount > 100) warnings.push(`This list specifies ${mainCount} cards outside the sideboard; Commander decks have a 100-card limit.`);
    if (!entries.some((entry) => entry.zone === 'commander')) warnings.push('No commander is designated. Add a Commander section to your decklist.');
    } else if (mainCount > 60 && deck.format === 'casual60') {
      warnings.push(`This Casual 60-card list specifies ${mainCount} cards; review whether that target is intentional.`);
  }
  return warnings;
}

function decklist(entries: EntryRow[]): string {
  const lines: string[] = [];
  for (const zone of ['commander', 'main', 'sideboard']) {
    const rows = entries.filter((entry) => entry.zone === zone);
    if (!rows.length) continue;
    if (lines.length) lines.push('');
    lines.push(zone === 'commander' ? 'Commander' : zone === 'sideboard' ? 'Sideboard' : 'Deck');
    for (const entry of rows) {
      const exact = entry.printing_key ? ` (${entry.printing_key.split(':')[0].toUpperCase()}) ${entry.printing_key.split(':').slice(1).join(':')}` : '';
      lines.push(`${entry.quantity} ${entry.name}${exact}`);
    }
  }
  return lines.join('\n');
}

export async function getHostedIssues(env: StateEnv): Promise<Record<string, unknown>> {
  const rows = await env.DB.prepare('SELECT * FROM issues ORDER BY source_row').all<{
    id: number; source_row: number; name: string; message: string; raw: string;
  }>();
  const matches = await env.DB.prepare(`SELECT m.printing_key, m.status, m.message,
      GROUP_CONCAT(DISTINCT h.name) AS name, GROUP_CONCAT(DISTINCT h.source_row) AS source_rows
    FROM matches m JOIN holdings h ON m.printing_key = h.printing_key
    WHERE m.status <> 'matched' GROUP BY m.printing_key ORDER BY name`).all();
  const history = await env.DB.prepare('SELECT id, created_at, source, status FROM imports ORDER BY id DESC LIMIT 15').all();
  return {
    rows: rows.results.map((row) => ({ ...row, raw: decode(row.raw, {}) })),
    matches: matches.results,
    history: history.results,
  };
}

export async function getHostedState(env: StateEnv): Promise<Record<string, unknown>> {
  const [settingsResult, latestResult, pendingResult, decksResult, entriesResult, holdingsResult, collection] = await Promise.all([
    env.DB.prepare('SELECT key, value FROM settings').all<SettingRow>(),
    env.DB.prepare(`SELECT id, created_at, source FROM imports WHERE status = 'applied' ORDER BY id DESC LIMIT 1`).all<ImportRow>(),
    env.DB.prepare(`SELECT id, created_at, source, payload FROM imports WHERE status = 'pending' ORDER BY id DESC LIMIT 1`).all<ImportRow>(),
    env.DB.prepare('SELECT id, name, format, active, priority, source_label, seeded FROM decks ORDER BY priority, id').all<DeckRow>(),
    env.DB.prepare(`SELECT e.id, e.deck_id, e.name, e.quantity, e.zone, e.printing_key,
        d.priority, d.source_label
      FROM entries e JOIN decks d ON d.id = e.deck_id ORDER BY e.id`).all<(EntryRow & { priority: number; source_label: string | null })>(),
    env.DB.prepare('SELECT id, name, quantity, printing_key, deck_label FROM holdings ORDER BY id').all<HoldingRow>(),
    getHostedCollection(env),
  ]);

  const settings = Object.fromEntries(settingsResult.results.map((row) => [row.key, decode(row.value, null)]));
  const latest = latestResult.results[0];
  const pending = pendingResult.results[0];
  let pendingPreview = null;
  if (pending) {
    const payload = decode(pending.payload, {}) as Record<string, unknown>;
    pendingPreview = {
      id: pending.id, created_at: pending.created_at, source: pending.source,
      rows: payload.rows ?? 0, copies: payload.copies ?? 0, reductions: payload.reductions ?? [],
    };
  }

  const deckRows = decksResult.results;
  const entryRows = entriesResult.results;
  const holdingRows = holdingsResult.results;
  const activeDecks = new Set(deckRows.filter((deck) => deck.active).map((deck) => deck.id));
  const allocate = (selectedDecks: Set<number>) => {
    const remaining = new Map(holdingRows.map((holding) => [holding.id, holding.quantity]));
    const allocations = new Map<number, Map<number, number>>();
    const orderedEntries = [...entryRows].filter((entry) => selectedDecks.has(entry.deck_id)).sort((left, right) => {
      const exactOrder = Number(Boolean(right.printing_key)) - Number(Boolean(left.printing_key));
      return exactOrder || left.priority - right.priority || left.deck_id - right.deck_id || left.id - right.id;
    });

    for (const entry of orderedEntries) {
      const deck = deckRows.find((item) => item.id === entry.deck_id)!;
      const nameKey = normalized(entry.name);
      const candidates = holdingRows.filter((holding) => normalized(holding.name) === nameKey
        && (!entry.printing_key || entry.printing_key.toLowerCase() === holding.printing_key.toLowerCase()))
        .sort((left, right) => Number(right.deck_label === (deck.source_label || deck.name))
          - Number(left.deck_label === (deck.source_label || deck.name)) || left.id - right.id);
      let needed = entry.quantity;
      for (const holding of candidates) {
        if (needed <= 0) break;
        const available = remaining.get(holding.id) || 0;
        const taken = Math.min(needed, available);
        if (!taken) continue;
        const byHolding = allocations.get(entry.id) || new Map<number, number>();
        byHolding.set(holding.id, taken);
        allocations.set(entry.id, byHolding);
        remaining.set(holding.id, available - taken);
        needed -= taken;
      }
    }
    return allocations;
  };
  const activeAllocations = allocate(activeDecks);
  const coverageAllocations = new Map<number, Map<number, Map<number, number>>>();
  const contextAllocations = new Map<number, Map<number, Map<number, number>>>();
  for (const deck of deckRows) {
    coverageAllocations.set(deck.id, allocate(new Set([deck.id])));
    contextAllocations.set(deck.id, activeDecks.has(deck.id) ? activeAllocations
      : allocate(new Set([...activeDecks, deck.id])));
  }

  const decks = deckRows.map((deck) => {
    const ownEntries = entryRows.filter((entry) => entry.deck_id === deck.id);
    const coverageForDeck = coverageAllocations.get(deck.id)!;
    const allocationForDeck = contextAllocations.get(deck.id)!;
    const entrySummaries = ownEntries.map((entry) => {
      const compatible = holdingRows.filter((holding) => normalized(holding.name) === normalized(entry.name)
        && (!entry.printing_key || entry.printing_key.toLowerCase() === holding.printing_key.toLowerCase()));
      const owned = compatible.reduce((sum, holding) => sum + holding.quantity, 0);
      const coverage = coverageForDeck.get(entry.id) || new Map<number, number>();
      const covered = [...coverage.values()].reduce((sum, quantity) => sum + quantity, 0);
      const inOtherDecks = compatible.reduce((sum, holding) => sum + entryRows
        .filter((other) => other.deck_id !== deck.id)
        .reduce((total, other) => total + (allocationForDeck.get(other.id)?.get(holding.id) || 0), 0), 0);
      const assigned = [...(allocationForDeck.get(entry.id)?.values() || [])]
        .reduce((sum, quantity) => sum + quantity, 0);
      return {
        id: entry.id, quantity: entry.quantity, zone: entry.zone, printing_key: entry.printing_key,
        name: entry.name, owned, available: Math.max(0, owned - inOtherDecks), in_other_decks: inOtherDecks,
        covered, assigned, missing: Math.max(0, entry.quantity - covered), missing_now: Math.max(0, entry.quantity - assigned),
        estimate: null,
      };
    });
    return {
      ...deck,
      decklist: decklist(ownEntries),
      warnings: deckWarnings(deck, ownEntries),
      entries: entrySummaries,
      total: ownEntries.reduce((sum, entry) => sum + entry.quantity, 0),
      covered: entrySummaries.reduce((sum, entry) => sum + entry.covered, 0),
      missing: entrySummaries.reduce((sum, entry) => sum + entry.missing, 0),
      missing_now: entrySummaries.reduce((sum, entry) => sum + entry.missing_now, 0),
    };
  });

  return {
    hosted: true,
    settings: {
      workbook_path: settings.workbook_path || '',
      foil_mode: settings.foil_mode || 'total',
      currency: settings.currency || 'EUR',
      auto_watch: false,
      last_import_error: settings.last_import_error || '',
      last_price_success: settings.last_price_success || null,
    },
    last_import: latest ? { id: latest.id, created_at: latest.created_at, source: latest.source } : null,
    pending_import: pendingPreview,
    summary: {
      copies: collection.reduce((sum, item) => sum + item.quantity, 0),
      unique_cards: new Set(holdingRows.map((holding) => normalized(holding.name))).size,
      printings: collection.length,
      foil_copies: collection.reduce((sum, item) => sum + item.foil, 0),
      value: collection.reduce((sum, item) => sum + (item.value || 0), 0),
      priced_copies: collection.reduce((sum, item) => sum + item.priced_copies, 0),
      unresolved: collection.filter((item) => item.match_status !== 'matched').length,
      issues: (await env.DB.prepare('SELECT COUNT(*) AS count FROM issues').first<{ count: number }>())?.count || 0,
    },
    price_job: { running: false, completed: 0, total: 0, error: '', message: 'Manual Scryfall sync is available in Settings.' },
    decks,
  };
}