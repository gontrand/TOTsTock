/**
 * Statut de diffusion de l'application (v5.17.0).
 * - IS_BETA : l'application est en phase de test (aucun client en production).
 * - IS_TESTER_BUILD : build remis aux testeurs (VITE_DISTRIBUTION=tester) — scripts SQL et fonctions Edge retirés.
 */
export const IS_BETA = true;
export const IS_TESTER_BUILD = import.meta.env.VITE_DISTRIBUTION === 'tester';

export const BETA_CONTRACT_NAME = 'Contrat de mise en test – Partenariat TOT Stock';
export const COPYRIGHT_HOLDER = 'Gontrand NYUNG';
export const COPYRIGHT_YEAR = '2026';
