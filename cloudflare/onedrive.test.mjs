import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import {
  authorizationUrl,
  completeOneDriveAuthorization,
  decryptToken,
  disconnectOneDrive,
  downloadPinnedWorkbook,
  encryptToken,
  listAppFolderWorkbooks,
  oneDriveStatus,
  pinAppFolderWorkbook,
  startOneDriveAuthorization,
} from './src/onedrive.ts';
import { parseInputWorkbook } from './src/xlsx.ts';
import { findQuantityReductions, mapInputSheet, workbookFingerprint } from './src/importer.ts';

class FakeStatement {
  constructor(database, query) {
    this.database = database;
    this.query = query;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.startsWith('INSERT INTO oauth_states')) {
      const [stateHash, codeVerifier, expiresAt] = this.values;
      this.database.state = { state_hash: stateHash, code_verifier: codeVerifier, expires_at: expiresAt };
    } else if (this.query.includes('INSERT INTO onedrive_connection')) {
      const [userId, email, encryptedTokens, iv, expiresAt, connectedAt] = this.values;
      this.database.connection = { user_id: userId, email, encrypted_tokens: encryptedTokens, iv, expires_at: expiresAt, connected_at: connectedAt };
    } else if (this.query.startsWith('DELETE FROM onedrive_connection')) {
      this.database.connection = null;
    } else if (this.query.startsWith('DELETE FROM onedrive_workbook')) {
      this.database.workbook = null;
    } else if (this.query.startsWith('INSERT INTO onedrive_workbook')) {
      const [driveId, itemId, name, relativePath, selectedAt] = this.values;
      this.database.workbook = {
        drive_id: driveId, item_id: itemId, name, relative_path: relativePath, selected_at: selectedAt,
      };
    }
    return {};
  }

  async first() {
    if (this.query.startsWith('SELECT user_id, email, encrypted_tokens')) {
      return this.database.connection;
    }
    if (this.query.startsWith('SELECT drive_id, item_id, name, relative_path')) {
      return this.database.workbook;
    }
    if (this.query.startsWith('DELETE FROM oauth_states')) {
      const [stateHash, now] = this.values;
      if (this.database.state?.state_hash !== stateHash || this.database.state.expires_at <= now) return null;
      const result = { code_verifier: this.database.state.code_verifier };
      this.database.state = null;
      return result;
    }
    if (this.query.startsWith('SELECT c.email, c.connected_at')) {
      const { email, connected_at } = this.database.connection || {};
      return email ? {
        email,
        connected_at,
        workbook_name: this.database.workbook?.name || null,
        workbook_path: this.database.workbook?.relative_path || null,
      } : null;
    }
    return null;
  }
}

async function connectedEnv(database) {
  const tokenKey = Buffer.alloc(32, 11).toString('base64');
  const encrypted = await encryptToken({ access_token: 'app-folder-token', refresh_token: 'refresh-token' }, tokenKey);
  database.connection = {
    user_id: 'account-id',
    email: 'owner@example.com',
    encrypted_tokens: encrypted.ciphertext,
    iv: encrypted.iv,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    connected_at: new Date().toISOString(),
  };
  return {
    DB: database,
    APP_ORIGIN: 'https://vault.example',
    MS_CLIENT_ID: 'client-id',
    MS_CLIENT_SECRET: 'client-secret',
    GRAPH_TOKEN_KEY: tokenKey,
    ALLOWED_EMAIL: 'owner@example.com',
  };
}

class FakeDatabase {
  state = null;
  connection = null;
  workbook = null;
  prepare(query) { return new FakeStatement(this, query); }
}

test('Microsoft authorization uses the registered callback and PKCE S256', () => {
  const url = new URL(authorizationUrl({ origin: 'https://vault.example' , clientId: 'client-id' }, 'state-token', 'challenge'));
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.pathname, '/consumers/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://vault.example/auth/microsoft/callback');
  assert.equal(url.searchParams.get('state'), 'state-token');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope') || '', /offline_access/);
  assert.match(url.searchParams.get('scope') || '', /Files\.ReadWrite\.AppFolder/);
  assert.doesNotMatch(url.searchParams.get('scope') || '', /Files\.ReadWrite(?!\.AppFolder)/);
});

test('OAuth tokens encrypt and decrypt with a 256-bit key', async () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const tokens = { access_token: 'access-secret', refresh_token: 'refresh-secret' };
  const encrypted = await encryptToken(tokens, key);
  assert.notEqual(encrypted.ciphertext, JSON.stringify(tokens));
  assert.deepEqual(await decryptToken(encrypted, key), tokens);
  await assert.rejects(decryptToken(encrypted, Buffer.alloc(32, 8).toString('base64')));
});

