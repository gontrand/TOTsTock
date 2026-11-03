import { APP_VERSION } from '../appVersion';

/**
 * Construit l'URL de téléchargement de l'APK à partir de `app_compat.update_url` et `APP_VERSION`.
 * Retourne `null` si `update_url` n'est pas configuré (auquel cas l'interface affiche
 * « Demandez le lien de téléchargement à votre administrateur »).
 */
export function buildApkDownloadUrl(
  updateUrl?: string | null,
  appVersion: string = APP_VERSION
): string | null {
  const clean = (updateUrl || '').trim();
  if (!clean) return null;

  if (/[?&]v=/.test(clean)) {
    return clean;
  }
  const separator = clean.includes('?') ? '&' : '?';
  return `${clean}${separator}v=${encodeURIComponent(appVersion)}`;
}

/**
 * Extrait une empreinte SHA-256 (64 caractères hexadécimaux) depuis le contenu brut
 * d'un fichier `.sha256` (format `sha256sum` ou empreinte seule).
 * Retourne `null` si le contenu est vide, invalide ou correspond à une page HTML (fallback SPA).
 */
export function parseApkSha256Text(rawText?: string | null): string | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // Ignorer les réponses HTML (ex: index.html renvoyé par le fallback SPA si le fichier n'existe pas)
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed) || trimmed.includes('<head>')) {
    return null;
  }

  const firstToken = trimmed.split(/\s+/)[0] || '';
  if (/^[a-fA-F0-9]{64}$/.test(firstToken)) {
    return firstToken.toLowerCase();
  }
  return null;
}

/**
 * Lit `/tot-stock.apk.sha256` s'il existe sur le serveur et retourne l'empreinte SHA-256,
 * ou `null` si le fichier est absent.
 */
export async function fetchApkSha256(
  fetchFn: typeof fetch = typeof fetch !== 'undefined' ? fetch : (undefined as unknown as typeof fetch)
): Promise<string | null> {
  if (!fetchFn) return null;
  try {
    const res = await fetchFn(`/tot-stock.apk.sha256?t=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
    });
    if (!res.ok) return null;
    const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      return null;
    }
    const text = await res.text();
    return parseApkSha256Text(text);
  } catch {
    return null;
  }
}
