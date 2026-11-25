import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../appVersion';
import { LEGAL_DOCUMENTS } from '../data/legalTerms';
import {
  LEGAL_STORAGE_KEY,
  LEGAL_VERSION,
  hasAcceptedCurrentLegal,
  readLegalAcceptance,
  saveLegalAcceptance,
} from '../services/legalAcceptance';
// @ts-expect-error module .mjs partagé avec le build
import { blankSqlTemplates, isTesterDistribution, OBFUSCATOR_OPTIONS } from '../../scripts/tester-protect.mjs';

const ROOT_DIR = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('v5.17.0 à v5.22.1 — version bêta, conditions d’utilisation et protection de l’œuvre', () => {
  it('aligne la version sur 5.23.4 (versionCode 32)', () => {
    expect(APP_VERSION).toBe('5.23.4');
    expect(JSON.parse(read('android/version-code.json')).versionCode).toBe(32);
    expect(read('android/app/build.gradle')).toContain('versionName "5.23.4"');
  });

  it('mémorise l’acceptation pour la version courante du texte et la redemande si le texte change', () => {
    const storage = memoryStorage();
    expect(hasAcceptedCurrentLegal(storage)).toBe(false);
    const rec = saveLegalAcceptance('5.23.0', storage, new Date('2026-11-18T10:00:00Z'));
    expect(rec.version).toBe(LEGAL_VERSION);
    expect(hasAcceptedCurrentLegal(storage)).toBe(true);
    storage.setItem(LEGAL_STORAGE_KEY, JSON.stringify({ version: '1999-01-01', acceptedAt: 'x', appVersion: '1' }));
    expect(hasAcceptedCurrentLegal(storage)).toBe(false);
    storage.setItem(LEGAL_STORAGE_KEY, 'pas du json');
    expect(readLegalAcceptance(storage)).toBeNull();
  });

  it('les conditions FR/EN/NL citent le contrat de test, le copyright et la limitation de responsabilité', () => {
    for (const lang of ['fr', 'en', 'nl'] as const) {
      const doc = LEGAL_DOCUMENTS[lang];
      const text = JSON.stringify(doc);
      expect(text).toContain('Contrat de mise en test – Partenariat TOT Stock');
      expect(text).toContain('Gontrand NYUNG');
      expect(doc.sections.length).toBeGreaterThanOrEqual(10);
    }
    const fr = JSON.stringify(LEGAL_DOCUMENTS.fr);
    expect(fr).toMatch(/distribution/i);
    expect(fr).toMatch(/fuite/i);
    expect(fr).toMatch(/ingénierie inverse/i);
    // v5.22.1 : interdiction explicite de contournement / désobfuscation, dans les trois langues
    expect(fr).toMatch(/désobfusquer|contourner/i);
    expect(JSON.stringify(LEGAL_DOCUMENTS.en)).toMatch(/de-obfuscate|circumvent/i);
    expect(JSON.stringify(LEGAL_DOCUMENTS.nl)).toMatch(/de-obfusceren|omzeilen/i);
  });

  it('branche l’écran d’acceptation dans main.tsx, la pastille BETA et la relecture dans À propos', () => {
    expect(read('src/main.tsx')).toContain('<LegalGate>');
    expect(read('src/components/Header.tsx')).toContain('<BetaBadge');
    expect(read('src/desktop/DesktopShell.tsx')).toContain('<BetaBadge');
    expect(read('src/components/LoginWelcomeScreen.tsx')).toContain('BETA_CONTRACT_NAME');
    expect(read('src/components/AboutAppPanel.tsx')).toContain('LegalTermsDialog');
  });

  it('l’installateur Windows affiche les conditions et exclut les fichiers .sql et .map', () => {
    const yml = read('desktop/electron-builder.yml');
    expect(yml).toContain('license: build/licence-beta.txt');
    expect(yml).toContain('!**/*.sql');
    expect(fs.existsSync(path.join(ROOT_DIR, 'desktop/build/licence-beta.txt'))).toBe(true);
  });

  it('le plugin testeurs vide les gabarits SQL et laisse le reste du code intact', () => {
    const src = [
      'const A = `CREATE TABLE IF NOT EXISTS public.x (id int);`;',
      'const B = `bonjour ${nom}`;',
      'function f() {',
      '  return `CREATE OR REPLACE FUNCTION public.g() RETURNS int AS $$ SELECT 1 $$;`;',
      '}',
    ].join('\n');
    const { code, count } = blankSqlTemplates(src);
    expect(count).toBe(2);
    expect(code).not.toMatch(/CREATE/);
    expect(code).toContain('const B = `bonjour ${nom}`;');
    expect(isTesterDistribution({ VITE_DISTRIBUTION: 'tester' })).toBe(true);
    expect(isTesterDistribution({ VITE_DISTRIBUTION: 'stable' })).toBe(false);
    expect(isTesterDistribution({})).toBe(false);
  });

  it('masque les panneaux SQL / Edge en build testeurs et branche le plugin dans vite.config.ts', () => {
    expect(read('vite.config.ts')).toContain('testerProtectPlugin');
    expect(read('src/components/EdgeFunctionsSetupPanel.tsx')).toContain('if (IS_TESTER_BUILD) return null;');
    expect(read('src/components/CompanySetupModal.tsx')).toContain('!IS_TESTER_BUILD');
    expect(read('src/desktop/pages/DesktopSettingsPage.tsx')).toContain('!IS_TESTER_BUILD');
    expect(read('src/components/DocumentationModal.tsx')).toContain('!IS_TESTER_BUILD');
    expect(read('.github/workflows/desktop-build.yml')).toContain('VITE_DISTRIBUTION');
    expect(read('.github/workflows/android-apk.yml')).toContain('VITE_DISTRIBUTION');
    expect(JSON.parse(read('package.json')).scripts['build:tester']).toBeTruthy();
  });

  it('obfusque le JavaScript du build testeurs (v5.22.1) sans renommer les propriétés (risque de casse)', () => {
    expect(JSON.parse(read('package.json')).devDependencies['javascript-obfuscator']).toBeTruthy();
    // renameProperties DOIT rester faux : l'app lit des clés dynamiques (Supabase, JSON, i18n) par leur nom.
    expect(OBFUSCATOR_OPTIONS.renameProperties).toBe(false);
    expect(OBFUSCATOR_OPTIONS.stringArray).toBe(true);
    expect(OBFUSCATOR_OPTIONS.identifierNamesGenerator).toBe('hexadecimal');
    const plugin = read('scripts/tester-protect.mjs');
    expect(plugin).toContain('export async function obfuscateBuildOutput');
    expect(plugin).toContain("await import('javascript-obfuscator')");
    const check = read('scripts/check-tester-dist.mjs');
    expect(check).toMatch(/_0x\[a-f0-9\]/);
    expect(check).toContain("aucune marque d'obfuscation détectée");
  });
});
