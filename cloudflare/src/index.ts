interface D1PreparedStatement {
  first<T = unknown>(columnName?: string): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  DB: D1Database;
  ASSETS: AssetFetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAIL?: string;
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
  email: string;
}

const MAX_API_BODY_BYTES = 1024 * 1024;
const keyCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>();

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: securityHeaders({ 'Cache-Control': 'no-store' }),
  });
}

function securityHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cards.scryfall.io; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  return headers;
}

function secure(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: securityHeaders(response.headers),
  });
}

async function boundedBody(request: Request): Promise<Request | null> {
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_API_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  return new Request(request, { headers, body });
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
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
  const allowedEmail = env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!teamDomain || !/^[a-z0-9-]+$/.test(teamDomain) || !audience || !allowedEmail) return false;

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
    if (typeof claims.email !== 'string' || claims.email.trim().toLowerCase() !== allowedEmail) return false;

    const jwk = (await accessKeys(teamDomain)).find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey(
      'jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    const signedContent = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64Url(encodedSignature), signedContent);
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return json({ status: 'ok', database: 'connected' });
      } catch {
        return json({ status: 'unavailable', database: 'unavailable' }, 503);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      const contentLength = request.headers.get('Content-Length');
      if (contentLength !== null && Number(contentLength) > MAX_API_BODY_BYTES) {
        return json({ detail: 'Request body exceeds the 1 MiB limit.' }, 413);
      }

      const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
      if (!assertion || !(await verifyAccessJwt(assertion, env))) {
        return json({ detail: 'Sign in through the configured private access policy.' }, 401);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD'
        && request.headers.get('Origin') !== url.origin) {
        return json({ detail: 'Cross-origin requests are not allowed.' }, 403);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const requestWithBoundedBody = await boundedBody(request);
        if (!requestWithBoundedBody) {
          return json({ detail: 'Request body exceeds the 1 MiB limit.' }, 413);
        }
      }
      return json({ detail: 'This hosted API route has not been migrated yet.' }, 501);
    }

    return secure(await env.ASSETS.fetch(request));
  },
};