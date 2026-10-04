import { OneDriveRequestError, type OneDriveEnv } from './onedrive.ts';

interface DeckEntry {
  name: string;
  quantity: number;
  zone: 'commander' | 'main' | 'sideboard';
  printing_key: string | null;
}

interface StoredDeckEntry extends DeckEntry { id: number; deck_id: number; }
interface StoredDeck { id: number; name: string; priority: number; active: number; source_label: string | null; }
interface StoredHolding { id: number; name: string; quantity: number; printing_key: string; deck_label: string; }

const formats = new Set(['commander', 'casual60', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper']);

function parseDecklist(text: string): DeckEntry[] {
  if (text.length > 200_000) throw new OneDriveRequestError('The decklist exceeds the 200 KB limit.', 413);
  const grouped = new Map<string, DeckEntry>();
  let zone: DeckEntry['zone'] = 'main';
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const header = line.replace(/^\/+/, '').replace(/[\[\]:]/g, '').trim().toLowerCase();
    if (['commander', 'commanders', 'command zone', 'sideboard', 'main', 'mainboard', 'deck', 'maindeck'].includes(header)) {
      zone = ['commander', 'commanders', 'command zone'].includes(header) ? 'commander'
        : header === 'sideboard' ? 'sideboard' : 'main';
      continue;
    }
    if (line.startsWith('#') || line.startsWith('//')) continue;
    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const quantity = match ? Number(match[1]) : NaN;
    if (!match || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
      throw new OneDriveRequestError(`Line ${index + 1}: use a positive quantity followed by a card name.`);
    }
    let name = match[2].trim();
    const exact = name.match(/^(.+?)\s+\(([A-Za-z0-9]{2,8})\)\s+([0-9]+[A-Za-z*]*)$/);
    let printingKey: string | null = null;
    if (exact) {
      name = exact[1].trim();
      printingKey = `${exact[2].toLowerCase()}:${/^\d+$/.test(exact[3]) ? String(Number(exact[3])) : exact[3]}`;
    }
    const key = `${name.toLowerCase()}\u0000${zone}\u0000${printingKey || ''}`;
    const entry = grouped.get(key);
    if (entry) entry.quantity += quantity;
    else grouped.set(key, { name, quantity, zone, printing_key: printingKey });
  }
  return [...grouped.values()];
}

function generatedDeckId(): number {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value + 1_000_000_000_000;
}

function validateDeck(data: Record<string, unknown>): { name: string; format: string; active: number; entries: DeckEntry[] } {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 120) throw new OneDriveRequestError('Give the deck a name no longer than 120 characters.');
  const format = typeof data.format === 'string' ? data.format : '';
  if (!formats.has(format)) throw new OneDriveRequestError('Choose a supported format.');
  if (data.active !== undefined && typeof data.active !== 'boolean') {
    throw new OneDriveRequestError('The active-deck flag must be true or false.');
  }
  const decklist = typeof data.decklist === 'string' ? data.decklist : '';
  return { name, format, active: data.active === false ? 0 : 1, entries: parseDecklist(decklist) };
}

