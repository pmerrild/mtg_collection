import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmHostedMatch, searchScryfallCards, syncHostedScryfall } from './src/scryfall.ts';
import worker from './src/index.ts';

class FakeDatabase {
  batches = [];
  runs = [];
  constructor(rows = []) { this.rows = rows; }
  prepare(query) {
    const statement = {
      query,
      values: [],
      bind(...values) { this.values = values; return this; },
      all: async () => ({ results: query.includes('FROM holdings h') ? this.rows : [] }),
      run: async () => { this.runs.push({ query, values: statement.values }); return {}; },
    };
    return statement;
  }
  async batch(statements) { this.batches.push(statements.map(({ query, values }) => ({ query, values }))); }
}

test('Scryfall search returns only the card fields used by hosted dialogs', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/cards/search');
      assert.equal(url.searchParams.get('q'), 'lightning bolt');
      assert.equal(new Headers(init.headers).get('user-agent')?.startsWith('MTG-Vault/0.1'), true);
      return Response.json({ data: [{
        id: 'card-id', name: 'Lightning Bolt', set: 'lea', set_name: 'Limited Edition Alpha',
        collector_number: '161', type_line: 'Instant', image_uris: { small: 'https://img.example/card.jpg' },
        oracle_text: 'unneeded field',
      }] });
    };
    assert.deepEqual(await searchScryfallCards('lightning bolt'), [{
      id: 'card-id', name: 'Lightning Bolt', set: 'lea', set_name: 'Limited Edition Alpha',
      collector_number: '161', type_line: 'Instant', image_uris: { small: 'https://img.example/card.jpg' },
      card_faces: undefined,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scryfall printing confirmation stores only a matching set/collector result', async () => {
  const DB = new FakeDatabase();
  const env = { DB };
  const card = {
    id: '123e4567-e89b-12d3-a456-426614174000', oracle_id: 'oracle-id', name: 'Lightning Bolt',
    set: 'lea', set_name: 'Limited Edition Alpha', collector_number: '161', type_line: 'Instant', prices: {},
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), `https://api.scryfall.com/cards/${card.id}`);
      return Response.json(card);
    };
    assert.deepEqual(await confirmHostedMatch(env, 'lea:161', card.id), {
      printing_key: 'lea:161', card_id: card.id, name: 'Lightning Bolt',
    });
    assert.equal(DB.batches[0].length, 2);
    assert.match(DB.batches[0][1].query, /INSERT OR REPLACE INTO matches/);
    await assert.rejects(confirmHostedMatch(env, 'm21:161', card.id), /does not match/);
    assert.equal(DB.batches.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scryfall sync uses 75-item batches, waits between calls, and maps not-found by identifier', async () => {
  const rows = Array.from({ length: 76 }, (_, index) => ({
    printing_key: `lea:${index + 1}`, set_code: 'lea', collector_number: String(index + 1).padStart(4, '0'),
    name: `Card ${index + 1}`, status: null, card_id: null,
  }));
  const DB = new FakeDatabase(rows);
  const originalFetch = globalThis.fetch;
  const calls = [];
  const waits = [];
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://api.scryfall.com/cards/collection');
      assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
      const identifiers = JSON.parse(init.body).identifiers;
      assert.ok(identifiers.every((identifier) => !/^0\d+$/.test(identifier.collector_number)));
      calls.push(identifiers.length);
      const notFound = identifiers.filter((identifier) => identifier.collector_number === '2');
      return Response.json({
        data: identifiers.filter((identifier) => identifier.collector_number !== '2').map((identifier) => ({
          id: `00000000-0000-4000-8000-${String(Number(identifier.collector_number)).padStart(12, '0')}`,
          name: `Card ${identifier.collector_number}`, set: identifier.set, set_name: 'Limited Edition Alpha',
          collector_number: identifier.collector_number, type_line: 'Creature', prices: { eur: '0.25', eur_foil: null },
        })),
        not_found: notFound,
      });
    };
    const result = await syncHostedScryfall({ DB }, async (duration) => { waits.push(duration); });
    assert.deepEqual(calls, [75, 1]);
    assert.deepEqual(waits, [500]);
    assert.equal(result.total, 76);
    assert.equal(result.updated, 75);
    assert.equal(result.matched, 75);
    assert.equal(result.not_found, 1);
    const cachedCard = DB.batches.flatMap((batch) => batch).find((statement) => statement.query.includes('INSERT INTO cards'));
    const cachedPayload = JSON.parse(cachedCard.values[6]);
    assert.equal(cachedPayload.prices.eur, '0.25');
    assert.equal(cachedPayload.legalities, undefined);
    const matchStatements = DB.batches.flatMap((batch) => batch).filter((statement) => statement.query.includes('INSERT INTO matches'));
    const unresolved = matchStatements.find((statement) => statement.values[0] === 'lea:2');
    assert.match(unresolved.query, /'unresolved'/);
    assert.match(unresolved.values[1], /did not find/);
    assert.equal(DB.runs[0].values[0].startsWith('"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scryfall sync auto-matches exact names and keeps mismatches in review', async () => {
  const rows = [
    { printing_key: 'lea:161', set_code: 'lea', collector_number: '161', name: 'Lightning Bolt', status: null, card_id: null },
    { printing_key: 'm21:99', set_code: 'm21', collector_number: '99', name: 'Workbook Alias', status: null, card_id: null },
  ];
  const DB = new FakeDatabase(rows);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      const identifiers = JSON.parse(init.body).identifiers;
      const cards = identifiers.map((identifier) => ({
        id: identifier.set === 'lea' ? '00000000-0000-4000-8000-000000000161' : '00000000-0000-4000-8000-000000000099',
        name: identifier.set === 'lea' ? 'Lightning Bolt' : 'Actual Card Name',
        set: identifier.set, set_name: 'Test Set', collector_number: identifier.collector_number,
        type_line: 'Instant', prices: { eur: '1.00' },
      }));
      return Response.json({ data: cards.reverse(), not_found: [] });
    };
    const result = await syncHostedScryfall({ DB }, async () => {});
    const matches = DB.batches.flatMap((batch) => batch).filter((statement) => statement.query.includes('INSERT INTO matches'));
    const exact = matches.find((statement) => statement.values[0] === 'lea:161');
    const mismatch = matches.find((statement) => statement.values[0] === 'm21:99');
    assert.equal(exact.values[2], 'matched');
    assert.equal(mismatch.values[2], 'suggested');
    assert.equal(mismatch.values[1], null);
    assert.equal(mismatch.values[4], '00000000-0000-4000-8000-000000000099');
    assert.match(mismatch.values[3], /confirm the workbook name/);
    assert.equal(result.matched, 1);
    assert.equal(result.needs_review, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scryfall sync route requires Access and returns the sync summary', async () => {
  const DB = new FakeDatabase([{
    printing_key: 'lea:161', set_code: 'lea', collector_number: '161', name: 'Lightning Bolt',
    status: null, card_id: null,
  }]);
  const env = { DB, ASSETS: { fetch: async () => new Response('asset') }, ACCESS_AUD: 'expected-audience' };
  const request = new Request('https://vault.example/api/scryfall/sync', {
    method: 'POST', headers: { Origin: 'https://vault.example' },
  });
  const denied = await worker.fetch(request, env, {});
  assert.equal(denied.status, 401);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ data: [{
      id: '00000000-0000-4000-8000-000000000161', name: 'Lightning Bolt', set: 'lea',
      set_name: 'Limited Edition Alpha', collector_number: '161', type_line: 'Instant', prices: { eur: '0.50' },
    }], not_found: [] });
    const response = await worker.fetch(request, env, {
      access: { aud: 'expected-audience', getIdentity: async () => ({ email: 'owner@example.com' }) },
    });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 1);
    assert.equal(summary.updated, 1);
    assert.equal(DB.batches.flatMap((batch) => batch).filter((statement) => statement.query.includes('INSERT INTO cards')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});