import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHostedCollection } from './src/collection.ts';
import worker from './src/index.ts';

class FakeDatabase {
  constructor(results) { this.results = results; }
  prepare(query) {
    assert.match(query, /FROM holdings h/);
    return { all: async () => ({ results: this.results }) };
  }
}

test('hosted collection groups finishes and duplicate source rows with cached card data', async () => {
  const card = {
    id: 'card-id', name: 'Lightning Bolt', type_line: 'Instant', oracle_id: 'oracle-id',
    scryfall_uri: 'https://scryfall.com/card/lea/161',
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/example.jpg' },
    oracle_text: 'Lightning Bolt deals 3 damage.', mana_cost: '{R}',
    prices: { eur: '0.50', eur_foil: '3.00' },
  };
  const common = {
    name: 'Lightning Bolt', card_type: 'Instant', color: 'Red', rarity: 'Common',
    set_code: 'lea', collector_number: '161', printing_key: 'lea:161', deck_label: '', notes: '',
    match_status: 'matched', match_message: '', card_payload: JSON.stringify(card), fetched_at: '2026-10-04T10:00:00Z',
  };
  const collection = await getHostedCollection({ DB: new FakeDatabase([
    { ...common, id: 1, quantity: 2, finish: 'nonfoil', source_row: 2, deck_label: 'Burn' },
    { ...common, id: 2, quantity: 1, finish: 'nonfoil', source_row: 7, notes: 'Trade binder' },
    { ...common, id: 3, quantity: 1, finish: 'foil', source_row: 9, deck_label: 'Burn' },
  ]) });

  assert.equal(collection.length, 1);
  assert.deepEqual(collection[0], {
    key: 'lea:161|lightning bolt', name: 'Lightning Bolt', printing_key: 'lea:161',
    set_code: 'lea', collector_number: '161', quantity: 4, nonfoil: 3, foil: 1,
    card_type: 'Instant', color: 'Red', rarity: 'Common', value: 4.5, priced_copies: 4,
    prices: { nonfoil: 0.5, foil: 3 }, decks: ['Burn'], notes: ['Trade binder'], source_rows: [2, 7, 9],
    match_status: 'matched', match_message: '', image_url: 'https://cards.scryfall.io/normal/front/example.jpg',
    scryfall_url: 'https://scryfall.com/card/lea/161', oracle_text: 'Lightning Bolt deals 3 damage.',
    mana_cost: '{R}', fetched_at: '2026-10-04T10:00:00Z',
  });
});

test('collection route requires Access identity and returns the D1 projection', async () => {
  const db = new FakeDatabase([]);
  const env = { DB: db, ASSETS: { fetch: async () => new Response('asset') }, ACCESS_AUD: 'expected-audience' };
  const denied = await worker.fetch(new Request('https://vault.example/api/collection'), env, {});
  assert.equal(denied.status, 401);

  const allowed = await worker.fetch(new Request('https://vault.example/api/collection'), env, {
    access: { aud: 'expected-audience', getIdentity: async () => ({ email: 'owner@example.com' }) },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), []);
});