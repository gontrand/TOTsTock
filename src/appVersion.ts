export const APP_VERSION = '5.9.1';                 // version de cette application
export const EXPECTED_SCHEMA_VERSION = '2.4.1';     // version de schéma pour laquelle elle a été écrite (v51 : corrections mailing v50 & fournisseur Microsoft 365 Graph)
export const MIN_SUPPORTED_SCHEMA_VERSION = '1.0.0';// plus ancien schéma encore toléré (fenêtre N, N-1, N-2)

/**
 * Compare deux versions sémantiques "X.Y.Z" : retourne -1 si a < b, 0 si a == b, 1 si a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = String(a || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
