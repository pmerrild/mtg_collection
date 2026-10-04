interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface OneDriveEnv {
  DB: D1Database;
  APP_ORIGIN?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  GRAPH_TOKEN_KEY?: string;
  ALLOWED_EMAIL?: string;
}

interface OAuthState {
  code_verifier: string;
  expires_at: number;
}

interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface MicrosoftProfile {
  id?: string;
  mail?: string | null;
  userPrincipalName?: string;
}

interface OneDriveConnection {
  user_id: string;
  email: string;
  encrypted_tokens: string;
  iv: string;
  expires_at: number;
}

interface GraphDriveItem {
  id?: string;
  name?: string;
  file?: unknown;
  folder?: unknown;
  size?: number;
  lastModifiedDateTime?: string;
  parentReference?: { driveId?: string };
}

interface GraphCollection<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface PinnedWorkbookRow {
  drive_id: string;
  item_id: string;
  name: string;
  relative_path: string;
}

interface GraphFileMetadata {
  id?: string;
  name?: string;
  eTag?: string;
  size?: number;
}

export interface AppFolderWorkbook {
  drive_id: string;
  item_id: string;
  name: string;
  path: string;
  size: number | null;
  last_modified: string | null;
}

export interface PinnedWorkbookDownload {
  workbook: AppFolderWorkbook;
  etag: string;
  bytes: Uint8Array;
}

export class OneDriveRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const microsoftOrigin = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const graphOrigin = 'https://graph.microsoft.com/v1.0';
const requestedScopes = ['offline_access', 'openid', 'profile', 'email', 'User.Read', 'Files.ReadWrite.AppFolder'];

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBuffer(new TextEncoder().encode(value))));
}

function requiredConfig(env: OneDriveEnv): { origin: string; clientId: string; clientSecret: string; tokenKey: string; email: string } {
  const origin = env.APP_ORIGIN?.trim().replace(/\/$/, '');
  const clientId = env.MS_CLIENT_ID?.trim();
  const clientSecret = env.MS_CLIENT_SECRET;
  const tokenKey = env.GRAPH_TOKEN_KEY;
  const email = env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!origin || !clientId || !clientSecret || !tokenKey || !email) {
    throw new Error('OneDrive authorization is not configured.');
  }
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost') {
    throw new Error('The app origin must use HTTPS.');
  }
  return { origin: parsedOrigin.origin, clientId, clientSecret, tokenKey, email };
}

export function authorizationUrl(config: { origin: string; clientId: string }, state: string, challenge: string): string {
  const url = new URL(`${microsoftOrigin}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: `${config.origin}/auth/microsoft/callback`,
    response_mode: 'query',
    scope: requestedScopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export async function encryptToken(value: unknown, encodedKey: string): Promise<{ iv: string; ciphertext: string }> {
  const rawKey = decodeBase64(encodedKey);
  if (rawKey.length !== 32) throw new Error('GRAPH_TOKEN_KEY must decode to exactly 32 bytes.');
  const key = await crypto.subtle.importKey('raw', arrayBuffer(rawKey), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv) }, key, arrayBuffer(plaintext));
  return { iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(ciphertext)) };
}

export async function decryptToken(encrypted: { iv: string; ciphertext: string }, encodedKey: string): Promise<unknown> {
  const rawKey = decodeBase64(encodedKey);
  if (rawKey.length !== 32) throw new Error('GRAPH_TOKEN_KEY must decode to exactly 32 bytes.');
  const key = await crypto.subtle.importKey('raw', arrayBuffer(rawKey), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: arrayBuffer(decodeBase64Url(encrypted.iv)) }, key,
    arrayBuffer(decodeBase64Url(encrypted.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function redirect(origin: string, status: string): Response {
  const destination = new URL('/', origin);
  destination.searchParams.set('onedrive', status);
  return Response.redirect(destination.toString(), 302);
}

export async function startOneDriveAuthorization(env: OneDriveEnv): Promise<Response> {
  let config: ReturnType<typeof requiredConfig>;
  try {
    config = requiredConfig(env);
  } catch (error) {
    return Response.json({ detail: (error as Error).message }, { status: 503 });
  }

  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(await sha256(verifier));
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, code_verifier, expires_at) VALUES (?, ?, ?)')
    .bind(hex(await sha256(state)), verifier, expiresAt).run();

  return Response.redirect(authorizationUrl(config, state, challenge), 302);
}

export async function completeOneDriveAuthorization(request: Request, env: OneDriveEnv): Promise<Response> {
  let config: ReturnType<typeof requiredConfig>;
  try {
    config = requiredConfig(env);
  } catch {
    return Response.json({ detail: 'OneDrive authorization is not configured.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!state || !code || url.searchParams.has('error')) {
    return redirect(config.origin, 'error');
  }

  const stateHash = hex(await sha256(state));
  const record = await env.DB.prepare(
    'DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier',
  ).bind(stateHash, Math.floor(Date.now() / 1000)).first<OAuthState>();
  if (!record?.code_verifier) return redirect(config.origin, 'error');

  const redirectUri = `${config.origin}/auth/microsoft/callback`;
  const tokenResponse = await fetch(`${microsoftOrigin}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: record.code_verifier,
      scope: requestedScopes.join(' '),
    }),
  });
  if (!tokenResponse.ok) return redirect(config.origin, 'error');
  const tokens = await tokenResponse.json() as MicrosoftTokenResponse;
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) return redirect(config.origin, 'error');

  const profileResponse = await fetch(`${graphOrigin}/me?$select=id,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) return redirect(config.origin, 'error');
  const profile = await profileResponse.json() as MicrosoftProfile;
  const accountEmail = (profile.mail || profile.userPrincipalName || '').trim().toLowerCase();
  if (!profile.id || accountEmail !== config.email) return redirect(config.origin, 'wrong-account');

  const encrypted = await encryptToken(tokens, config.tokenKey);
  const connectedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO onedrive_connection
      (id, user_id, email, encrypted_tokens, iv, expires_at, connected_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, email=excluded.email,
      encrypted_tokens=excluded.encrypted_tokens, iv=excluded.iv,
      expires_at=excluded.expires_at, connected_at=excluded.connected_at`)
    .bind(profile.id, accountEmail, encrypted.ciphertext, encrypted.iv,
      Math.floor(Date.now() / 1000) + tokens.expires_in, connectedAt).run();
  return redirect(config.origin, 'connected');
}

