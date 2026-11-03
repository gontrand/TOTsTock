/**
 * Pure functions and SSRF-safe ownership proof verification for the `discover`
 * action of the Master License Edge Function (`APP_TOT-Stock_licenses`).
 *
 * Security Rules:
 * 1. Proof of ownership via GET {client_supabase_url}/auth/v1/user with apikey + Bearer token.
 * 2. Strict SSRF validation: https: only, port 443, no user:pass@, no IPv4/IPv6,
 *    no localhost, no internal domains (.local, .internal, .lan, .corp, .home, .arpa, .localhost),
 *    valid domain name only, fixed path /auth/v1/user, 5s timeout, no redirects followed, max 100 KB body.
 * 3. Strict URL normalization and matching: lowercase, no trailing slash, no /rest/v1.
 *    Never matches a license with an empty client_supabase_url.
 */

export interface DiscoverUrlValidationResult {
  valid: boolean;
  normalizedUrl: string;
  projectRef: string;
  reason?: string;
}

export interface OwnershipProofResult {
  verified: boolean;
  userId?: string;
  userEmail?: string;
  normalizedUrl: string;
  reason?: string;
  httpStatus?: number;
}

const INTERNAL_TLD_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.lan',
  '.corp',
  '.home',
  '.intranet',
  '.private',
  '.localdomain',
  '.arpa',
  '.invalid',
  '.test',
  '.example',
];

function isIpAddress(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, '').trim();
  if (!clean) return false;
  // IPv6 check (contains colon)
  if (clean.includes(':')) return true;
  // Dotted-quad or numeric IPv4 check (including octal/hex/decimal integer notations)
  if (/^\d+(\.\d+){0,3}$/.test(clean)) return true;
  if (/^0x[0-9a-f]+/i.test(clean)) return true;
  // If the TLD is purely numeric, it's an IPv4 address
  const parts = clean.split('.');
  const lastPart = parts[parts.length - 1] || '';
  if (/^\d+$/.test(lastPart)) return true;
  return false;
}

function isInternalOrBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  if (!lower) return true;
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  // Must have at least one dot (valid domain with TLD)
  if (!lower.includes('.')) return true;
  if (lower.startsWith('.') || lower.endsWith('.') || lower.includes('..')) return true;

  for (const suffix of INTERNAL_TLD_SUFFIXES) {
    if (lower === suffix.slice(1) || lower.endsWith(suffix)) {
      return true;
    }
  }

  // Metadata / internal cloud endpoints
  if (
    lower === 'metadata.google.internal' ||
    lower.endsWith('.internal.cloudapp.net') ||
    lower.endsWith('.compute.internal')
  ) {
    return true;
  }

  // Validate each DNS label (RFC 1035 / 1123)
  const labels = lower.split('.');
  if (labels.length < 2) return true;
  for (const label of labels) {
    if (!label || label.length > 63) return true;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return true;
  }
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[a-z]{2,63}$/.test(tld)) return true;

  return false;
}

/**
 * Normalizes a Supabase project URL:
 * - trims whitespace
 * - lowercases
 * - strips trailing slashes
 * - strips trailing `/rest/v1` or `/auth/v1` (and any trailing slashes after)
 */
export function normalizeDiscoverTargetUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let cleaned = rawUrl.trim().toLowerCase();
  cleaned = cleaned.replace(/\/+$/, '');
  cleaned = cleaned.replace(/\/(rest|auth)\/v1(\/.*)?$/i, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
}

/**
 * Extracts the official Supabase project reference (`<ref>.supabase.co` or `<ref>.supabase.in`),
 * or returns empty string for custom domains.
 */
export function extractDiscoverProjectRef(rawUrl?: string | null): string {
  const normalized = normalizeDiscoverTargetUrl(rawUrl);
  if (!normalized) return '';
  const match = normalized.match(/^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Validates `client_supabase_url` against strict SSRF rules before any outbound network call:
 * - `https:` protocol only
 * - port 443 only (default `''` or explicit `'443'`)
 * - no credentials (`user:pass@`)
 * - no IPv4 or IPv6 literal
 * - no `localhost` or internal domain (`.local`, `.internal`, etc.)
 * - valid public domain name only
 * - no unexpected path, query string, or fragment (after stripping optional `/rest/v1`)
 */
export function validateDiscoverTargetUrl(rawUrl?: string | null): DiscoverUrlValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_EMPTY' };
  }

  const trimmed = rawUrl.trim();
  // Reject explicit credentials in the raw string before URL parsing
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(trimmed)) {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_HAS_CREDENTIALS' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_MALFORMED' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_NOT_HTTPS' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_HAS_CREDENTIALS' };
  }

  if (parsed.port !== '' && parsed.port !== '443') {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_INVALID_PORT' };
  }

  if (parsed.search || parsed.hash) {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_HAS_QUERY_OR_HASH' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isIpAddress(hostname)) {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_IS_IP_ADDRESS' };
  }

  if (isInternalOrBlockedHostname(hostname)) {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_INTERNAL_OR_INVALID_HOST' };
  }

  // Only allow root path `/` or `/rest/v1` (with optional trailing slash)
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname !== '' && pathname.toLowerCase() !== '/rest/v1') {
    return { valid: false, normalizedUrl: '', projectRef: '', reason: 'URL_UNEXPECTED_PATH' };
  }

  const normalizedUrl = `https://${hostname}`;
  const projectRef = extractDiscoverProjectRef(normalizedUrl);

  return {
    valid: true,
    normalizedUrl,
    projectRef,
  };
}

