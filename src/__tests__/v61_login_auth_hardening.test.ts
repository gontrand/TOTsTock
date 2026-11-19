import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * v5.21.1 — durcissement de l'authentification (Option A).
 * La connexion ne doit JAMAIS contourner Supabase Auth : un échec de signInWithPassword refuse l'accès.
 * On vérifie, au niveau du source de la fonction `login`, que les trois rattrapages dangereux ont disparu :
 *   1. auto-création du compte (auth.signUp) avec le mot de passe saisi ;
 *   2. connexion sur simple profil present dans public.users quand Auth échoue ;
 *   3. auto-provisionnement d'un profil « super admin » (role_id 0) pour un compte sans profil.
 */
const ROOT_DIR = path.resolve(__dirname, '../..');
const appContext = fs.readFileSync(path.join(ROOT_DIR, 'src/context/AppContext.tsx'), 'utf8');
const clientSupabase = fs.readFileSync(path.join(ROOT_DIR, 'src/services/clientSupabase.ts'), 'utf8');

function loginBody(src: string): string {
  const start = src.indexOf('const login = useCallback');
  const end = src.indexOf('const verifyPasswordResetOtp');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('v5.21.1 — authentification durcie (le mot de passe est toujours vérifié)', () => {
  const body = loginBody(appContext);

  it('vérifie toujours le mot de passe via Supabase Auth', () => {
    expect(body).toContain('client.auth.signInWithPassword(');
  });

  it('ne crée plus automatiquement le compte (auth.signUp) au moment de la connexion', () => {
    expect(body).not.toContain('client.auth.signUp(');
  });

  it('ne connecte plus sur un simple profil de public.users quand Supabase Auth échoue', () => {
    expect(body).not.toContain('activeProfile = existingDbProfile;');
  });

  it('n’auto-provisionne plus de profil super admin (role_id 0) pour un compte sans profil', () => {
    expect(body).not.toMatch(/role_id:\s*meta\.role_id\s*\?\?\s*0/);
    // un compte authentifié sans profil est refusé, pas promu
    expect(body).toContain('Profil utilisateur introuvable');
  });

  it('refuse explicitement un échec d’authentification (message d’identifiants invalides)', () => {
    expect(body).toMatch(/Identifiants de connexion incorrects|Invalid login credentials/);
  });

  it('le compte d’amorçage (bootstrap) a un mot de passe configurable et se désactive quand un vrai admin existe', () => {
    // plus de mot de passe d'amorçage figé et comparé en dur dans le test d'égalité
    expect(body).not.toMatch(/passwordOrPin === 'admin1234'/);
    expect(body).toContain('VITE_BOOTSTRAP_ADMIN_PASSWORD');
    expect(body).toContain('realAdminExists');
    // le bootstrap n'est actif que si AUCUN vrai administrateur n'existe encore
    expect(body).toMatch(/!realAdminExists\s*&&/);
  });

  it('supprime la porte dérobée « codes figés » de la ré-authentification du remplacement de clé', () => {
    // la fonction verifyUserPinOrPasswordForKeyReplacement ne doit plus accepter de code en dur
    expect(clientSupabase).not.toMatch(/cleanSecret === '0000'/);
    expect(clientSupabase).not.toMatch(/cleanSecret === 'admin123'/);
  });
});