export async function saveHostedDeck(env: OneDriveEnv, data: Record<string, unknown>, deckId?: number): Promise<{ id: number }> {
  const deck = validateDeck(data);
  const statements = [];
  const updatedAt = new Date().toISOString();
  let id = deckId;
  if (id === undefined) {
    id = generatedDeckId();
    statements.push(env.DB.prepare(`INSERT INTO decks (id, name, format, active, priority, source_label, seeded, updated_at)
      VALUES (?, ?, ?, ?, 0, NULL, 0, ?)`)
      .bind(id, deck.name, deck.format, deck.active, updatedAt));
  } else {
    if (!Number.isSafeInteger(id) || id < 1) throw new OneDriveRequestError('Deck not found.', 404);
    const current = await env.DB.prepare('SELECT id FROM decks WHERE id = ?').bind(id).first<{ id: number }>();
    if (!current) throw new OneDriveRequestError('Deck not found.', 404);
    statements.push(env.DB.prepare(`UPDATE decks SET name = ?, format = ?, active = ?, seeded = 0, updated_at = ? WHERE id = ?`)
      .bind(deck.name, deck.format, deck.active, updatedAt, id));
    statements.push(env.DB.prepare('DELETE FROM entries WHERE deck_id = ?').bind(id));
  }
  for (const entry of deck.entries) {
    statements.push(env.DB.prepare(`INSERT INTO entries (deck_id, name, quantity, zone, printing_key)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(id, entry.name, entry.quantity, entry.zone, entry.printing_key));
  }
  try {
    await env.DB.batch(statements);
  } catch {
    throw new OneDriveRequestError('The deck could not be saved; its previous entries were preserved.', 503);
  }
  return { id };
}

export async function setHostedDeckActive(env: OneDriveEnv, deckId: number, active: unknown): Promise<{ active: boolean }> {
  if (!Number.isSafeInteger(deckId) || deckId < 1) throw new OneDriveRequestError('Deck not found.', 404);
  if (typeof active !== 'boolean') throw new OneDriveRequestError('The active-deck flag must be true or false.');
  const result = await env.DB.prepare('UPDATE decks SET active = ?, updated_at = ? WHERE id = ?')
    .bind(active ? 1 : 0, new Date().toISOString(), deckId).run() as { meta?: { changes?: number } };
  if (result.meta?.changes === 0) throw new OneDriveRequestError('Deck not found.', 404);
  return { active };
}

export async function deleteHostedDeck(env: OneDriveEnv, deckId: number): Promise<{ deleted: boolean }> {
  if (!Number.isSafeInteger(deckId) || deckId < 1) throw new OneDriveRequestError('Deck not found.', 404);
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM entries WHERE deck_id = ?').bind(deckId),
      env.DB.prepare('DELETE FROM decks WHERE id = ?').bind(deckId),
    ]);
  } catch {
    throw new OneDriveRequestError('The deck could not be deleted.', 503);
  }
  return { deleted: true };
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/’/g, "'").toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
}

export async function hostedWishlist(env: OneDriveEnv, requestedIds: number[], mode: unknown) {
  if (mode !== 'assembled' && mode !== 'shared') throw new OneDriveRequestError('Choose assembled or shared decks.');
  const deckIds = [...new Set(requestedIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (deckIds.length > 100) throw new OneDriveRequestError('Select no more than 100 decks.', 413);
  if (!deckIds.length) return { items: [], copies: 0, estimate: 0, priced_copies: 0 };

  const placeholders = deckIds.map(() => '?').join(',');
  const [deckResult, entryResult, holdingResult] = await Promise.all([
    env.DB.prepare(`SELECT id, name, priority, active, source_label FROM decks WHERE id IN (${placeholders}) ORDER BY priority, id`)
      .bind(...deckIds).all<StoredDeck>(),
    env.DB.prepare(`SELECT e.id, e.deck_id, e.name, e.quantity, e.zone, e.printing_key
      FROM entries e WHERE e.deck_id IN (${placeholders}) ORDER BY e.id`).bind(...deckIds).all<StoredDeckEntry>(),
    env.DB.prepare('SELECT id, name, quantity, printing_key, deck_label FROM holdings').all<StoredHolding>(),
  ]);
  const selectedDecks = deckResult.results;
  const entries = entryResult.results;
  const holdings = holdingResult.results;
  const decksById = new Map(selectedDecks.map((deck) => [deck.id, deck]));
  const compatible = (entry: StoredDeckEntry, holding: StoredHolding) => normalizeName(entry.name) === normalizeName(holding.name)
    && (!entry.printing_key || entry.printing_key.toLowerCase() === holding.printing_key.toLowerCase());
  const output = new Map<string, { name: string; printing_key: string | null; quantity: number; decks: Set<string> }>();
  const addMissing = (entry: StoredDeckEntry, quantity: number, groupEntries: StoredDeckEntry[]) => {
    if (quantity <= 0) return;
    const key = `${normalizeName(entry.name)}\u0000${entry.printing_key || ''}`;
    const item = output.get(key) || { name: entry.name, printing_key: entry.printing_key, quantity: 0, decks: new Set<string>() };
    item.quantity += quantity;
    for (const groupEntry of groupEntries) {
      const deckName = decksById.get(groupEntry.deck_id)?.name;
      if (deckName) item.decks.add(deckName);
    }
    output.set(key, item);
  };

  if (mode === 'assembled') {
    const remaining = new Map(holdings.map((holding) => [holding.id, holding.quantity]));
    const allocated = new Map<number, Map<number, number>>();
    const ordered = [...entries].sort((left, right) => {
      const exactFirst = Number(Boolean(right.printing_key)) - Number(Boolean(left.printing_key));
      const leftDeck = decksById.get(left.deck_id)!;
      const rightDeck = decksById.get(right.deck_id)!;
      return exactFirst || leftDeck.priority - rightDeck.priority || left.deck_id - right.deck_id || left.id - right.id;
    });
    for (const entry of ordered) {
      let needed = entry.quantity;
      const deck = decksById.get(entry.deck_id)!;
      const candidates = holdings.filter((holding) => compatible(entry, holding))
        .sort((left, right) => {
          const ownerLabel = deck.source_label || deck.name;
          const preference = (holding: StoredHolding) => holding.deck_label === ownerLabel ? 2 : holding.deck_label ? 0 : 1;
          return preference(right) - preference(left) || left.id - right.id;
        });
      for (const holding of candidates) {
        if (needed <= 0) break;
        const available = remaining.get(holding.id) || 0;
        const taken = Math.min(needed, available);
        if (!taken) continue;
        const map = allocated.get(entry.id) || new Map<number, number>();
        map.set(holding.id, taken);
        allocated.set(entry.id, map);
        remaining.set(holding.id, available - taken);
        needed -= taken;
      }
      if (needed > 0) addMissing(entry, needed, [entry]);
    }
  } else {
    const groups = new Map<string, StoredDeckEntry[]>();
    for (const entry of entries) {
      const key = normalizeName(entry.name);
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const byDeck = new Map<number, number>();
      const exactByKey = new Map<string, Map<number, number>>();
      for (const entry of group) {
        byDeck.set(entry.deck_id, (byDeck.get(entry.deck_id) || 0) + entry.quantity);
        if (entry.printing_key) {
          const exact = exactByKey.get(entry.printing_key) || new Map<number, number>();
          exact.set(entry.deck_id, (exact.get(entry.deck_id) || 0) + entry.quantity);
          exactByKey.set(entry.printing_key, exact);
        }
      }
      const totalNeed = Math.max(...byDeck.values());
      const exactNeeds = [...exactByKey.entries()].map(([key, demand]) => ({
        key,
        need: Math.max(...demand.values()),
        entries: group.filter((entry) => entry.printing_key === key),
      }));
      let exactTotal = 0;
      for (const exact of exactNeeds) {
        exactTotal += exact.need;
        const owned = holdings.filter((holding) => holding.printing_key.toLowerCase() === exact.key.toLowerCase()
          && normalizeName(holding.name) === normalizeName(group[0].name)).reduce((sum, holding) => sum + holding.quantity, 0);
        addMissing(exact.entries[0], Math.max(0, exact.need - owned), exact.entries);
      }
      const totalOwned = holdings.filter((holding) => normalizeName(holding.name) === normalizeName(group[0].name))
        .reduce((sum, holding) => sum + holding.quantity, 0);
      const flexibleNeed = Math.max(0, totalNeed - exactTotal);
      const flexibleOwned = Math.max(0, totalOwned - exactTotal);
      const flexibleEntries = group.filter((entry) => !entry.printing_key);
      if (flexibleEntries.length) addMissing(flexibleEntries[0], Math.max(0, flexibleNeed - flexibleOwned), flexibleEntries);
    }
  }

  const items = [...output.values()].map((item) => ({
    name: item.name,
    printing_key: item.printing_key,
    quantity: item.quantity,
    estimate: null,
    decks: [...item.decks].sort(),
  })).sort((left, right) => left.name.localeCompare(right.name));
  return { items, copies: items.reduce((sum, item) => sum + item.quantity, 0), estimate: 0, priced_copies: 0 };
}