/**
 * Acceptation des conditions d'utilisation bêta (v5.17.0).
 * L'acceptation est mémorisée localement (poste ou appareil) pour une version précise du texte :
 * si LEGAL_VERSION change, l'utilisateur doit accepter à nouveau.
 */
export const LEGAL_VERSION = '2026-11-19';
export const LEGAL_STORAGE_KEY = 'tot.legal.acceptance';

export interface LegalAcceptanceRecord {
  version: string;
  acceptedAt: string;
  appVersion: string;
}

export function readLegalAcceptance(storage?: Pick<Storage, 'getItem'> | null): LegalAcceptanceRecord | null {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return null;
    const raw = s.getItem(LEGAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LegalAcceptanceRecord>;
    if (!parsed || typeof parsed.version !== 'string' || typeof parsed.acceptedAt !== 'string') return null;
    return {
      version: parsed.version,
      acceptedAt: parsed.acceptedAt,
      appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : '',
    };
  } catch {
    return null;
  }
}

export function hasAcceptedCurrentLegal(storage?: Pick<Storage, 'getItem'> | null): boolean {
  return readLegalAcceptance(storage)?.version === LEGAL_VERSION;
}

export function saveLegalAcceptance(
  appVersion: string,
  storage?: Pick<Storage, 'setItem'> | null,
  now: Date = new Date()
): LegalAcceptanceRecord {
  const record: LegalAcceptanceRecord = {
    version: LEGAL_VERSION,
    acceptedAt: now.toISOString(),
    appVersion,
  };
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    s?.setItem(LEGAL_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* stockage indisponible : l'acceptation sera redemandée au prochain lancement */
  }
  return record;
}
