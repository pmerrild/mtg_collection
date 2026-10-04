import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import worker, { verifyAccessJwt } from './src/index.ts';

const teamDomain = 'vault-team';
const audience = 'vault-access-audience';
const now = 1_800_000_000;
const env = { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience, ALLOWED_EMAIL: 'owner@example.com' };
const originalFetch = globalThis.fetch;
let privateKey;
let keyId;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function token(claimOverrides = {}, headerOverrides = {}) {
  const header = encode({ alg: 'RS256', kid: keyId, ...headerOverrides });
  const claims = encode({
    iss: `https://${teamDomain}.cloudflareaccess.com`,
    aud: [audience],
    exp: now + 600,
    nbf: now - 1,
    email: 'owner@example.com',
    ...claimOverrides,
  });
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

before(async () => {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  keyId = 'test-key';
  Object.assign(jwk, { kid: keyId, alg: 'RS256', use: 'sig' });
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
});

after(() => {
  globalThis.fetch = originalFetch;
});

test('accepts a valid signed token for the configured audience and user', async () => {
  assert.equal(await verifyAccessJwt(await token(), env, now), true);
});

test('rejects a token with the wrong audience, expired lifetime, or another user', async () => {
  assert.equal(await verifyAccessJwt(await token({ aud: ['different-app'] }), env, now), false);
  assert.equal(await verifyAccessJwt(await token({ exp: now }), env, now), false);
  assert.equal(await verifyAccessJwt(await token({ email: 'other@example.com' }), env, now), false);
});

test('rejects malformed and non-RS256 tokens', async () => {
  assert.equal(await verifyAccessJwt('not-a-jwt', env, now), false);
  assert.equal(await verifyAccessJwt(await token({}, { alg: 'none' }), env, now), false);
});

test('keeps health public and adds security headers to API and static responses', async () => {
  const app = {
    DB: { prepare: () => ({ first: async () => 1 }) },
    ASSETS: { fetch: async () => new Response('app', { headers: { 'Content-Type': 'text/html' } }) },
  };
  const health = await worker.fetch(new Request('https://vault.example/api/health'), app);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(health.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(health.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'"), true);

  const asset = await worker.fetch(new Request('https://vault.example/'), app);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('Referrer-Policy'), 'no-referrer');
});

test('rejects oversized API request bodies', async () => {
  const response = await worker.fetch(new Request('https://vault.example/api/decks', {
    method: 'POST',
    headers: { 'Content-Length': String(1024 * 1024 + 1) },
    body: 'x'.repeat(1024 * 1024 + 1),
  }), {});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { detail: 'Request body exceeds the 1 MiB limit.' });
});

test('caps streamed API bodies and still requires same-origin mutations', async () => {
  const assertion = await token();
  const app = {
    ...env,
    DB: { prepare: () => ({ first: async () => 1 }) },
    ASSETS: { fetch: async () => new Response('app') },
  };
  const tooLarge = new Request('https://vault.example/api/decks', {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': assertion,
      Origin: 'https://vault.example',
    },
    body: 'x'.repeat(1024 * 1024 + 1),
  });
  const oversizedResponse = await worker.fetch(tooLarge, app);
  assert.equal(oversizedResponse.status, 413);

  const crossOrigin = new Request('https://vault.example/api/decks', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': assertion, Origin: 'https://attacker.example' },
    body: '{}',
  });
  const crossOriginResponse = await worker.fetch(crossOrigin, app);
  assert.equal(crossOriginResponse.status, 403);
});