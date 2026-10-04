import {
  completeOneDriveAuthorization,
  disconnectOneDrive,
  listAppFolderWorkbooks,
  oneDriveStatus,
  OneDriveRequestError,
  pinAppFolderWorkbook,
  startOneDriveAuthorization,
  type OneDriveEnv,
} from './onedrive.ts';
import {
  applyStagedWorkbookImport,
  dismissStagedWorkbookImport,
  previewPinnedWorkbookImport,
} from './workbook-import.ts';
import { getHostedCollection } from './collection.ts';
import { getHostedIssues, getHostedState } from './state.ts';
import { deleteHostedDeck, hostedWishlist, saveHostedDeck, setHostedDeckActive } from './decks.ts';
import { confirmHostedMatch, searchScryfallCards, syncHostedScryfall } from './scryfall.ts';
import { exportHostedData } from './export.ts';

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env extends OneDriveEnv {
  ASSETS: AssetFetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAIL?: string;
}

interface AccessIdentity {
  email?: string | null;
}

interface AccessContext {
  aud?: string;
  getIdentity(): Promise<AccessIdentity | null>;
}

interface WorkerContext {
  access?: AccessContext;
}

interface AccessJwk {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

interface AccessClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  email?: string;
}

const keyCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>();

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function accessKeys(teamDomain: string): Promise<AccessJwk[]> {
  const cached = keyCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Could not retrieve the Access signing keys.');
  const document = await response.json() as { keys?: AccessJwk[] };
  if (!Array.isArray(document.keys)) throw new Error('Access signing keys are malformed.');
  keyCache.set(teamDomain, { keys: document.keys, expiresAt: Date.now() + 5 * 60 * 1000 });
  return document.keys;
}

export async function verifyAccessJwt(token: string, env: Env, nowSeconds = Date.now() / 1000): Promise<boolean> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  if (!teamDomain || !/^[a-z0-9-]+$/.test(teamDomain) || !audience) return false;

  try {
    const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split('.');
    if (!encodedHeader || !encodedClaims || !encodedSignature || extra !== undefined) return false;
    const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
    const claims = decodeJson<AccessClaims>(encodedClaims);
    if (header.alg !== 'RS256' || !header.kid) return false;

    const issuer = `https://${teamDomain}.cloudflareaccess.com`;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audiences.includes(audience)) return false;
    if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) return false;
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > nowSeconds + 60)) return false;
    if (typeof claims.email !== 'string' || !claims.email.trim()) return false;

    const jwk = (await accessKeys(teamDomain)).find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey(
      'jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    const signedContent = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey,
      arrayBuffer(decodeBase64Url(encodedSignature)), arrayBuffer(signedContent));
  } catch {
    return false;
  }
}

export async function verifyAccessContext(context: WorkerContext, env: Env): Promise<boolean> {
  const audience = env.ACCESS_AUD?.trim();
  if (!context.access || !audience || context.access.aud !== audience) return false;
  try {
    const identity = await context.access.getIdentity();
    return typeof identity?.email === 'string' && Boolean(identity.email.trim());
  } catch {
    return false;
  }
}

async function accessAllowed(request: Request, env: Env, context: WorkerContext): Promise<boolean> {
  if (context.access) return verifyAccessContext(context, env);
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  return assertion ? verifyAccessJwt(assertion, env) : false;
}

