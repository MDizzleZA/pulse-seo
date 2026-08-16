// Google OAuth glue for GSC + GA4. Loopback (desktop-app) flow: open the
// consent URL in the system browser, catch the redirect on a local port,
// exchange the code, and keep only the refresh token — in the OS keychain.
// Main-process only; the testable API clients receive a bare access token.
import { createServer, type Server } from 'http';
import { shell } from 'electron';
import { OAuth2Client } from 'google-auth-library';
import { ACCOUNTS, getSecret, getSecretJson, setSecret, deleteSecret } from '../credentials';

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface GoogleClientSecret {
  clientId: string;
  clientSecret: string;
}

interface GoogleToken {
  refreshToken: string;
  email: string;
}

export function googleClientSet(): boolean {
  return getSecretJson<GoogleClientSecret>(ACCOUNTS.googleClient) !== null;
}

export function googleAuthed(): { authed: boolean; email?: string } {
  const token = getSecretJson<GoogleToken>(ACCOUNTS.googleToken);
  return token ? { authed: true, email: token.email } : { authed: false };
}

export function setGoogleClient(clientId: string, clientSecret: string): void {
  setSecret(ACCOUNTS.googleClient, JSON.stringify({ clientId, clientSecret }));
}

export function disconnectGoogle(): void {
  deleteSecret(ACCOUNTS.googleToken);
}

/** Wait for Google's redirect to hit our loopback server and hand us ?code=. */
function waitForCode(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Sign-in timed out — no browser redirect received'));
    }, AUTH_TIMEOUT_MS);
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        code
          ? '<h2>Pulse SEO is connected.</h2><p>You can close this tab.</p>'
          : `<h2>Sign-in failed.</h2><p>${error ?? 'No code returned'}</p>`
      );
      clearTimeout(timer);
      if (code) resolve(code);
      else reject(new Error(error ?? 'Google returned no authorization code'));
    });
  });
}

/**
 * Run the interactive connect flow. Resolves with the signed-in email once the
 * refresh token is safely in the keychain.
 */
export async function connectGoogle(): Promise<{ ok: boolean; email?: string; error?: string }> {
  const client = getSecretJson<GoogleClientSecret>(ACCOUNTS.googleClient);
  if (!client) return { ok: false, error: 'Set the Google OAuth client ID and secret first' };

  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Loopback server failed');
    const redirectUri = `http://127.0.0.1:${address.port}`;

    const oauth = new OAuth2Client({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri,
    });
    const authUrl = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // force a refresh token even on re-consent
      scope: SCOPES,
    });
    void shell.openExternal(authUrl);

    const code = await waitForCode(server);
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      return { ok: false, error: 'Google returned no refresh token — try disconnecting the app at myaccount.google.com and reconnecting' };
    }

    oauth.setCredentials(tokens);
    let email = '';
    try {
      const info = await oauth.request<{ email?: string }>({
        url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      });
      email = info.data.email ?? '';
    } catch {
      // email is cosmetic; the connection still works without it
    }

    setSecret(ACCOUNTS.googleToken, JSON.stringify({ refreshToken: tokens.refresh_token, email }));
    return { ok: true, email };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    server.close();
  }
}

/** Mint a short-lived access token from the stored refresh token. */
export async function getAccessToken(): Promise<string> {
  const client = getSecretJson<GoogleClientSecret>(ACCOUNTS.googleClient);
  const token = getSecretJson<GoogleToken>(ACCOUNTS.googleToken);
  if (!client || !token) throw new Error('Connect a Google account first (Settings → APIs)');

  const oauth = new OAuth2Client({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
  });
  oauth.setCredentials({ refresh_token: token.refreshToken });
  const { token: accessToken } = await oauth.getAccessToken();
  if (!accessToken) throw new Error('Could not refresh the Google access token');
  return accessToken;
}

export function psiKeySet(): boolean {
  return getSecret(ACCOUNTS.psiApiKey) !== null;
}
