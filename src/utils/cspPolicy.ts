/**
 * Politique Content-Security-Policy (CSP) de TOT Stock (v48 — LOT 2.2).
 * Restreint les connexions réseau à 'self', aux domaines Supabase officiels
 * (`https://*.supabase.co`, `wss://*.supabase.co`), au serveur maître de licences
 * configuré et aux domaines explicites de `VITE_CSP_EXTRA_CONNECT`.
 */

export interface CspBuildOptions {
  extraConnectSrc?: string;
  masterSupabaseUrl?: string;
}

function normalizeConnectOrigin(token: string): string | null {
  const trimmed = token.trim().replace(/^["']+|["']+$/g, '');
  if (!trimmed) return null;
  if (
    trimmed.startsWith('https://*.') ||
    trimmed.startsWith('wss://*.') ||
    trimmed.startsWith('http://localhost') ||
    trimmed.startsWith('ws://localhost')
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'wss:' ||
      ((parsed.protocol === 'http:' || parsed.protocol === 'ws:') &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    ) {
      return parsed.origin;
    }
  } catch {
    // Ignore malformed token
  }
  return null;
}

export function buildContentSecurityPolicy(options?: CspBuildOptions): string {
  const connectSources = new Set<string>([
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
  ]);

  const rawMaster =
    options?.masterSupabaseUrl !== undefined
      ? options.masterSupabaseUrl
      : (typeof import.meta !== 'undefined' &&
          (import.meta as any).env?.VITE_MASTER_SUPABASE_URL) ||
        (typeof process !== 'undefined' && process.env?.VITE_MASTER_SUPABASE_URL) ||
        '';

  const masterOrigin = normalizeConnectOrigin(String(rawMaster));
  if (masterOrigin) {
    connectSources.add(masterOrigin);
    if (masterOrigin.startsWith('https://')) {
      connectSources.add(`wss://${masterOrigin.slice('https://'.length)}`);
    }
  }

  const rawExtra =
    options?.extraConnectSrc !== undefined
      ? options.extraConnectSrc
      : (typeof import.meta !== 'undefined' &&
          (import.meta as any).env?.VITE_CSP_EXTRA_CONNECT) ||
        (typeof process !== 'undefined' && process.env?.VITE_CSP_EXTRA_CONNECT) ||
        '';

  if (rawExtra) {
    for (const part of String(rawExtra).split(/[\s,]+/)) {
      const origin = normalizeConnectOrigin(part);
      if (origin) {
        connectSources.add(origin);
      }
    }
  }

  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${Array.from(connectSources).join(' ')}`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ];

  return `${directives.join('; ')};`;
}

/**
 * Met à jour dynamiquement la balise `<meta http-equiv="Content-Security-Policy">` du document
 * si des domaines supplémentaires (`VITE_CSP_EXTRA_CONNECT` ou URL Supabase client validée) sont présents.
 */
export function applyRuntimeContentSecurityPolicy(extraConnectSrc?: string): string {
  const policy = buildContentSecurityPolicy({ extraConnectSrc });
  try {
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      if (meta) {
        meta.setAttribute('content', policy);
      }
    }
  } catch {
    // Ignore DOM errors
  }
  return policy;
}
