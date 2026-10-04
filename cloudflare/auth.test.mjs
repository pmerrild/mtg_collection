import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { verifyAccessContext, verifyAccessJwt } from './src/index.ts';

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

test('rejects a token with the wrong audience or expired lifetime', async () => {
  assert.equal(await verifyAccessJwt(await token({ aud: ['different-app'] }), env, now), false);
  assert.equal(await verifyAccessJwt(await token({ exp: now }), env, now), false);
  assert.equal(await verifyAccessJwt(await token({ email: 'another-cloudflare-account@example.com' }), env, now), true);
});

test('rejects malformed and non-RS256 tokens', async () => {
  assert.equal(await verifyAccessJwt('not-a-jwt', env, now), false);
  assert.equal(await verifyAccessJwt(await token({}, { alg: 'none' }), env, now), false);
});

test('accepts Cloudflare Worker Access context for the expected audience with a signed-in identity', async () => {
  const context = {
    access: {
      aud: audience,
      getIdentity: async () => ({ email: 'OWNER@example.com' }),
    },
  };
  assert.equal(await verifyAccessContext(context, env), true);
  assert.equal(await verifyAccessContext({ access: { ...context.access, aud: 'wrong' } }, env), false);
  assert.equal(await verifyAccessContext({ access: { ...context.access, getIdentity: async () => ({ email: 'another-cloudflare-account@example.com' }) } }, env), true);
  assert.equal(await verifyAccessContext({ access: { ...context.access, getIdentity: async () => ({}) } }, env), false);
});