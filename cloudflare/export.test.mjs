import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportHostedData } from './src/export.ts';

const collectionRow = {
  id: 1, name: '=2+2', card_type: 'Instant', color: 'R', rarity: 'common', set_code: 'lea',
  collector_number: '161', printing_key: 'lea:161', quantity: 2, finish: 'nonfoil', notes: 'quote, "this"\nline',
  deck_label: '', source_row: 7, match_status: null, match_message: null, card_payload: null, fetched_at: null,
};

class FakeDatabase {
  statements = [];
  prepare(query) {
    const statement = {
      query,
      values: [],
      bind(...values) { this.values = values; return this; },
      all: async () => ({ results: query.includes('FROM holdings') ? [collectionRow] : [{ name: 'Island', quantity: 3, zone: 'main', printing_key: 'lea:289' }] }),
      first: async () => ({ id: 1 }),
    };
    this.statements.push(statement);
    return statement;
  }
}

test('collection TXT export preserves quantity and attachment headers', async () => {
  const response = await exportHostedData({ DB: new FakeDatabase() }, new URLSearchParams({ kind: 'collection', format: 'txt' }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '2 =2+2\n');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition'), /collection\.txt/);
});

test('collection CSV export quotes fields and neutralizes formulas', async () => {
  const response = await exportHostedData({ DB: new FakeDatabase() }, new URLSearchParams({ kind: 'collection', format: 'csv' }));
  const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
  assert.equal(content.charCodeAt(0), 0xfeff);
  assert.match(content, /'\=2\+2/);
  assert.match(content, /"quote, ""this""\nline"/);
  assert.match(response.headers.get('content-type'), /text\/csv/);
});

test('deck export filters to the requested zone', async () => {
  const response = await exportHostedData({ DB: new FakeDatabase() }, new URLSearchParams({
    kind: 'deck', deck_id: '1', zone: 'main', format: 'txt',
  }));
  assert.equal(await response.text(), '3 Island\n');
});