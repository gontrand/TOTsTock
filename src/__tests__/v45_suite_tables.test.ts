import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SQL_STEPS } from '../../scripts/build-sql.mjs';
import { TABLES } from '../constants/tables';
import { SQL_SCRIPT_11_SUITE_TABLES } from '../constants/supabaseScripts';
import { translations } from '../i18n/translations';
import {
  ALLOWED_SUITE_FILE_APPS,
  ALLOWED_DOC_CATEGORIES,
  TOT_FILES_BUCKET,
  buildSuiteFileStoragePath,
  computeFileSha256Hex,
  uploadSuiteFile,
  getSuiteFileUrl,
  listSuiteFiles,
  archiveSuiteFile,
} from '../services/filesService';
import { logOrderPreparationScan } from '../services/clientSupabase';

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Prompt v45 — TOT Stock 5.6.0 & Schéma 2.1.0 (11_suite_tables.sql, TABLES, filesService, journal de préparation)', () => {
  it('1. SQL_STEPS contient le script 11 entre 08 et 07', () => {
    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx08 = stepNumbers.indexOf('08');
    const idx11 = stepNumbers.indexOf('11');
    const idx07 = stepNumbers.indexOf('07');

    expect(idx08).toBeGreaterThanOrEqual(0);
    expect(idx11).toBeGreaterThan(idx08);
    expect(idx07).toBeGreaterThan(idx11);
    expect(idx11).toBe(idx08 + 1);
    expect(idx07).toBe(stepNumbers.length - 1);

    expect(SQL_SCRIPT_11_SUITE_TABLES).toContain('11_suite_tables.sql');
    expect(SQL_SCRIPT_11_SUITE_TABLES).toContain('CREATE TABLE IF NOT EXISTS public.core_files');
  });

  it('2. Les noms des migrations sont triés lexicographiquement dans le même ordre exact que SQL_STEPS', () => {
    const migrationNames = SQL_STEPS.map((s: any) => String(s.migrationName));
    const sortedMigrationNames = [...migrationNames].sort((a, b) => a.localeCompare(b));
    expect(migrationNames).toEqual(sortedMigrationNames);

    const migrationsDir = path.join(ROOT_DIR, 'supabase', 'migrations');
    const onDiskMigrations = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
    expect(onDiskMigrations).toEqual(migrationNames);
  });

  it('3. Chaque valeur de TABLES correspond à un CREATE TABLE d’un script SQL dans supabase-client/', () => {
    const sqlClientDir = path.join(ROOT_DIR, 'supabase-client');
    const sqlFiles = fs
      .readdirSync(sqlClientDir)
      .filter((f) => f.endsWith('.sql'));

    const allSqlContent = sqlFiles
      .map((f) => fs.readFileSync(path.join(sqlClientDir, f), 'utf8'))
      .join('\n');

    const uniqueTableNames = Array.from(new Set(Object.values(TABLES)));
    expect(uniqueTableNames.length).toBeGreaterThanOrEqual(24);

    for (const tableName of uniqueTableNames) {
      const createTableRegex = new RegExp(
        `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${tableName}\\b`,
        'i'
      );
      expect(
        createTableRegex.test(allSqlContent),
        `La table "${tableName}" déclarée dans TABLES doit avoir un CREATE TABLE dans supabase-client/*.sql`
      ).toBe(true);
    }
  });

  it('4. filesService construit un chemin qui commence obligatoirement par app et gère upload / rollback / signedUrl / list / archive', async () => {
    for (const app of ALLOWED_SUITE_FILE_APPS) {
      const storagePath = buildSuiteFileStoragePath({
        app,
        entityType: 'stk_product',
        entityId: 'PRD-0042',
        fileName: 'Fiche Technique & Photo (v1).pdf',
        uuid: '11111111-2222-4333-8444-555555555555',
      });
      expect(storagePath.startsWith(`${app}/`)).toBe(true);
      expect(storagePath.split('/')[0]).toBe(app);
      expect(storagePath).toBe(
        `${app}/stk_product/PRD-0042/11111111-2222-4333-8444-555555555555-Fiche_Technique_Photo_v1_.pdf`
      );
    }

    // Cas particulier Habilitation : employé déposant son propre document dans habilitation/self/{son id core_users}/...
    const habSelfPath = buildSuiteFileStoragePath({
      app: 'habilitation',
      entityType: 'self',
      entityId: 'usr-emp-42',
      subjectUserId: 'usr-emp-42',
      fileName: 'certificat_ba4.pdf',
      uuid: 'aaaa1111-bbbb-4ccc-8ddd-eeeeffff0000',
    });
    expect(habSelfPath).toBe(
      'habilitation/self/usr-emp-42/aaaa1111-bbbb-4ccc-8ddd-eeeeffff0000-certificat_ba4.pdf'
    );

    // Rejet d'une application non autorisée
    expect(() =>
      buildSuiteFileStoragePath({
        app: 'invalid_app' as any,
        entityType: 'doc',
        entityId: '1',
        fileName: 'test.pdf',
      })
    ).toThrow();

    // Vérification du calcul SHA-256 via crypto.subtle
    const sampleBytes = new TextEncoder().encode('TOT-SUITE-FILE-CONTENT');
    const sha256 = await computeFileSha256Hex(sampleBytes);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);

    // Vérification de uploadSuiteFile + suppression dans le bucket si l'insertion core_files échoue (pas d'orphelin)
    const removedPaths: string[] = [];
    const uploadedCalls: Array<{ path: string; options: any }> = [];

    const mockFailingInsertClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: '00000000-0000-4000-8000-000000000077' } },
        }),
      },
      storage: {
        from: (bucket: string) => {
          expect(bucket).toBe(TOT_FILES_BUCKET);
          return {
            upload: async (p: string, _file: any, options: any) => {
              uploadedCalls.push({ path: p, options });
              return { data: { path: p }, error: null };
            },
            remove: async (paths: string[]) => {
              removedPaths.push(...paths);
              return { data: paths, error: null };
            },
          };
        },
      },
      from: (table: string) => {
        if (table === TABLES.users) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'core-user-77' }, error: null }),
              }),
            }),
          };
        }
        if (table === TABLES.files) {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: 'Simulated RLS failure on core_files' },
                }),
              }),
            }),
          };
        }
        throw new Error(`Table inattendue: ${table}`);
      },
    };

    const fakeBlob = new Blob([sampleBytes], { type: 'application/pdf' }) as Blob & {
      name?: string;
    };
    fakeBlob.name = 'attestation.pdf';

    await expect(
      uploadSuiteFile({
        app: 'habilitation',
        entityType: 'hab_qualification',
        entityId: 'QUAL-01',
        file: fakeBlob,
        docCategory: 'attestation',
        client: mockFailingInsertClient as any,
      })
    ).rejects.toThrow('Simulated RLS failure on core_files');

    expect(uploadedCalls.length).toBe(1);
    expect(uploadedCalls[0].options.upsert).toBe(false);
    expect( uploadedCalls[0].path.startsWith('habilitation/hab_qualification/QUAL-01/')).toBe(true);
    // Le fichier doit avoir été supprimé du bucket après l'échec d'insertion dans core_files
    expect(removedPaths).toEqual([uploadedCalls[0].path]);

    // Vérification de getSuiteFileUrl (createSignedUrl) et archiveSuiteFile (suppression logique uniquement)
    let updatedPayload: any = null;
    const mockSuccessClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: '00000000-0000-4000-8000-000000000077' } },
        }),
      },
      storage: {
        from: () => ({
          createSignedUrl: async (storagePath: string, expiresIn: number) => ({
            data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/tot-files/${storagePath}?token=signed&exp=${expiresIn}` },
            error: null,
          }),
        }),
      },
      from: (table: string) => {
        if (table === TABLES.users) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'core-user-77' }, error: null }),
              }),
            }),
          };
        }
        if (table === TABLES.files) {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'file-uuid-1',
                      bucket: TOT_FILES_BUCKET,
                      storage_path: 'stock/stk_product/PRD-1/photo.jpg',
                      deleted_at: null,
                    },
                    error: null,
                  }),
                }),
                eq: () => ({
                  eq: () => ({
                    is: () => ({
                      order: async () => ({
                        data: [
                          {
                            id: 'file-uuid-1',
                            app: 'stock',
                            entity_type: 'stk_product',
                            entity_id: 'PRD-1',
                            deleted_at: null,
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: (vals: any) => {
              updatedPayload = vals;
              return {
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: 'file-uuid-1',
                        ...vals,
                      },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`Table inattendue: ${table}`);
      },
    };

    const signedUrl = await getSuiteFileUrl('file-uuid-1', 300, {
      client: mockSuccessClient as any,
    });
    expect(signedUrl).toContain('/object/sign/tot-files/stock/stk_product/PRD-1/photo.jpg');
    expect(signedUrl).toContain('exp=300');

    const listed = await listSuiteFiles({
      app: 'stock',
      entityType: 'stk_product',
      entityId: 'PRD-1',
      client: mockSuccessClient as any,
    });
    expect(listed.length).toBe(1);

    const archived = await archiveSuiteFile('file-uuid-1', {
      client: mockSuccessClient as any,
    });
    expect(archived.deleted_by).toBe('core-user-77');
    expect(typeof updatedPayload?.deleted_at).toBe('string');
    expect(ALLOWED_DOC_CATEGORIES).toContain('certificat');
    expect(ALLOWED_DOC_CATEGORIES).toContain('photo');
  });

  it('5. logOrderPreparationScan résout preparer_id depuis core_users et renvoie un avertissement discret sans lever d’exception en cas d’erreur', async () => {
    let insertedRows: any[] = [];
    const mockClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: '00000000-0000-4000-8000-000000000088' } },
        }),
      },
      from: (table: string) => {
        if (table === TABLES.users) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'core-preparer-88', name: 'Préparateur Magasin' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === TABLES.orderPreparationsLog) {
          return {
            insert: async (rows: any[]) => {
              insertedRows = rows;
              return { error: null };
            },
          };
        }
        throw new Error(`Table inattendue: ${table}`);
      },
    };

    const okRes = await logOrderPreparationScan(mockClient as any, {
      order_id: 'ORD-100',
      order_number: 'CMD-2026-100',
      product_id: 'PRD-01',
      product_ref: 'REF-01',
      preparer_id: 'stale-local-id',
      picked_quantity: 3,
    });
    expect(okRes.success).toBe(true);
    expect(okRes.preparerId).toBe('core-preparer-88');
    expect(insertedRows[0]?.preparer_id).toBe('core-preparer-88');

    // En cas d'erreur RLS / BD, retourne un avertissement discret sans bloquer
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockErrorClient = {
      ...mockClient,
      from: (table: string) => {
        if (table === TABLES.users) return mockClient.from(table);
        return {
          insert: async () => ({
            error: { message: 'new row violates row-level security policy' },
          }),
        };
      },
    };

    const failRes = await logOrderPreparationScan(mockErrorClient as any, {
      order_id: 'ORD-100',
      order_number: 'CMD-2026-100',
      product_id: 'PRD-01',
      product_ref: 'REF-01',
      picked_quantity: 3,
    });
    expect(failRes.success).toBe(false);
    expect(failRes.warningMessage).toContain('journal de préparation');
    warnSpy.mockRestore();
  });

  it('6. Les traductions sql_script_11_title, sql_script_11_desc et sql_script_11_copy_btn existent en fr, en et nl', () => {
    expect(translations.fr.sql_script_11_title).toBe(
      'Script 11 — Tables de la suite TOT et fichiers'
    );
    expect(translations.fr.sql_script_11_desc).toBe(
      'Crée le journal de préparation, les catégories, les lignes de commande et le stockage privé des fichiers (tot-files). À lancer après le script 08 et avant le script 07.'
    );
    expect(translations.fr.sql_script_11_copy_btn.length).toBeGreaterThan(5);
    expect(translations.en.sql_script_11_title.length).toBeGreaterThan(5);
    expect(translations.en.sql_script_11_desc.length).toBeGreaterThan(10);
    expect(translations.en.sql_script_11_copy_btn.length).toBeGreaterThan(5);
    expect(translations.nl.sql_script_11_title.length).toBeGreaterThan(5);
    expect(translations.nl.sql_script_11_desc.length).toBeGreaterThan(10);
    expect(translations.nl.sql_script_11_copy_btn.length).toBeGreaterThan(5);
  });
});
