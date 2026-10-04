import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHostedState } from './src/state.ts';

class FakeStatement {
  constructor(database, query) { this.database = database; this.query = query; }
  bind() { return this; }
  async all() {
    if (this.query.startsWith('SELECT key, value FROM settings')) return { results: this.database.settings };
    if (this.query.includes("FROM imports WHERE status = 'applied'")) return { results: this.database.latest };
    if (this.query.includes("FROM imports WHERE status = 'pending'")) return { results: [] };
    if (this.query.startsWith('SELECT id, name, format, active')) return { results: this.database.decks };
    if (this.query.startsWith('SELECT e.id, e.deck_id')) return { results: this.database.entries };
    if (this.query.startsWith('SELECT id, name, quantity, printing_key')) return { results: this.database.holdings };
    if (this.query.includes('FROM holdings h')) return { results: this.database.collection };
    return { results: [] };
  }
  async first() { return { count: this.database.issueCount }; }
}

class FakeDatabase {
  constructor(data) { Object.assign(this, data); }
  prepare(query) { return new FakeStatement(this, query); }
}

test('hosted state projects the imported snapshot and deck allocation', async () => {
  const database = new FakeDatabase({
    settings: [
      { key: 'workbook_path', value: '"OneDrive/MagicTheGatheringInventory.xlsx"' },
      { key: 'foil_mode', value: '"total"' },
      { key: 'currency', value: '"EUR"' },
      { key: 'seeded_deck_labels', value: '["Ramos"]' },
    ],
    latest: [{ id: 1, created_at: '2026-10-04T20:45:39Z', source: 'OneDrive/MagicTheGatheringInventory.xlsx' }],
    decks: [
      { id: 7, name: 'Ramos', format: 'casual60', active: 0, priority: 1, source_label: 'Ramos', seeded: 1 },
      { id: 8, name: 'Burn', format: 'casual60', active: 1, priority: 0, source_label: null, seeded: 0 },
    ],
    entries: [
      { id: 12, deck_id: 7, name: 'Sol Ring', quantity: 1, zone: 'main', printing_key: null, priority: 1, source_label: 'Ramos' },
      { id: 13, deck_id: 8, name: 'Sol Ring', quantity: 2, zone: 'main', printing_key: null, priority: 0, source_label: null },
    ],
    holdings: [{ id: 4, name: 'Sol Ring', quantity: 2, printing_key: 'cmm:300', deck_label: 'Ramos' }],
    collection: [{
      id: 4, name: 'Sol Ring', card_type: 'Artifact', color: 'Colorless', rarity: 'Uncommon',
      set_code: 'cmm', collector_number: '300', printing_key: 'cmm:300', quantity: 2, finish: 'nonfoil',
      notes: '', deck_label: 'Ramos', source_row: 2, match_status: 'unresolved', match_message: '',
      card_payload: null, fetched_at: null,
    }],
    issueCount: 1,
  });

  const state = await getHostedState({ DB: database });
  assert.deepEqual(state.settings, {
    workbook_path: 'OneDrive/MagicTheGatheringInventory.xlsx', foil_mode: 'total', currency: 'EUR',
    auto_watch: false, last_import_error: '', last_price_success: null,
  });
  assert.deepEqual(state.summary, {
    copies: 2, unique_cards: 1, printings: 1, foil_copies: 0, value: 0, priced_copies: 0, unresolved: 1, issues: 1,
  });
  assert.equal(state.last_import.id, 1);
  assert.equal(state.decks[0].covered, 1);
  assert.equal(state.decks[0].missing, 0);
  assert.equal(state.decks[0].missing_now, 1);
  assert.equal(state.decks[0].entries[0].available, 0);
  assert.equal(state.decks[0].entries[0].in_other_decks, 2);
});