export async function oneDriveStatus(env: OneDriveEnv): Promise<Response> {
  const row = await env.DB.prepare(`SELECT c.email, c.connected_at, w.name AS workbook_name,
      w.relative_path AS workbook_path
    FROM onedrive_connection c LEFT JOIN onedrive_workbook w ON w.id = 1 WHERE c.id = 1`)
    .first<{ email: string; connected_at: string; workbook_name: string | null; workbook_path: string | null }>();
  return Response.json({
    connected: Boolean(row), email: row?.email ?? null, connected_at: row?.connected_at ?? null,
    workbook: row?.workbook_name ? { name: row.workbook_name, path: row.workbook_path } : null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function disconnectOneDrive(env: OneDriveEnv): Promise<Response> {
  await env.DB.prepare('DELETE FROM onedrive_connection WHERE id = 1').run();
  await env.DB.prepare('DELETE FROM onedrive_workbook WHERE id = 1').run();
  return Response.json({ disconnected: true }, { headers: { 'Cache-Control': 'no-store' } });
}

async function graphAccessToken(env: OneDriveEnv): Promise<string> {
  const config = requiredConfig(env);
  const connection = await env.DB.prepare(`SELECT user_id, email, encrypted_tokens, iv, expires_at
    FROM onedrive_connection WHERE id = 1`).first<OneDriveConnection>();
  if (!connection || connection.email !== config.email) {
    throw new OneDriveRequestError('Connect the allowed OneDrive account first.', 401);
  }

  const encrypted = { iv: connection.iv, ciphertext: connection.encrypted_tokens };
  const tokens = await decryptToken(encrypted, config.tokenKey) as MicrosoftTokenResponse;
  if (tokens.access_token && connection.expires_at > Math.floor(Date.now() / 1000) + 60) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new OneDriveRequestError('Reconnect OneDrive to continue.', 401);

  const response = await fetch(`${microsoftOrigin}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      scope: requestedScopes.join(' '),
    }),
  });
  if (!response.ok) throw new OneDriveRequestError('Reconnect OneDrive to continue.', 401);
  const refreshed = await response.json() as MicrosoftTokenResponse;
  if (!refreshed.access_token || !refreshed.expires_in) {
    throw new OneDriveRequestError('Reconnect OneDrive to continue.', 401);
  }

  const updatedTokens = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token };
  const updated = await encryptToken(updatedTokens, config.tokenKey);
  await env.DB.prepare(`UPDATE onedrive_connection SET encrypted_tokens = ?, iv = ?, expires_at = ? WHERE id = 1`)
    .bind(updated.ciphertext, updated.iv, Math.floor(Date.now() / 1000) + refreshed.expires_in).run();
  return refreshed.access_token;
}

async function graphCollection<T>(env: OneDriveEnv, path: string): Promise<T[]> {
  const token = await graphAccessToken(env);
  const values: T[] = [];
  const allowedPath = new URL(`${graphOrigin}${path}`).pathname;
  let nextUrl: string | null = `${graphOrigin}${path}`;
  while (nextUrl) {
    const url = new URL(nextUrl);
    if (url.origin !== 'https://graph.microsoft.com' || url.pathname !== allowedPath) {
      throw new OneDriveRequestError('Microsoft Graph returned an invalid page link.', 502);
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new OneDriveRequestError('Could not list files in the MTG Vault app folder.', 502);
    const page = await response.json() as GraphCollection<T>;
    if (!Array.isArray(page.value)) throw new OneDriveRequestError('Microsoft Graph returned an invalid file list.', 502);
    values.push(...page.value);
    nextUrl = page['@odata.nextLink'] || null;
  }
  return values;
}

export async function listAppFolderWorkbooks(env: OneDriveEnv): Promise<AppFolderWorkbook[]> {
  const folders = [{ id: '', path: '', depth: 0 }];
  const workbooks: AppFolderWorkbook[] = [];
  let visited = 0;

  while (folders.length) {
    const current = folders.shift()!;
    const childrenPath = current.id
      ? `/me/drive/items/${encodeURIComponent(current.id)}/children`
      : '/me/drive/special/approot/children';
    const children = await graphCollection<GraphDriveItem>(env,
      `${childrenPath}?$select=id,name,file,folder,size,lastModifiedDateTime,parentReference&$top=200`);

    for (const item of children) {
      if (!item.id || !item.name) continue;
      visited += 1;
      if (visited > 1000) throw new OneDriveRequestError('The MTG Vault app folder has too many items to scan safely.', 413);
      const path = current.path ? `${current.path}/${item.name}` : item.name;
      if (item.folder) {
        if (current.depth < 8) folders.push({ id: item.id, path, depth: current.depth + 1 });
        continue;
      }
      if (item.file && item.name.toLowerCase().endsWith('.xlsx') && item.parentReference?.driveId) {
        workbooks.push({
          drive_id: item.parentReference.driveId,
          item_id: item.id,
          name: item.name,
          path,
          size: typeof item.size === 'number' ? item.size : null,
          last_modified: item.lastModifiedDateTime || null,
        });
      }
    }
  }

  return workbooks.sort((left, right) => left.path.localeCompare(right.path));
}

export async function pinAppFolderWorkbook(
  env: OneDriveEnv,
  driveId: unknown,
  itemId: unknown,
): Promise<AppFolderWorkbook> {
  if (typeof driveId !== 'string' || !driveId || typeof itemId !== 'string' || !itemId) {
    throw new OneDriveRequestError('Choose a workbook from the MTG Vault app folder.');
  }
  const workbook = (await listAppFolderWorkbooks(env)).find(
    (candidate) => candidate.drive_id === driveId && candidate.item_id === itemId,
  );
  if (!workbook) throw new OneDriveRequestError('That workbook is not inside the MTG Vault app folder.', 404);

  await env.DB.prepare(`INSERT INTO onedrive_workbook (id, drive_id, item_id, name, relative_path, selected_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET drive_id=excluded.drive_id, item_id=excluded.item_id,
      name=excluded.name, relative_path=excluded.relative_path, selected_at=excluded.selected_at`)
    .bind(workbook.drive_id, workbook.item_id, workbook.name, workbook.path, new Date().toISOString()).run();
  return workbook;
}

export async function downloadPinnedWorkbook(env: OneDriveEnv): Promise<PinnedWorkbookDownload> {
  const pinned = await env.DB.prepare(`SELECT drive_id, item_id, name, relative_path
    FROM onedrive_workbook WHERE id = 1`).first<PinnedWorkbookRow>();
  if (!pinned) throw new OneDriveRequestError('Pin a workbook from the MTG Vault app folder first.', 409);

  const token = await graphAccessToken(env);
  const itemPath = `/drives/${encodeURIComponent(pinned.drive_id)}/items/${encodeURIComponent(pinned.item_id)}`;
  const metadataUrl = `${graphOrigin}${itemPath}?$select=id,name,eTag,size`;
  const metadataResponse = await fetch(metadataUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!metadataResponse.ok) throw new OneDriveRequestError('The pinned workbook is not available in the app folder.', 409);
  const metadata = await metadataResponse.json() as GraphFileMetadata;
  if (!metadata.id || metadata.id !== pinned.item_id || !metadata.eTag) {
    throw new OneDriveRequestError('Microsoft Graph returned invalid pinned workbook metadata.', 502);
  }
  if (typeof metadata.size === 'number' && metadata.size > 32 * 1024 * 1024) {
    throw new OneDriveRequestError('The pinned workbook exceeds the 32 MB import limit.', 413);
  }

  const contentResponse = await fetch(`${graphOrigin}${itemPath}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });
  if (!contentResponse.ok) throw new OneDriveRequestError('The pinned workbook could not be downloaded.', 502);
  const contentLength = Number(contentResponse.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > 32 * 1024 * 1024) {
    throw new OneDriveRequestError('The pinned workbook exceeds the 32 MB import limit.', 413);
  }
  const bytes = new Uint8Array(await contentResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) {
    throw new OneDriveRequestError('The pinned workbook must be a non-empty .xlsx file no larger than 32 MB.', 413);
  }

  const verifyResponse = await fetch(metadataUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!verifyResponse.ok) throw new OneDriveRequestError('The workbook changed or disappeared during download.', 409);
  const verified = await verifyResponse.json() as GraphFileMetadata;
  if (verified.id !== pinned.item_id || verified.eTag !== metadata.eTag) {
    throw new OneDriveRequestError('The workbook changed during download. Refresh and try again.', 409);
  }

  return {
    workbook: {
      drive_id: pinned.drive_id,
      item_id: pinned.item_id,
      name: metadata.name || pinned.name,
      path: pinned.relative_path,
      size: bytes.length,
      last_modified: null,
    },
    etag: metadata.eTag,
    bytes,
  };
}