test('token encryption rejects malformed key lengths', async () => {
  await assert.rejects(encryptToken({}, Buffer.alloc(8, 1).toString('base64')), /exactly 32 bytes/);
});

test('authorization callback consumes PKCE state, verifies the allowed account, and stores encrypted tokens', async () => {
  const database = new FakeDatabase();
  const tokenKey = Buffer.alloc(32, 9).toString('base64');
  const env = {
    DB: database,
    APP_ORIGIN: 'https://vault.example',
    MS_CLIENT_ID: 'client-id',
    MS_CLIENT_SECRET: 'client-secret',
    GRAPH_TOKEN_KEY: tokenKey,
    ALLOWED_EMAIL: 'owner@example.com',
  };
  const originalFetch = globalThis.fetch;
  const tokens = { access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 3600 };
  try {
    const start = await startOneDriveAuthorization(env);
    const authorization = new URL(start.headers.get('location'));
    const state = authorization.searchParams.get('state');
    assert.equal(start.status, 302);
    assert.ok(database.state?.code_verifier);

    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/token')) return Response.json(tokens);
      if (String(input).startsWith('https://graph.microsoft.com/v1.0/me')) {
        return Response.json({ id: 'account-id', mail: 'owner@example.com' });
      }
      throw new Error('Unexpected external request');
    };

    const callback = new Request(`https://vault.example/auth/microsoft/callback?state=${state}&code=one-time-code`);
    const completed = await completeOneDriveAuthorization(callback, env);
    assert.equal(new URL(completed.headers.get('location')).searchParams.get('onedrive'), 'connected');
    assert.equal(database.state, null);
    assert.equal(database.connection.email, 'owner@example.com');
    assert.notEqual(database.connection.encrypted_tokens, JSON.stringify(tokens));
    assert.deepEqual(await decryptToken({ iv: database.connection.iv, ciphertext: database.connection.encrypted_tokens }, tokenKey), tokens);
    assert.deepEqual(await (await oneDriveStatus(env)).json(), {
      connected: true, email: 'owner@example.com', connected_at: database.connection.connected_at, workbook: null,
    });

    await disconnectOneDrive(env);
    assert.equal(database.connection, null);
    assert.equal(database.workbook, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authorization callback refuses a Microsoft account outside the Access allowlist', async () => {
  const database = new FakeDatabase();
  const env = {
    DB: database,
    APP_ORIGIN: 'https://vault.example',
    MS_CLIENT_ID: 'client-id',
    MS_CLIENT_SECRET: 'client-secret',
    GRAPH_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
    ALLOWED_EMAIL: 'owner@example.com',
  };
  const originalFetch = globalThis.fetch;
  try {
    const start = await startOneDriveAuthorization(env);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    globalThis.fetch = async (input) => String(input).endsWith('/token')
      ? Response.json({ access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 3600 })
      : Response.json({ id: 'other-id', userPrincipalName: 'other@example.com' });

    const callback = new Request(`https://vault.example/auth/microsoft/callback?state=${state}&code=one-time-code`);
    const completed = await completeOneDriveAuthorization(callback, env);
    assert.equal(new URL(completed.headers.get('location')).searchParams.get('onedrive'), 'wrong-account');
    assert.equal(database.connection, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AppFolder discovery lists workbook metadata recursively and pins only a listed item', async () => {
  const database = new FakeDatabase();
  const env = await connectedEnv(database);
  const originalFetch = globalThis.fetch;
  const requestedPaths = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requestedPaths.push(url.split('?')[0]);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer app-folder-token');
      if (url.includes('/special/approot/children')) {
        return Response.json({ value: [
          { id: 'folder-id', name: 'MTG_Collection', folder: {}, parentReference: { driveId: 'drive-id' } },
          { id: 'root-book', name: 'Vault.xlsx', file: {}, size: 100, parentReference: { driveId: 'drive-id' } },
          { id: 'other-file', name: 'notes.txt', file: {}, parentReference: { driveId: 'drive-id' } },
        ] });
      }
      if (url.includes('/items/folder-id/children')) {
        return Response.json({ value: [
          { id: 'target-book', name: 'Collection.xlsx', file: {}, size: 200, lastModifiedDateTime: '2026-10-04T10:00:00Z', parentReference: { driveId: 'drive-id' } },
          { id: 'nested-id', name: 'Archive', folder: {}, parentReference: { driveId: 'drive-id' } },
        ] });
      }
      if (url.includes('/items/nested-id/children')) {
        return Response.json({ value: [
          { id: 'old-book', name: 'Old.xlsx', file: {}, parentReference: { driveId: 'drive-id' } },
        ] });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    };

    const workbooks = await listAppFolderWorkbooks(env);
    assert.deepEqual(workbooks.map(({ item_id, path }) => ({ item_id, path })), [
      { item_id: 'old-book', path: 'MTG_Collection/Archive/Old.xlsx' },
      { item_id: 'target-book', path: 'MTG_Collection/Collection.xlsx' },
      { item_id: 'root-book', path: 'Vault.xlsx' },
    ]);
    assert.ok(requestedPaths.every((path) => path.includes('/me/drive/special/approot/children')
      || /\/me\/drive\/items\/[^/]+\/children$/.test(path)));

    const pinned = await pinAppFolderWorkbook(env, 'drive-id', 'target-book');
    assert.equal(pinned.path, 'MTG_Collection/Collection.xlsx');
    assert.equal(database.workbook?.item_id, 'target-book');
    await assert.rejects(pinAppFolderWorkbook(env, 'other-drive', 'outside-item'), /not inside the MTG Vault app folder/);
    assert.equal(database.workbook?.item_id, 'target-book');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('XLSX Input parser resolves relationships, shared strings, inline cells, and blank quantities', () => {
  const encoder = new TextEncoder();
  const workbook = zipSync({
    'xl/workbook.xml': encoder.encode('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Input" sheetId="1" r:id="rIdInput"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': encoder.encode('<Relationships><Relationship Id="rIdInput" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>'),
    'xl/sharedStrings.xml': encoder.encode('<sst><si><t>Name</t></si><si><t>Set</t></si><si><t>Sol Ring</t></si><si><t>ABC</t></si><si><r><t>Lightning </t></r><r><t>Bolt</t></r></si></sst>'),
    'xl/worksheets/sheet1.xml': encoder.encode(`<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Set</t></is></c><c r="C1" t="inlineStr"><is><t>Set#</t></is></c><c r="D1" t="inlineStr"><is><t>Count</t></is></c><c r="E1" t="inlineStr"><is><t>Foil</t></is></c><c r="F1" t="inlineStr"><is><t>Deck</t></is></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>123</v></c><c r="D2"><v>4</v></c><c r="E2"><v>2</v></c><c r="F2" t="inlineStr"><is><t>Commander</t></is></c></row>
      <row r="3"/>
      <row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>3</v></c><c r="C4"><v>77</v></c><c r="D4"/><c r="E4"/></row>
    </sheetData></worksheet>`),
  });

  const result = parseInputWorkbook(workbook);
  assert.deepEqual(result.headers, ['Name', 'Set', 'Set#', 'Count', 'Foil', 'Deck']);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    source_row: 2,
    values: { Name: 'Sol Ring', Set: 'ABC', 'Set#': 123, Count: 4, Foil: 2, Deck: 'Commander' },
  });
  assert.equal(result.rows[1].source_row, 4);
  assert.equal(result.rows[1].values.Count, null);
});

test('XLSX Input parser rejects malformed files and missing Input worksheets', () => {
  const encoder = new TextEncoder();
  assert.throws(() => parseInputWorkbook(encoder.encode('not an xlsx')), /could not be opened/);
  const workbook = zipSync({
    'xl/workbook.xml': encoder.encode('<workbook><sheets><sheet name="Collection" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': encoder.encode('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': encoder.encode('<worksheet><sheetData/></worksheet>'),
  });
  assert.throws(() => parseInputWorkbook(workbook), /no Input worksheet/);
});

test('workbook mapping preserves total foil semantics and unresolved printing rows', () => {
  const snapshot = mapInputSheet({
    headers: ['Name', 'Set', 'Set#', 'Count', 'Foil', 'Deck'],
    rows: [
      { source_row: 2, values: { Name: 'Sol Ring', Set: 'CMM', 'Set#': 123, Count: 4, Foil: 2, Deck: 'Commander' } },
      { source_row: 3, values: { Name: 'Forest', Set: 8, 'Set#': 100, Count: 3, Foil: null, Deck: '' } },
      { source_row: 4, values: { Name: 'Plains', Set: 'M21', 'Set#': 278, Count: null, Foil: null, Deck: '' } },
      { source_row: 5, values: { Name: 'Island', Set: 'M21', 'Set#': 279, Count: 2, Foil: 3, Deck: '' } },
    ],
  }, 'total');

  assert.deepEqual(snapshot.holdings.map(({ source_row, finish, quantity }) => ({ source_row, finish, quantity })), [
    { source_row: 2, finish: 'nonfoil', quantity: 2 },
    { source_row: 2, finish: 'foil', quantity: 2 },
    { source_row: 3, finish: 'nonfoil', quantity: 3 },
  ]);
  assert.equal(snapshot.holdings[2].printing_key, '8:100');
  assert.equal(snapshot.issues.length, 3);
  assert.match(snapshot.issues[0].message, /confirmed Scryfall set code/);
  assert.match(snapshot.issues[1].message, /Count is blank/);
  assert.match(snapshot.issues[2].message, /Foil count exceeds Count/);
  assert.equal(snapshot.copies, 7);
});

test('workbook mapping supports additional and flag foil modes', () => {
  const sheet = {
    headers: ['Name', 'Set', 'Set#', 'Count', 'Foil', 'Deck'],
    rows: [{ source_row: 2, values: { Name: 'Forest', Set: 'M21', 'Set#': 100, Count: 3, Foil: 2 } }],
  };
  const additional = mapInputSheet(sheet, 'additional');
  assert.deepEqual(additional.holdings.map(({ finish, quantity }) => ({ finish, quantity })), [
    { finish: 'nonfoil', quantity: 3 }, { finish: 'foil', quantity: 2 },
  ]);
  const flagged = mapInputSheet(sheet, 'flag');
  assert.deepEqual(flagged.holdings, []);
  assert.match(flagged.issues[0].message, /Foil flags must be blank, 0, or 1/);
});

test('workbook fingerprints include foil mode and reduction comparison sums duplicate rows', async () => {
  const bytes = new TextEncoder().encode('workbook-bytes');
  assert.notEqual(await workbookFingerprint(bytes, 'total'), await workbookFingerprint(bytes, 'additional'));
  assert.deepEqual(findQuantityReductions([
    { printing_key: 'cmm:123', finish: 'nonfoil', name: 'Sol Ring', quantity: 3 },
    { printing_key: 'cmm:123', finish: 'nonfoil', name: 'Sol Ring', quantity: 1 },
  ], [
    { source_row: 2, name: 'Sol Ring', card_type: '', color: '', rarity: '', set_code: 'cmm', collector_number: '123', printing_key: 'cmm:123', quantity: 2, finish: 'nonfoil', notes: '', deck_label: '' },
  ]), [{ name: 'Sol Ring', printing_key: 'cmm:123', finish: 'nonfoil', before: 4, after: 2 }]);
});

test('pinned workbook download reads only that Graph item and checks eTag stability', async () => {
  const database = new FakeDatabase();
  const env = await connectedEnv(database);
  database.workbook = {
    drive_id: 'allowed-drive', item_id: 'allowed-item', name: 'Inventory.xlsx', relative_path: 'MTG_Collection/Inventory.xlsx',
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  const bytes = new Uint8Array([1, 2, 3, 4]);
  try {
    let metadataRequests = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push(url.split('?')[0]);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer app-folder-token');
      if (url.includes('/content')) return new Response(bytes, { status: 200 });
      metadataRequests += 1;
      return Response.json({ id: 'allowed-item', name: 'Inventory.xlsx', eTag: 'etag-1', size: bytes.length });
    };

    const result = await downloadPinnedWorkbook(env);
    assert.equal(result.etag, 'etag-1');
    assert.equal(result.workbook.path, 'MTG_Collection/Inventory.xlsx');
    assert.deepEqual(result.bytes, bytes);
    assert.equal(metadataRequests, 2);
    assert.deepEqual(requests, [
      'https://graph.microsoft.com/v1.0/drives/allowed-drive/items/allowed-item',
      'https://graph.microsoft.com/v1.0/drives/allowed-drive/items/allowed-item/content',
      'https://graph.microsoft.com/v1.0/drives/allowed-drive/items/allowed-item',
    ]);

    metadataRequests = 0;
    globalThis.fetch = async (input) => {
      if (String(input).includes('/content')) return new Response(bytes, { status: 200 });
      metadataRequests += 1;
      return Response.json({ id: 'allowed-item', name: 'Inventory.xlsx', eTag: metadataRequests === 1 ? 'etag-1' : 'etag-2', size: bytes.length });
    };
    await assert.rejects(downloadPinnedWorkbook(env), /changed during download/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});