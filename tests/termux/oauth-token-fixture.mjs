// Test-only token endpoint. Native Pi still owns PKCE, the callback HTTP server,
// state validation, token exchange and auth.json persistence. Never preload this
// in a normal installation: it returns deliberately fake credentials.
import assert from 'node:assert/strict';
if (process.env.BASHKITTEN_TEST_OAUTH !== '1') throw Error('OAuth fixture requires an explicit test environment');
const originalFetch = globalThis.fetch;
export const exchanges = [];
globalThis.fetch = async (input, options) => {
  if (String(input) !== 'https://auth.openai.com/oauth/token') return originalFetch(input, options);
  const values = new URLSearchParams(options.body);
  assert.equal(values.get('grant_type'), 'authorization_code');
  assert.equal(values.get('redirect_uri'), 'http://localhost:1455/auth/callback');
  assert.equal(values.get('code'), 'bashkitten-local-oauth-fixture');
  assert.ok(values.get('code_verifier')?.length >= 43);
  exchanges.push(Object.fromEntries(values));
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-only-account' } })).toString('base64url');
  return Response.json({ access_token: `test-only.${payload}.not-a-real-signature`, refresh_token: 'test-only-refresh', expires_in: 3600 });
};
