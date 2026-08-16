// OS-keychain storage for API secrets. Secrets must never be written to the
// .pulse file or config JSON — the keychain is the only persistence for them.
import { Entry } from '@napi-rs/keyring';

const SERVICE = 'Pulse SEO';

/** Keychain account names used by the API integrations. */
export const ACCOUNTS = {
  psiApiKey: 'psi-api-key',
  /** JSON: { clientId, clientSecret } for the user's Google OAuth desktop client. */
  googleClient: 'google-oauth-client',
  /** JSON: { refreshToken, email } captured by the OAuth connect flow. */
  googleToken: 'google-oauth-token',
} as const;

export function getSecret(account: string): string | null {
  try {
    return new Entry(SERVICE, account).getPassword();
  } catch {
    return null; // keyring throws when no entry exists
  }
}

export function setSecret(account: string, value: string): void {
  new Entry(SERVICE, account).setPassword(value);
}

export function deleteSecret(account: string): void {
  try {
    new Entry(SERVICE, account).deletePassword();
  } catch {
    // already absent
  }
}

export function getSecretJson<T>(account: string): T | null {
  const raw = getSecret(account);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
