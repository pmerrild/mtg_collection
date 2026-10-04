interface D1PreparedStatement {
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface CollectionEnv {
  DB: D1Database;
}

interface HoldingRow {
  id: number;
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
  source_row: number;
  match_status: string | null;
  match_message: string | null;
  card_payload: string | null;
  fetched_at: string | null;
}

interface CollectionCard {
  key: string;
  name: string;
  printing_key: string;
  set_code: string;
  collector_number: string;
  quantity: number;
  nonfoil: number;
  foil: number;
  card_type: string;
  color: string;
  rarity: string;
  value: number | null;
  priced_copies: number;
  prices: { nonfoil: number | null; foil: number | null };
  decks: string[];
  notes: string[];
  source_rows: number[];
  match_status: string;
  match_message: string;
  image_url: string | null;
  scryfall_url: string | null;
  oracle_text: string;
  mana_cost: string;
  fetched_at: string | null;
}

function normalizedName(name: string): string {
  return name.normalize('NFKC').replace(/’/g, "'").toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
}

function parseCard(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cardPrices(card: Record<string, unknown> | null): { nonfoil: number | null; foil: number | null } {
  const prices = card?.prices && typeof card.prices === 'object' ? card.prices as Record<string, unknown> : {};
  const price = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= 0 ? result : null;
  };
  return { nonfoil: price(prices.eur), foil: price(prices.eur_foil) };
}

function imageUrl(card: Record<string, unknown> | null): string | null {
  const uris = card?.image_uris && typeof card.image_uris === 'object'
    ? card.image_uris as Record<string, unknown> : {};
  if (typeof uris.normal === 'string') return uris.normal;
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  for (const face of faces) {
    if (!face || typeof face !== 'object') continue;
    const faceUris = (face as Record<string, unknown>).image_uris;
    if (faceUris && typeof faceUris === 'object' && typeof (faceUris as Record<string, unknown>).normal === 'string') {
      return (faceUris as Record<string, string>).normal;
    }
  }
  return null;
}

export async function getHostedCollection(env: CollectionEnv): Promise<CollectionCard[]> {
  const { results } = await env.DB.prepare(`SELECT h.*,
      COALESCE(m.status, 'unresolved') AS match_status,
      COALESCE(m.message, '') AS match_message,
      c.payload AS card_payload,
      c.fetched_at AS fetched_at
    FROM holdings h
    LEFT JOIN matches m ON m.printing_key = h.printing_key
    LEFT JOIN cards c ON c.id = CASE WHEN m.status = 'matched' THEN m.card_id ELSE NULL END
    ORDER BY h.id`).all<HoldingRow>();

  const grouped = new Map<string, CollectionCard>();
  const cardPayloads = new Map<string, Record<string, unknown> | null>();
  const deckSets = new Map<string, Set<string>>();
  const noteSets = new Map<string, Set<string>>();
  const sourceRows = new Map<string, Set<number>>();

  for (const row of results) {
    const key = `${row.printing_key}|${normalizedName(row.name)}`;
    let card = cardPayloads.get(key);
    if (!cardPayloads.has(key)) {
      card = parseCard(row.card_payload);
      cardPayloads.set(key, card);
    }
    let item = grouped.get(key);
    if (!item) {
      const faces = Array.isArray(card?.card_faces) ? card.card_faces as Record<string, unknown>[] : [];
      const oracle = typeof card?.oracle_text === 'string' ? card.oracle_text
        : faces.map((face) => typeof face.oracle_text === 'string' ? face.oracle_text : '').filter(Boolean).join('\n\n');
      item = {
        key, name: typeof card?.name === 'string' ? card.name : row.name,
        printing_key: row.printing_key, set_code: row.set_code, collector_number: row.collector_number,
        quantity: 0, nonfoil: 0, foil: 0,
        card_type: typeof card?.type_line === 'string' ? card.type_line : row.card_type,
        color: row.color, rarity: row.rarity, value: null, priced_copies: 0,
        prices: { nonfoil: null, foil: null }, decks: [], notes: [], source_rows: [],
        match_status: row.match_status || 'unresolved', match_message: row.match_message || '',
        image_url: imageUrl(card), scryfall_url: typeof card?.scryfall_uri === 'string' ? card.scryfall_uri : null,
        oracle_text: oracle, mana_cost: typeof card?.mana_cost === 'string' ? card.mana_cost : '',
        fetched_at: row.fetched_at,
      };
      grouped.set(key, item);
      deckSets.set(key, new Set());
      noteSets.set(key, new Set());
      sourceRows.set(key, new Set());
    }

    item[row.finish] += row.quantity;
    item.quantity += row.quantity;
    const price = cardPrices(card)[row.finish];
    if (price !== null) {
      item.prices[row.finish] = price;
      item.value = (item.value || 0) + price * row.quantity;
      item.priced_copies += row.quantity;
    }
    if (row.deck_label) deckSets.get(key)!.add(row.deck_label);
    if (row.notes) noteSets.get(key)!.add(row.notes);
    sourceRows.get(key)!.add(row.source_row);
  }

  for (const [key, item] of grouped) {
    item.decks = [...deckSets.get(key)!].sort();
    item.notes = [...noteSets.get(key)!].sort();
    item.source_rows = [...sourceRows.get(key)!].sort((left, right) => left - right);
    if (!item.priced_copies) item.value = null;
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
}