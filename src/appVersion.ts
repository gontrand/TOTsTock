export const APP_VERSION = '5.13.0';                // version de cette application
export const EXPECTED_SCHEMA_VERSION = '2.7.0';     // version de schéma pour laquelle elle a été écrite (v54/v54b : transferts validés à la réception, responsables de dépôt & droits fins)
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
