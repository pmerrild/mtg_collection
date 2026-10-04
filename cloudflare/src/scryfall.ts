import { OneDriveRequestError, type OneDriveEnv } from './onedrive.ts';

interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  type_line: string;
  image_uris?: { small?: string; normal?: string };
  card_faces?: { image_uris?: { small?: string; normal?: string }; oracle_text?: string }[];
  oracle_text?: string;
  mana_cost?: string;
  scryfall_uri?: string;
  prices?: { eur?: string | null; eur_foil?: string | null; [currency: string]: string | null | undefined };
  [key: string]: unknown;
}

interface SearchResponse {
  data?: ScryfallCard[];
}

interface SyncHoldingRow {
  printing_key: string;
  set_code: string;
  collector_number: string;
  name: string;
  status: string | null;
  card_id: string | null;
}

interface CollectionIdentifier {
  id?: string;
  set?: string;
  collector_number?: string;
}

interface CollectionResponse {
  data?: ScryfallCard[];
  not_found?: CollectionIdentifier[];
}

interface SyncPrinting {
  printingKey: string;
  setCode: string;
  collectorNumber: string;
  names: Set<string>;
  matchedCardId: string | null;
}

const scryfallHeaders = {
  Accept: 'application/json',
  'User-Agent': 'MTG-Vault/0.1 (+https://mtg-vault.merrild-peter.workers.dev)',
};

function canonicalPrintingKey(set: string, number: string): string {
  const collector = /^\d+$/.test(number) ? String(Number(number)) : number;
  return `${set.trim().toLowerCase()}:${collector}`;
}

function scryfallCollectorNumber(number: string): string {
  return /^\d+$/.test(number) ? String(Number(number)) : number;
}

function normalizedCardName(name: string): string {
  return name.normalize('NFKC').replace(/’/g, "'").toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
}

function identifierKey(identifier: CollectionIdentifier): string | null {
  if (identifier.id) return `id:${identifier.id.toLowerCase()}`;
  if (identifier.set && identifier.collector_number) {
    return `printing:${canonicalPrintingKey(identifier.set, identifier.collector_number)}`;
  }
  return null;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cachedCardPayload(card: ScryfallCard): string {
  return JSON.stringify({
    id: card.id,
    oracle_id: card.oracle_id || null,
    name: card.name,
    set: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    type_line: card.type_line,
    mana_cost: card.mana_cost || '',
    oracle_text: card.oracle_text || '',
    image_uris: card.image_uris?.normal ? { normal: card.image_uris.normal } : undefined,
    card_faces: card.card_faces?.map((face) => ({
      oracle_text: face.oracle_text || '',
      image_uris: face.image_uris?.normal ? { normal: face.image_uris.normal } : undefined,
    })),
    scryfall_uri: card.scryfall_uri || '',
    prices: card.prices || {},
  });
}

export async function searchScryfallCards(query: string): Promise<Record<string, unknown>[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 200) throw new OneDriveRequestError('Enter a search of 1 to 200 characters.');
  const url = new URL('https://api.scryfall.com/cards/search');
  url.searchParams.set('q', trimmed);
  url.searchParams.set('unique', 'prints');
  url.searchParams.set('order', 'name');
  url.searchParams.set('dir', 'asc');
  const response = await fetch(url, { headers: scryfallHeaders });
  if (response.status === 404) return [];
  if (response.status === 429) throw new OneDriveRequestError('Scryfall is rate limiting searches. Wait briefly and retry.', 429);
  if (!response.ok) throw new OneDriveRequestError('Scryfall search is unavailable.', 502);
  const payload = await response.json() as SearchResponse;
  return (payload.data || []).slice(0, 40).map((card) => ({
    id: card.id,
    name: card.name,
    set: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    type_line: card.type_line,
    image_uris: card.image_uris,
    card_faces: card.card_faces,
  }));
}

