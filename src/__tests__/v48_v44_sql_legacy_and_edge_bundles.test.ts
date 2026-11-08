import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import {
  EDGE_FUNCTIONS,
  MASTER_EDGE_FUNCTIONS,
  formatEdgeFunctionNotFoundDetail,
  pingClientEdgeFunctions,
  pingSingleClientEdgeFunction,
} from '../constants/edgeFunctions';
import {
  EDGE_FN_BUNDLE_ADMIN_USERS,
  EDGE_FN_BUNDLE_MASTER_LICENSES,
  EDGE_FN_BUNDLE_SEND_REPORT_EMAIL,
  EDGE_FN_BUNDLE_SYNC_LICENSE,
} from '../constants/supabaseScripts';
import { CLIENT_EDGE_FUNCTION_ITEMS } from '../components/EdgeFunctionsSetupPanel';
import { verifySqlArtifactsSync } from '../../scripts/build-sql.mjs';
// @ts-ignore — module ESM de test SQL PGlite
import { runLegacySchemaSqlTests } from '../../tests-sql/test_08_print_jobs.mjs';

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('v44 — LOT 1 : Script 11 séquences dynamiques & bases héritées complètes', () => {
  it('utilise pg_get_serial_sequence dans 11_suite_tables.sql et aucun GRANT ... ON SEQUENCE en dur dans les scripts 00 à 11', () => {
    const script11Path = path.join(ROOT_DIR, 'supabase-client/11_suite_tables.sql');
    const script11Content = fs.readFileSync(script11Path, 'utf8');

    expect(script11Content).toContain("pg_get_serial_sequence('public.stk_categories', 'id')");
    expect(script11Content).not.toMatch(
      /GRANT\s+USAGE,\s*SELECT\s+ON\s+SEQUENCE\s+public\.stk_categories_id_seq/i
    );

    const sqlFiles = fs
      .readdirSync(path.join(ROOT_DIR, 'supabase-client'))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(sqlFiles.length).toBeGreaterThanOrEqual(11);

    for (const file of sqlFiles) {
      const fullPath = path.join(ROOT_DIR, 'supabase-client', file);
      const content = fs.readFileSync(fullPath, 'utf8');
      // Supprime les commentaires SQL avant de chercher un GRANT ... ON SEQUENCE en dur
      const uncommented = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--.*$/gm, '');
      const hardcodedSeqGrants = uncommented.match(/GRANT\s+[^;]*?\bON\s+SEQUENCE\s+[^;]+/gi) || [];
      for (const match of hardcodedSeqGrants) {
        // Seul format('GRANT ... ON SEQUENCE %s ...', v_seq) dans un bloc DO est autorisé
        expect(
          match.includes('%s') || match.includes('%I'),
          `Séquence en dur trouvée dans ${file}: ${match}`
        ).toBe(true);
      }
    }
  });

  it(
    'exécute sans erreur les tests SQL PGlite sur (a) categories id text sans séquence, (b) categories bigserial, (c) base neuve et (d) base héritée complète (26 tables)',
    async () => {
      const passed = await runLegacySchemaSqlTests();
      expect(passed).toEqual([
        'v44_lot1_a_legacy_categories_id_text_no_seq_two_passes_ok',
        'v44_lot1_b_legacy_categories_bigserial_two_passes_ok',
        'v44_lot1_c_fresh_db_categories_two_passes_ok',
        'v44_lot1_d_full_legacy_26_tables_varied_types_two_passes_ok',
      ]);
    },
    120_000
  );
});

