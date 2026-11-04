export type DesktopTargetOs = 'linux' | 'windows' | 'mac';

/**
 * Détecte le système d'exploitation courant du client pour mettre en avant
 * le système adapté dans la fenêtre d'information et les paramètres Bureau.
 */
export function detectClientDesktopOs(
  userAgentOverride?: string,
  platformOverride?: string
): DesktopTargetOs {
  const ua = (
    userAgentOverride ??
    (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '')
  ).toLowerCase();
  const platform = (
    platformOverride ??
    (typeof navigator !== 'undefined'
      ? (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ||
        navigator.platform ||
        ''
      : '')
  ).toLowerCase();

  if (ua.includes('win') || platform.includes('win')) return 'windows';
  if (ua.includes('mac') || platform.includes('mac')) return 'mac';
  return 'linux';
}

export interface InstallerUrlLookupOptions {
  updateUrl?: string | null;
  envOverride?: Record<string, unknown>;
}

function isSafeHttpOrHttpsUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Retourne l'adresse de téléchargement de l'installateur Bureau configurée par l'administrateur
 * (`VITE_DESKTOP_INSTALLER_URL`, variables par OS `VITE_DESKTOP_WIN_URL` / `VITE_DESKTOP_LINUX_URL` / `VITE_DESKTOP_MAC_URL`,
 * ou `updateUrl` compatible).
 *
 * Ne fabrique jamais de fichier binaire ni de `Blob` dans le navigateur : les installateurs officiels
 * sont construits exclusivement par `electron-builder` dans GitHub Actions (`.github/workflows/desktop-build.yml`).
 */
export function getConfiguredBinaryInstallerUrl(
  os: DesktopTargetOs = detectClientDesktopOs(),
  optionsOrUpdateUrl?: InstallerUrlLookupOptions | string | null
): string | null {
  const opts: InstallerUrlLookupOptions =
    typeof optionsOrUpdateUrl === 'string' || optionsOrUpdateUrl === null
      ? { updateUrl: optionsOrUpdateUrl }
      : optionsOrUpdateUrl || {};

  const env: Record<string, unknown> =
    opts.envOverride ??
    ((typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, unknown> }).env) ||
      {});

  const osSpecificKey =
    os === 'windows'
      ? 'VITE_DESKTOP_WIN_URL'
      : os === 'mac'
        ? 'VITE_DESKTOP_MAC_URL'
        : 'VITE_DESKTOP_LINUX_URL';

  const osSpecificVal =
    typeof env[osSpecificKey] === 'string' ? String(env[osSpecificKey]).trim() : '';
  if (osSpecificVal && isSafeHttpOrHttpsUrl(osSpecificVal)) {
    return osSpecificVal;
  }

  const genericVal =
    typeof env.VITE_DESKTOP_INSTALLER_URL === 'string'
      ? env.VITE_DESKTOP_INSTALLER_URL.trim()
      : '';
  if (genericVal && isSafeHttpOrHttpsUrl(genericVal)) {
    return genericVal;
  }

  const cleanUpdate = typeof opts.updateUrl === 'string' ? opts.updateUrl.trim() : '';
  if (cleanUpdate && isSafeHttpOrHttpsUrl(cleanUpdate)) {
    const lower = cleanUpdate.toLowerCase();
    // Ignorer les liens destinés à l'APK Android
    if (lower.endsWith('.apk')) {
      return null;
    }
    if (os === 'linux' && (lower.endsWith('.deb') || lower.endsWith('.appimage'))) {
      return cleanUpdate;
    }
    if (os === 'windows' && lower.endsWith('.exe')) {
      return cleanUpdate;
    }
    if (os === 'mac' && (lower.endsWith('.dmg') || lower.endsWith('.pkg'))) {
      return cleanUpdate;
    }
    // Page de publication générique (ex: GitHub Releases) sans extension d'un autre OS
    if (
      !lower.endsWith('.deb') &&
      !lower.endsWith('.appimage') &&
      !lower.endsWith('.exe') &&
      !lower.endsWith('.dmg') &&
      !lower.endsWith('.pkg')
    ) {
      return cleanUpdate;
    }
  }

  return null;
}