export async function confirmHostedMatch(
  env: OneDriveEnv,
  printingKey: unknown,
  cardId: unknown,
): Promise<{ printing_key: string; card_id: string; name: string }> {
  if (typeof printingKey !== 'string' || !/^[a-z0-9]{2,8}:[0-9A-Za-z*]+$/i.test(printingKey)) {
    throw new OneDriveRequestError('The collection printing key is invalid.');
  }
  if (typeof cardId !== 'string' || !/^[0-9a-f-]{36}$/i.test(cardId)) {
    throw new OneDriveRequestError('Choose a Scryfall printing from the search results.');
  }
  const response = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(cardId)}`, { headers: scryfallHeaders });
  if (response.status === 404) throw new OneDriveRequestError('Scryfall printing not found.', 404);
  if (response.status === 429) throw new OneDriveRequestError('Scryfall is rate limiting requests. Wait briefly and retry.', 429);
  if (!response.ok) throw new OneDriveRequestError('Scryfall printing lookup is unavailable.', 502);
  const card = await response.json() as ScryfallCard;
  if (canonicalPrintingKey(card.set, card.collector_number) !== printingKey.trim().toLowerCase()) {
    throw new OneDriveRequestError('That Scryfall printing does not match the selected set and collector number.');
  }

  const fetchedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO cards (id, oracle_id, name, set_code, collector_number, fetched_at, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(card.id, card.oracle_id || null, card.name, card.set, card.collector_number, fetchedAt, cachedCardPayload(card)),
    env.DB.prepare(`INSERT OR REPLACE INTO matches (printing_key, card_id, status, message, checked_at)
      VALUES (?, ?, 'matched', '', ?)`)
      .bind(printingKey.trim().toLowerCase(), card.id, fetchedAt),
  ]);
  return { printing_key: printingKey.trim().toLowerCase(), card_id: card.id, name: card.name };
}

export async function syncHostedScryfall(
  env: OneDriveEnv,
  wait: (milliseconds: number) => Promise<void> = pause,
): Promise<{ total: number; updated: number; matched: number; needs_review: number; not_found: number; synced_at: string }> {
  const { results } = await env.DB.prepare(`SELECT h.printing_key, h.set_code, h.collector_number, h.name,
      m.status, m.card_id
    FROM holdings h LEFT JOIN matches m ON m.printing_key = h.printing_key ORDER BY h.id`).all<SyncHoldingRow>();
  const printings = new Map<string, SyncPrinting>();
  for (const row of results) {
    const key = row.printing_key.trim().toLowerCase();
    let printing = printings.get(key);
    if (!printing) {
      printing = {
        printingKey: key,
        setCode: row.set_code.trim().toLowerCase(),
        collectorNumber: row.collector_number.trim(),
        names: new Set(),
        matchedCardId: null,
      };
      printings.set(key, printing);
    }
    printing.names.add(row.name);
    if (row.status === 'matched' && row.card_id) printing.matchedCardId = row.card_id;
  }

  const groups = [...printings.values()];
  const maxPrintings = 1500;
  if (groups.length > maxPrintings) {
    throw new OneDriveRequestError(`Sync is limited to ${maxPrintings} printings per run.`, 413);
  }

  const byIdentifier = new Map<string, SyncPrinting[]>();
  const identifiers: { identifier: CollectionIdentifier; printing: SyncPrinting }[] = [];
  const unmatchedInvalid: SyncPrinting[] = [];
  for (const printing of groups) {
    if (printing.matchedCardId) {
      const identifier = { id: printing.matchedCardId };
      const key = identifierKey(identifier)!;
      byIdentifier.set(key, [...(byIdentifier.get(key) || []), printing]);
      identifiers.push({ identifier, printing });
    } else if (/^[a-z0-9]{2,8}$/i.test(printing.setCode) && printing.collectorNumber) {
      const identifier = { set: printing.setCode, collector_number: scryfallCollectorNumber(printing.collectorNumber) };
      const key = identifierKey(identifier)!;
      byIdentifier.set(key, [...(byIdentifier.get(key) || []), printing]);
      identifiers.push({ identifier, printing });
    } else {
      unmatchedInvalid.push(printing);
    }
  }

  let updated = 0;
  let matched = 0;
  let needsReview = 0;
  let notFound = 0;
  const fetchedAt = new Date().toISOString();
  const batches: { items: { identifier: CollectionIdentifier; printing: SyncPrinting }[] }[] = [];
  for (let offset = 0; offset < identifiers.length; offset += 75) {
    batches.push({ items: identifiers.slice(offset, offset + 75) });
  }

  for (const [batchIndex, batch] of batches.entries()) {
    if (batchIndex > 0) await wait(500);
    const response = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { ...scryfallHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.items.map(({ identifier }) => identifier) }),
    });
    if (response.status === 429) throw new OneDriveRequestError('Scryfall is rate limiting sync requests. Wait briefly and retry.', 429);
    if (!response.ok) throw new OneDriveRequestError('Scryfall collection sync is unavailable.', 502);
    const payload = await response.json() as CollectionResponse;
    const found = new Map<SyncPrinting, ScryfallCard>();
    const unresolved = new Set(batch.items.map(({ printing }) => printing));

    for (const card of payload.data || []) {
      const byId = byIdentifier.get(`id:${card.id.toLowerCase()}`) || [];
      const byPrinting = byIdentifier.get(`printing:${canonicalPrintingKey(card.set, card.collector_number)}`) || [];
      const targets = byId.length ? byId : byPrinting;
      for (const printing of targets) {
        if (!unresolved.has(printing)) continue;
        found.set(printing, card);
        unresolved.delete(printing);
      }
    }

    for (const identifier of payload.not_found || []) {
      const key = identifierKey(identifier);
      if (!key) continue;
      for (const printing of byIdentifier.get(key) || []) unresolved.delete(printing);
    }

    const cardStatements = [];
    const matchStatements = [];
    for (const printing of batch.items.map(({ printing }) => printing)) {
      const card = found.get(printing);
      if (!card) {
        if (printing.matchedCardId) continue;
        const message = /^[a-z0-9]{2,8}$/i.test(printing.setCode)
          ? 'Scryfall did not find this set and collector number.'
          : 'The workbook set code is invalid; fix the edition before matching this printing.';
        matchStatements.push(env.DB.prepare(`INSERT INTO matches (printing_key, card_id, status, message, candidate_id, checked_at)
          VALUES (?, NULL, 'unresolved', ?, NULL, ?)
          ON CONFLICT(printing_key) DO UPDATE SET card_id = NULL, status = 'unresolved', message = excluded.message,
            candidate_id = NULL, checked_at = excluded.checked_at`)
          .bind(printing.printingKey, message, fetchedAt));
        notFound++;
        continue;
      }

      const existingManualMatch = Boolean(printing.matchedCardId);
      const namesMatch = [...printing.names].every((name) => normalizedCardName(name) === normalizedCardName(card.name));
      const status = existingManualMatch || namesMatch ? 'matched' : 'suggested';
      const message = namesMatch ? '' : `Scryfall identifies this printing as ${card.name}; confirm the workbook name before matching.`;
      cardStatements.push(env.DB.prepare(`INSERT INTO cards (id, oracle_id, name, set_code, collector_number, fetched_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET oracle_id = excluded.oracle_id, name = excluded.name,
          set_code = excluded.set_code, collector_number = excluded.collector_number,
          fetched_at = excluded.fetched_at, payload = excluded.payload`)
        .bind(card.id, card.oracle_id || null, card.name, card.set, card.collector_number, fetchedAt, cachedCardPayload(card)));
      matchStatements.push(env.DB.prepare(`INSERT INTO matches (printing_key, card_id, status, message, candidate_id, checked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(printing_key) DO UPDATE SET card_id = excluded.card_id, status = excluded.status,
          message = excluded.message, candidate_id = excluded.candidate_id, checked_at = excluded.checked_at`)
        .bind(printing.printingKey, status === 'matched' ? card.id : null, status, message,
          status === 'suggested' ? card.id : null, fetchedAt));
      updated++;
      if (status === 'matched') matched++;
      else needsReview++;
    }

    if (cardStatements.length) await env.DB.batch(cardStatements);
    if (matchStatements.length) await env.DB.batch(matchStatements);
  }

  for (const printing of unmatchedInvalid) {
    const message = 'The workbook set code is invalid; fix the edition before matching this printing.';
    await env.DB.prepare(`INSERT INTO matches (printing_key, card_id, status, message, candidate_id, checked_at)
      VALUES (?, NULL, 'unresolved', ?, NULL, ?)
      ON CONFLICT(printing_key) DO UPDATE SET card_id = NULL, status = 'unresolved', message = excluded.message,
        candidate_id = NULL, checked_at = excluded.checked_at`)
      .bind(printing.printingKey, message, fetchedAt).run();
    notFound++;
  }

  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_price_success', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(fetchedAt)).run();

  return { total: groups.length, updated, matched, needs_review: needsReview, not_found: notFound, synced_at: fetchedAt };
}