/**
 * Checks whether a stored license URL strictly matches the proven client project URL.
 * A license with an empty `client_supabase_url` is NEVER matched.
 */
export function isStrictProjectUrlMatch(
  licenseUrl?: string | null,
  provenUrl?: string | null
): boolean {
  if (!licenseUrl || typeof licenseUrl !== 'string' || !licenseUrl.trim()) {
    return false;
  }
  if (!provenUrl || typeof provenUrl !== 'string' || !provenUrl.trim()) {
    return false;
  }

  const normLicense = normalizeDiscoverTargetUrl(licenseUrl);
  const normProven = normalizeDiscoverTargetUrl(provenUrl);

  if (!normLicense || !normProven) {
    return false;
  }

  if (normLicense === normProven) {
    return true;
  }

  const licenseRef = extractDiscoverProjectRef(normLicense);
  const provenRef = extractDiscoverProjectRef(normProven);
  if (licenseRef && provenRef && licenseRef === provenRef) {
    return true;
  }

  return false;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BODY_BYTES = 100 * 1024; // 100 KB

async function readResponseWithSizeLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error('RESPONSE_TOO_LARGE');
    }
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > maxBytes) {
      throw new Error('RESPONSE_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('RESPONSE_TOO_LARGE');
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Verifies proof of project ownership by calling:
 * `GET {normalizedUrl}/auth/v1/user`
 * with headers `apikey: <clientAnonKey>` and `Authorization: Bearer <clientAccessToken>`.
 *
 * Enforces:
 * - SSRF validation prior to outbound call
 * - Fixed path `/auth/v1/user`
 * - Max timeout 5 seconds
 * - No redirects followed (`redirect: 'manual'`)
 * - Response body capped at 100 KB
 * - Only accepts HTTP 200 with a valid non-empty user `id`
 */
export async function verifyProjectOwnershipProof(params: {
  clientSupabaseUrl?: string | null;
  clientAnonKey?: string | null;
  clientAccessToken?: string | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}): Promise<OwnershipProofResult> {
  const validation = validateDiscoverTargetUrl(params.clientSupabaseUrl);
  if (!validation.valid) {
    return {
      verified: false,
      normalizedUrl: '',
      reason: validation.reason || 'INVALID_URL',
    };
  }

  const anonKey = typeof params.clientAnonKey === 'string' ? params.clientAnonKey.trim() : '';
  const accessToken = typeof params.clientAccessToken === 'string' ? params.clientAccessToken.trim() : '';

  if (!anonKey || anonKey.length < 16 || anonKey.length > 4096) {
    return {
      verified: false,
      normalizedUrl: validation.normalizedUrl,
      reason: 'INVALID_ANON_KEY',
    };
  }

  if (!accessToken || accessToken.length < 16 || accessToken.length > 8192) {
    return {
      verified: false,
      normalizedUrl: validation.normalizedUrl,
      reason: 'INVALID_ACCESS_TOKEN',
    };
  }

  const fetchImpl = params.fetchFn || globalThis.fetch;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = params.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  // Fixed path /auth/v1/user on the strictly validated origin
  const authUserEndpoint = `${validation.normalizedUrl}/auth/v1/user`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(authUserEndpoint, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    // Reject any redirect (3xx or opaqueredirect)
    if (
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400) ||
      response.redirected
    ) {
      return {
        verified: false,
        normalizedUrl: validation.normalizedUrl,
        httpStatus: response.status,
        reason: 'REDIRECT_REJECTED',
      };
    }

    if (response.status !== 200) {
      return {
        verified: false,
        normalizedUrl: validation.normalizedUrl,
        httpStatus: response.status,
        reason: `HTTP_${response.status}`,
      };
    }

    const rawBody = await readResponseWithSizeLimit(response, maxBodyBytes);
    let parsedUser: any;
    try {
      parsedUser = JSON.parse(rawBody);
    } catch {
      return {
        verified: false,
        normalizedUrl: validation.normalizedUrl,
        httpStatus: 200,
        reason: 'INVALID_JSON',
      };
    }

    const userId = typeof parsedUser?.id === 'string' ? parsedUser.id.trim() : '';
    if (!userId) {
      return {
        verified: false,
        normalizedUrl: validation.normalizedUrl,
        httpStatus: 200,
        reason: 'MISSING_USER_ID',
      };
    }

    const userEmail = typeof parsedUser?.email === 'string' ? parsedUser.email.trim() : undefined;

    return {
      verified: true,
      userId,
      userEmail,
      normalizedUrl: validation.normalizedUrl,
      httpStatus: 200,
    };
  } catch (err: any) {
    const isAbort =
      err?.name === 'AbortError' ||
      String(err?.message || '').toLowerCase().includes('abort') ||
      String(err?.message || '').toLowerCase().includes('timeout');
    if (isAbort) {
      return {
        verified: false,
        normalizedUrl: validation.normalizedUrl,
        reason: 'TIMEOUT',
      };
    }
    if (err?.message === 'RESPONSE_TOO_LARGE') {
      return {
        verified: false,
        normalizedUrl: validation.normalizedUrl,
        reason: 'RESPONSE_TOO_LARGE',
      };
    }
    return {
      verified: false,
      normalizedUrl: validation.normalizedUrl,
      reason: 'NETWORK_ERROR',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