export default {
  async fetch(request: Request, env: Env, context: WorkerContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return json({ status: 'ok', database: 'connected' });
      } catch {
        return json({ status: 'unavailable', database: 'unavailable' }, 503);
      }
    }

    if (url.pathname === '/auth/microsoft/callback' && request.method === 'GET') {
      try {
        return await completeOneDriveAuthorization(request, env);
      } catch {
        const origin = env.APP_ORIGIN?.trim().replace(/\/$/, '');
        if (!origin) return json({ detail: 'OneDrive authorization failed.' }, 503);
        const destination = new URL('/', origin);
        destination.searchParams.set('onedrive', 'error');
        return Response.redirect(destination.toString(), 302);
      }
    }

    if (url.pathname === '/auth/microsoft/connect' && request.method === 'GET') {
      if (!(await accessAllowed(request, env, context))) {
        return json({ detail: 'Sign in through the configured private access policy.' }, 401);
      }
      try {
        return await startOneDriveAuthorization(env);
      } catch {
        return json({ detail: 'OneDrive authorization could not be started.' }, 503);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      if (!(await accessAllowed(request, env, context))) {
        return json({ detail: 'Sign in through the configured private access policy.' }, 401);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD'
        && request.headers.get('Origin') !== url.origin) {
        return json({ detail: 'Cross-origin requests are not allowed.' }, 403);
      }
      if (url.pathname === '/api/onedrive/status' && request.method === 'GET') {
        try {
          return await oneDriveStatus(env);
        } catch {
          return json({ detail: 'OneDrive connection status is unavailable.' }, 503);
        }
      }
      if (url.pathname === '/api/collection' && request.method === 'GET') {
        try {
          return json(await getHostedCollection(env));
        } catch {
          return json({ detail: 'Hosted collection data is unavailable.' }, 503);
        }
      }
      if (url.pathname === '/api/export' && request.method === 'GET') {
        try {
          return await exportHostedData(env, url.searchParams);
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Export is unavailable.' }, status);
        }
      }
      if (url.pathname === '/api/state' && request.method === 'GET') {
        try {
          return json(await getHostedState(env));
        } catch {
          return json({ detail: 'Hosted application state is unavailable.' }, 503);
        }
      }
      if (url.pathname === '/api/issues' && request.method === 'GET') {
        try {
          return json(await getHostedIssues(env));
        } catch {
          return json({ detail: 'Hosted import review is unavailable.' }, 503);
        }
      }
      if (url.pathname === '/api/wishlist' && request.method === 'GET') {
        const rawDeckIds = url.searchParams.get('deck_ids') || '';
        const deckIds = rawDeckIds ? rawDeckIds.split(',').map((value) => Number(value)) : [];
        if (deckIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
          return json({ detail: 'Deck IDs must be positive integers.' }, 400);
        }
        try {
          return json(await hostedWishlist(env, deckIds, url.searchParams.get('mode') || 'assembled'));
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Wishlist is unavailable.' }, status);
        }
      }
      if (url.pathname === '/api/cards/search' && request.method === 'GET') {
        try {
          return json(await searchScryfallCards(url.searchParams.get('q') || ''));
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Scryfall search failed.' }, status);
        }
      }
      if (url.pathname === '/api/scryfall/sync' && request.method === 'POST') {
        try {
          return json(await syncHostedScryfall(env));
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Scryfall sync failed.' }, status);
        }
      }
      if (url.pathname === '/api/matches/confirm' && request.method === 'POST') {
        let selection: { printing_key?: unknown; card_id?: unknown };
        try {
          selection = await request.json() as { printing_key?: unknown; card_id?: unknown };
        } catch {
          return json({ detail: 'Select a Scryfall printing first.' }, 400);
        }
        try {
          return json(await confirmHostedMatch(env, selection.printing_key, selection.card_id));
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Printing could not be confirmed.' }, status);
        }
      }
      if (url.pathname === '/api/decks' && request.method === 'POST') {
        try {
          const data = await request.json() as Record<string, unknown>;
          return json(await saveHostedDeck(env, data), 201);
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 400;
          return json({ detail: error instanceof Error ? error.message : 'Deck could not be saved.' }, status);
        }
      }
      const deckRoute = url.pathname.match(/^\/api\/decks\/(\d+)(?:\/(active))?$/);
      if (deckRoute) {
        const deckId = Number(deckRoute[1]);
        try {
          if (deckRoute[2] === 'active' && request.method === 'POST') {
            const data = await request.json() as { active?: unknown };
            return json(await setHostedDeckActive(env, deckId, data.active));
          }
          if (!deckRoute[2] && request.method === 'PUT') {
            const data = await request.json() as Record<string, unknown>;
            return json(await saveHostedDeck(env, data, deckId));
          }
          if (!deckRoute[2] && request.method === 'DELETE') {
            return json(await deleteHostedDeck(env, deckId));
          }
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 400;
          return json({ detail: error instanceof Error ? error.message : 'Deck action failed.' }, status);
        }
      }
      if (url.pathname === '/api/onedrive/workbooks' && request.method === 'GET') {
        try {
          return json({ workbooks: await listAppFolderWorkbooks(env) });
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Workbook list is unavailable.' }, status);
        }
      }
      if (url.pathname === '/api/onedrive/workbook' && request.method === 'POST') {
        let selection: { drive_id?: unknown; item_id?: unknown };
        try {
          selection = await request.json() as { drive_id?: unknown; item_id?: unknown };
        } catch {
          return json({ detail: 'Choose a workbook from the MTG Vault app folder.' }, 400);
        }
        try {
          const workbook = await pinAppFolderWorkbook(env, selection.drive_id, selection.item_id);
          return json({ workbook: { name: workbook.name, path: workbook.path } });
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Workbook could not be selected.' }, status);
        }
      }
      if (url.pathname === '/api/onedrive/import/preview' && request.method === 'POST') {
        try {
          return json(await previewPinnedWorkbookImport(env));
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Workbook preview is unavailable.' }, status);
        }
      }
      const importAction = url.pathname.match(/^\/api\/onedrive\/imports\/(\d+)\/(apply|dismiss)$/);
      if (importAction && request.method === 'POST') {
        try {
          const importId = Number(importAction[1]);
          if (importAction[2] === 'apply') return json(await applyStagedWorkbookImport(env, importId));
          return json(await dismissStagedWorkbookImport(env, importId));
        } catch (error) {
          const status = error instanceof OneDriveRequestError ? error.status : 503;
          return json({ detail: error instanceof Error ? error.message : 'Workbook import action failed.' }, status);
        }
      }
      if (url.pathname === '/api/onedrive/disconnect' && request.method === 'POST') {
        try {
          return await disconnectOneDrive(env);
        } catch {
          return json({ detail: 'OneDrive could not be disconnected.' }, 503);
        }
      }
      return json({ detail: 'This hosted API route has not been migrated yet.' }, 501);
    }

    return env.ASSETS.fetch(request);
  },
};