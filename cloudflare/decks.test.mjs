import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostedWishlist, saveHostedDeck } from './src/decks.ts';

class Statement {
  constructor(database, query) { this.database = database; this.query = query; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() { return this.query.startsWith('SELECT id FROM decks') ? { id: this.values[0] } : null; }
  async all() {
    if (this.query.startsWith('SELECT id, name, priority, active')) return { results: this.database.decks };
    if (this.query.startsWith('SELECT e.id, e.deck_id')) return { results: this.database.entries };
    if (this.query.startsWith('SELECT id, name, quantity, printing_key')) return { results: this.database.holdings };
    return { results: [] };
  }
}

class FakeDatabase {
  constructor(data = {}) { Object.assign(this, { decks: [], entries: [], holdings: [], batches: [] }, data); }
  prepare(query) { return new Statement(this, query); }
  async batch(statements) { this.batches.push(statements.map((statement) => ({ query: statement.query, values: statement.values }))); }
}

test('deck creation validates format and atomically inserts grouped target entries', async () => {
  const DB = new FakeDatabase();
  const result = await saveHostedDeck({ DB }, {
    name: 'Test Commander', format: 'commander', active: true,
    decklist: 'Commander\n1 Sol Ring\n\nDeck\n2 Lightning Bolt\n1 Lightning Bolt (CMM) 123\n\nSideboard\n1 Island',
  });
  assert.ok(Number.isSafeInteger(result.id));
  const batch = DB.batches[0];
  assert.equal(batch[0].query.startsWith('INSERT INTO decks'), true);
  const entries = batch.filter((statement) => statement.query.startsWith('INSERT INTO entries'));
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((statement) => statement.values.slice(1)), [
    ['Sol Ring', 1, 'commander', null],
    ['Lightning Bolt', 2, 'main', null],
    ['Lightning Bolt', 1, 'main', 'cmm:123'],
    ['Island', 1, 'sideboard', null],
  ]);
  await assert.rejects(saveHostedDeck({ DB }, { name: 'Bad', format: 'unknown', decklist: '' }), /supported format/);
  await assert.rejects(saveHostedDeck({ DB }, { name: 'Bad', format: 'commander', decklist: 'no quantity' }), /Line 1/);
});

test('wishlist assembled mode allocates physical copies once and shared mode uses maximum demand', async () => {
  const DB = new FakeDatabase({
    decks: [
      { id: 1, name: 'Burn', priority: 0, active: 1 },
      { id: 2, name: 'Control', priority: 1, active: 1 },
    ],
    entries: [
      { id: 11, deck_id: 1, name: 'Sol Ring', quantity: 4, zone: 'main', printing_key: null },
      { id: 12, deck_id: 2, name: 'Sol Ring', quantity: 4, zone: 'main', printing_key: null },
      { id: 13, deck_id: 1, name: 'Lightning Bolt', quantity: 2, zone: 'main', printing_key: null },
    ],
    holdings: [
      { id: 21, name: 'Sol Ring', quantity: 5, printing_key: 'cmm:300' },
      { id: 22, name: 'Lightning Bolt', quantity: 1, printing_key: 'lea:161' },
    ],
  });
  const env = { DB };

  const assembled = await hostedWishlist(env, [1, 2], 'assembled');
  assert.equal(assembled.copies, 4);
  assert.deepEqual(assembled.items.map(({ name, quantity }) => ({ name, quantity })), [
    { name: 'Lightning Bolt', quantity: 1 }, { name: 'Sol Ring', quantity: 3 },
  ]);

  const shared = await hostedWishlist(env, [1, 2], 'shared');
  assert.equal(shared.copies, 1);
  assert.deepEqual(shared.items.map(({ name, quantity }) => ({ name, quantity })), [
    { name: 'Lightning Bolt', quantity: 1 },
  ]);
});