describe('v44 — LOT 2 : Edge Functions livrées comme scripts autonomes et onglet 4. Fonctions Edge', () => {
  it('génère dans supabase-client/generated/edge-functions/<nom exact>/index.ts uniquement les dossiers issus de EDGE_FUNCTIONS', () => {
    const generatedEdgeDir = path.join(ROOT_DIR, 'supabase-client/generated/edge-functions');
    expect(fs.existsSync(generatedEdgeDir)).toBe(true);

    const folders = fs
      .readdirSync(generatedEdgeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const expectedFolders = Object.values(EDGE_FUNCTIONS).slice().sort();
    expect(folders).toEqual(expectedFolders);

    const masterBundlePath = path.join(
      ROOT_DIR,
      'supabase-client/generated/edge-functions-master',
      MASTER_EDGE_FUNCTIONS.licenses,
      'index.ts'
    );
    expect(fs.existsSync(masterBundlePath)).toBe(true);

    // Vérifie que verifySqlArtifactsSync (npm run build:sql -- --check) échoue si un bundle généré n'est pas à jour
    expect(verifySqlArtifactsSync(ROOT_DIR).inSync).toBe(true);
    const originalMaster = fs.readFileSync(masterBundlePath, 'utf8');
    try {
      fs.writeFileSync(masterBundlePath, `${originalMaster}\n// modifié manuellement\n`, 'utf8');
      const checkDesynced = verifySqlArtifactsSync(ROOT_DIR);
      expect(checkDesynced.inSync).toBe(false);
      expect(
        checkDesynced.errors.some((e: string) =>
          e.includes('supabase-client/generated/edge-functions-master')
        )
      ).toBe(true);
    } finally {
      fs.writeFileSync(masterBundlePath, originalMaster, 'utf8');
    }
  });

  it('garantit que chaque fichier généré dans supabase-client/generated/edge-functions/ est du TypeScript syntaxiquement valide, sans import relatif ./ ou ../_shared/, et sans déclaration dupliquée', () => {
    const generatedEdgeDir = path.join(ROOT_DIR, 'supabase-client/generated/edge-functions');
    const folderNames = Object.values(EDGE_FUNCTIONS);

    for (const folderName of folderNames) {
      const filePath = path.join(generatedEdgeDir, folderName, 'index.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      const code = fs.readFileSync(filePath, 'utf8');

      // 1. Aucun import relatif ./ ou ../_shared/
      expect(code).not.toMatch(/import\s+[\s\S]*?from\s+['"]\.\//);
      expect(code).not.toMatch(/import\s+[\s\S]*?from\s+['"]\.\.\//);
      expect(code).not.toContain('../_shared/');

      // 2. Appel serve(...) présent en fin de fichier
      expect(code).toMatch(/serve\s*\(/);

      // 3. Syntaxe TypeScript valide + absence d'identifiants en doublon via esbuild (parseur TS strict)
      const transformed = esbuild.transformSync(code, {
        loader: 'ts',
        sourcefile: `${folderName}/index.ts`,
        target: 'es2022',
        format: 'esm',
      });
      expect(transformed.code.length).toBeGreaterThan(100);
      expect(transformed.warnings).toHaveLength(0);

      // 4. Vérification additionnelle des déclarations de niveau supérieur (aucun doublon)
      const topLevelNames = new Set<string>();
      const duplicates: string[] = [];
      const declRegex =
        /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
      let match: RegExpExecArray | null;
      while ((match = declRegex.exec(code)) !== null) {
        const name = match[1];
        if (topLevelNames.has(name)) {
          duplicates.push(name);
        } else {
          topLevelNames.add(name);
        }
      }

      expect(duplicates, `Déclarations dupliquées dans ${folderName}: ${duplicates.join(', ')}`).toEqual([]);
    }
  });

  it('importe les 4 bundles ?raw dans supabaseScripts.ts et expose l’onglet « 4. Fonctions Edge » complet', () => {
    expect(EDGE_FN_BUNDLE_SYNC_LICENSE.length).toBeGreaterThan(500);
    expect(EDGE_FN_BUNDLE_ADMIN_USERS.length).toBeGreaterThan(500);
    expect(EDGE_FN_BUNDLE_SEND_REPORT_EMAIL.length).toBeGreaterThan(500);
    expect(EDGE_FN_BUNDLE_MASTER_LICENSES.length).toBeGreaterThan(500);

    expect(CLIENT_EDGE_FUNCTION_ITEMS.map((i) => i.exactName)).toEqual([
      EDGE_FUNCTIONS.syncLicense,
      EDGE_FUNCTIONS.adminUsers,
      EDGE_FUNCTIONS.sendReportEmail,
      EDGE_FUNCTIONS.passwordReset,
    ]);

    const panelContent = fs.readFileSync(
      path.join(ROOT_DIR, 'src/components/EdgeFunctionsSetupPanel.tsx'),
      'utf8'
    );
    expect(panelContent).toContain('Copier le nom');
    expect(panelContent).toContain('Copier le code TypeScript complet');
    expect(panelContent).toContain('Tester cette fonction');
    expect(panelContent).toContain('Tester les 4 fonctions');
    expect(panelContent).toContain('introuvable : créez-la avec le nom exact ci-dessus');
    expect(panelContent).toContain('déployée mais en erreur');
    expect(panelContent).toContain('TOT_LICENSE_PUBLIC_KEYS_JSON');
    expect(panelContent).toContain('BREVO_API_KEY');
    expect(panelContent).toContain('Fonction maître (éditeur uniquement)');

    const desktopSettingsContent = fs.readFileSync(
      path.join(ROOT_DIR, 'src/desktop/pages/DesktopSettingsPage.tsx'),
      'utf8'
    );
    expect(desktopSettingsContent).toContain('4. Fonctions Edge');

    const companyModalContent = fs.readFileSync(
      path.join(ROOT_DIR, 'src/components/CompanySetupModal.tsx'),
      'utf8'
    );
    expect(companyModalContent).toContain('4. Fonctions Edge');
  });

  it('affiche clairement « introuvable : créez-la avec le nom exact : APP_TOT-Stock_… (onglet 4. Fonctions Edge) » dans le diagnostic', async () => {
    const msg = formatEdgeFunctionNotFoundDetail(EDGE_FUNCTIONS.syncLicense);
    expect(msg).toContain(
      `introuvable : créez-la avec le nom exact : ${EDGE_FUNCTIONS.syncLicense} (onglet 4. Fonctions Edge)`
    );

    const fakeNotFoundClient = {
      functions: {
        invoke: async () => ({
          data: null,
          error: { status: 404, message: 'Requested function was not found' },
        }),
      },
    };

    const single = await pingSingleClientEdgeFunction(fakeNotFoundClient, 'syncLicense');
    expect(single.state).toBe('not_found');
    expect(single.detail).toContain(
      `introuvable : créez-la avec le nom exact : ${EDGE_FUNCTIONS.syncLicense} (onglet 4. Fonctions Edge)`
    );

    const summary = await pingClientEdgeFunctions(fakeNotFoundClient);
    expect(summary.status).toBe('ERREUR');
    expect(summary.details).toContain(
      `introuvable : créez-la avec le nom exact : ${EDGE_FUNCTIONS.adminUsers} (onglet 4. Fonctions Edge)`
    );
  });
});
