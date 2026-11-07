import { describe, it, expect, beforeEach } from 'vitest';
import {
  escapeLabelHtml,
  toCanonicalPrintFormat,
  renderProductLabelsSheetHtml,
  renderOrderReadyLabelSheetHtml,
  buildFullPrintableDocumentHtml,
  CanonicalPrintLabelFormat,
  OrderReadyLabelData,
} from '../services/labelRendering';
import { Product } from '../types';
import {
  mergeClaimedPrintJobs,
  applyJobCompletionToState,
  retryFailedJobInState,
  validatePrintJobRequest,
  isPrintStationOnline,
  PrintJobRecord,
} from '../services/printStationService';
import { translations } from '../i18n/translations';
import { SQL_SCRIPT_08_PRINT_JOBS } from '../constants/supabaseScripts';
import { runPrintJobsSqlTests } from '../../tests-sql/test_08_print_jobs.mjs';

describe('Prompt v30 — Impression d’étiquettes à distance (SQL 08, labelRendering, printStationService, i18n)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });
  });

  it('exécute les suites de tests SQL PostgreSQL (00..11 idempotent, upgrade 1.0.0->2.1.0, RLS/RPC, dépôts, claim, limites, anon, dedupe_key, purge RLS v37, renommage core_/stk_ et vues de compatibilité v42)', async () => {
    const passedSuites = await runPrintJobsSqlTests();
    expect(passedSuites).toEqual([
      '1a_fresh_install_and_idempotent_two_passes_ok',
      '1b_upgrade_from_1_0_0_ok',
      '2_permission_perm_menu_print_labels_enforced',
      '3_cross_depot_print_job_blocked',
      '4_cross_station_read_and_claim_blocked',
      '5_claim_print_jobs_idempotent_single_claim',
      '6_limits_30_pending_copies_1_100_payload_2048_enforced',
      '7_anon_zero_privileges_on_tables_and_functions',
      '8_dedupe_key_prevents_duplicate_pending_jobs',
      '9_rls_purge_parasite_and_recursive_policies_and_diagnostic_ok',
      '10_legacy_db_rename_compat_views_and_drop_views_ok',
      '11_lot1_e2e_in_out_and_diagnostic_ok',
      '12_lot2_multi_depot_exact_stock_and_transfer_ok',
      '13_lot3_inventory_audit_depot_b_isolated_ok',
      '14_v41_missing_columns_recreated_and_idempotent_ok',
      '15_v41_legacy_double_count_triggers_purged_ok',
      '16_v43_inventory_audits_rls_and_tables_without_policies_ok',
    ]);
  }, 45000);

  describe('labelRendering.ts — échappement HTML & formats Avery / Thermique / Bac', () => {
    const formats: CanonicalPrintLabelFormat[] = [
      'avery_70x37',
      'avery_105x42',
      'thermal_50x30',
      'bin_90x50',
    ];

    it('échappe tous les caractères spéciaux HTML (&, <, >, ", \')', () => {
      const raw = `<script>alert("xss" & '1')</script>`;
      const escaped = escapeLabelHtml(raw);
      expect(escaped).toBe(
        '&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;1&#039;)&lt;/script&gt;'
      );
      expect(escaped).not.toContain('<script>');
    });

    it('normalise les formats anciens et nouveaux', () => {
      expect(toCanonicalPrintFormat('avery_3x8')).toBe('avery_70x37');
      expect(toCanonicalPrintFormat('avery_2x7')).toBe('avery_105x42');
      expect(toCanonicalPrintFormat('thermal')).toBe('thermal_50x30');
      expect(toCanonicalPrintFormat('bin_rack')).toBe('bin_90x50');
      expect(toCanonicalPrintFormat('thermal_50x30')).toBe('thermal_50x30');
    });

    it.each(formats)(
      'échappe les injections XSS dans les étiquettes produit pour le format %s',
      (fmt) => {
        const maliciousProduct: Product = {
          id: 'prod-xss',
          reference: `REF"><script>alert(1)</script>`,
          brand: `Brand' onload="evil()"`,
          model: `<img src=x onerror=alert(2)>Perceuse`,
          barcode: `12345<svg onload=alert(3)>`,
          store_name: `Dépôt <Nord>`,
          room_name: `Salle "A"`,
          shelf_name: `Étagère '1'`,
          unit_price: 99.5,
          quantity: 10,
          min_stock_alert: 2,
        };

        const sheetHtml = renderProductLabelsSheetHtml([maliciousProduct], {
          format: fmt,
          showQr: true,
          showBarcode: true,
          showLocation: true,
          showOem: true,
          showPrice: true,
          canViewPrices: true,
          imagesCache: {
            'prod-xss': {
              qr: 'data:image/png;base64,AAAA',
              barcode: 'data:image/png;base64,BBBB',
            },
          },
        });

        expect(sheetHtml).not.toContain('<script>');
        expect(sheetHtml).not.toContain('<img src=x');
        expect(sheetHtml).not.toContain('<svg');
        expect(sheetHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

        const docHtml = buildFullPrintableDocumentHtml(
          sheetHtml,
          fmt,
          `Planche <script>alert(9)</script>`
        );
        expect(docHtml).not.toContain('<script>');
        expect(docHtml).toContain('<!DOCTYPE html>');
      }
    );

    it.each(formats)(
      'échappe les injections XSS dans les étiquettes de commande prête pour le format %s',
      (fmt) => {
        const maliciousOrder: OrderReadyLabelData = {
          order_number: `CMD-01"><script>alert(1)</script>`,
          site_number: `CH-99<img src=x onerror=alert(1)>`,
          site_name: `Chantier "Sud" & <Est>`,
          requester_name: `Jean <script>evil()</script>`,
          pickup_zone: `Casier 'B2' <svg onload=alert(1)>`,
          depot_name: `Dépôt <Central>`,
          qrDataUrl: 'data:image/png;base64,AAAA',
        };

        const sheetHtml = renderOrderReadyLabelSheetHtml(maliciousOrder, fmt, 1);
        expect(sheetHtml).not.toContain('<script>');
        expect(sheetHtml).not.toContain('<img src=x');
        expect(sheetHtml).not.toContain('<svg');
        expect(sheetHtml).toContain('TOT-ORDER:CMD-01&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');

        const docHtml = buildFullPrintableDocumentHtml(sheetHtml, fmt, 'Commande prête');
        expect(docHtml).not.toContain('<script>');
      }
    );
  });

  describe('printStationService.ts — logique de file d’attente du poste et validation', () => {
    const sampleJob = (overrides: Partial<PrintJobRecord> = {}): PrintJobRecord => ({
      id: '11111111-1111-4111-8111-111111111111',
      station_id: '22222222-2222-4222-8222-222222222222',
      created_by: 'user-1',
      kind: 'product_label',
      format: 'avery_70x37',
      payload: { product_id: 'P1', product_ref: 'REF-001' },
      copies: 2,
      status: 'PRINTING',
      error: null,
      dedupe_key: null,
      created_at: new Date().toISOString(),
      printed_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      ...overrides,
    });

    it('gère le cycle PENDING -> PRINTING -> DONE et FAILED -> Réessayer', () => {
      let queue: PrintJobRecord[] = [];
      let history: PrintJobRecord[] = [];

      // Réclamation de job-1 et job-2 -> passent à PRINTING dans la file
      queue = mergeClaimedPrintJobs(queue, [
        sampleJob({ id: 'job-1', status: 'PENDING' }),
        sampleJob({ id: 'job-2', status: 'PENDING' }),
      ]);
      expect(queue.map((j) => j.id)).toEqual(['job-1', 'job-2']);
      expect(queue.every((j) => j.status === 'PRINTING')).toBe(true);

      // Fin réussie de job-1 -> sort de queue et passe dans history avec statut DONE
      const afterDone = applyJobCompletionToState(queue, history, 'job-1', true);
      queue = afterDone.queue;
      history = afterDone.history;
      expect(queue.map((j) => j.id)).toEqual(['job-2']);
      expect(history[0]?.id).toBe('job-1');
      expect(history[0]?.status).toBe('DONE');

      // Échec de job-2 -> sort de queue et passe dans history avec statut FAILED
      const afterFail = applyJobCompletionToState(
        queue,
        history,
        'job-2',
        false,
        'Plus de papier'
      );
      queue = afterFail.queue;
      history = afterFail.history;
      expect(queue.length).toBe(0);
      expect(history[0]?.id).toBe('job-2');
      expect(history[0]?.status).toBe('FAILED');
      expect(history[0]?.error).toBe('Plus de papier');

      // Réessayer job-2 -> réintégré dans queue en PRINTING
      const retried = retryFailedJobInState(queue, history, 'job-2');
      expect(retried.queue.map((j) => j.id)).toContain('job-2');
      expect(retried.jobToPrint?.status).toBe('PRINTING');
    });

    it('valide les paramètres de création de travail côté client (copies, format, taille <= 2048, pas de HTML)', () => {
      expect(
        validatePrintJobRequest({
          kind: 'product_label',
          format: 'avery_70x37',
          copies: 5,
          payload: { product_id: 'P1', product_ref: 'REF-1' },
        })
      ).toEqual({ valid: true });

      expect(
        validatePrintJobRequest({
          kind: 'product_label',
          format: 'avery_70x37',
          copies: 105,
          payload: { product_id: 'P1' },
        }).valid
      ).toBe(false);

      expect(
        validatePrintJobRequest({
          kind: 'product_label',
          format: 'avery_70x37',
          copies: 1,
          payload: { product_id: 'P1', bad: '<script>alert(1)</script>' },
        }).valid
      ).toBe(false);
    });

    it('calcule correctement si un poste est en ligne (< 90 secondes)', () => {
      const nowMs = Date.parse('2026-11-03T12:00:00Z');
      expect(isPrintStationOnline('2026-11-03T11:59:00Z', nowMs)).toBe(true); // 60s
      expect(isPrintStationOnline('2026-11-03T11:58:00Z', nowMs)).toBe(false); // 120s
      expect(isPrintStationOnline(null, nowMs)).toBe(false);
    });
  });

  describe('i18n — égalité stricte des clés FR / EN / NL', () => {
    it('possède exactement les mêmes clés en FR, EN et NL, y compris les clés v30', () => {
      const frKeys = Object.keys(translations.fr).sort();
      const enKeys = Object.keys(translations.en).sort();
      const nlKeys = Object.keys(translations.nl).sort();

      expect(enKeys).toEqual(frKeys);
      expect(nlKeys).toEqual(frKeys);

      const requiredV30Keys = [
        'print_station_title',
        'print_station_pending_count',
        'print_station_print_one_btn',
        'print_station_auto_mode_label',
        'scanner_print_station_label',
        'scanner_print_no_station',
        'scanner_print_product_btn',
        'scanner_print_order_checkbox',
        'scanner_print_offline_unavailable',
      ];
      for (const key of requiredV30Keys) {
        expect(translations.fr).toHaveProperty(key);
        expect(translations.en).toHaveProperty(key);
        expect(translations.nl).toHaveProperty(key);
      }
    });

    it("Prompt v35 — SQL_SCRIPT_08_PRINT_JOBS n'est pas vide et contient print_jobs, et les clés i18n FR/EN/NL du bloc Script 08 existent", () => {
      expect(typeof SQL_SCRIPT_08_PRINT_JOBS).toBe('string');
      expect(SQL_SCRIPT_08_PRINT_JOBS.trim().length).toBeGreaterThan(0);
      expect(SQL_SCRIPT_08_PRINT_JOBS).toContain('print_jobs');
      expect(SQL_SCRIPT_08_PRINT_JOBS).toContain('print_stations');

      const script08I18nKeys = [
        'sql_script_08_title',
        'sql_script_08_badge',
        'sql_script_08_desc',
        'sql_script_08_copy_btn',
        'sql_script_08_copied_btn',
        'diag_schema_1_0_0_upgrade_hint',
      ] as const;

      for (const key of script08I18nKeys) {
        expect(translations.fr[key]?.trim().length).toBeGreaterThan(0);
        expect(translations.en[key]?.trim().length).toBeGreaterThan(0);
        expect(translations.nl[key]?.trim().length).toBeGreaterThan(0);
      }

      expect(translations.fr.sql_script_08_title).toContain('08_print_jobs.sql');
      expect(translations.en.sql_script_08_title).toContain('08_print_jobs.sql');
      expect(translations.nl.sql_script_08_title).toContain('08_print_jobs.sql');
      expect(translations.fr.sql_script_08_desc).toContain('1.1.0');
      expect(translations.fr.sql_script_08_desc).toContain('1.0.0');
      expect(translations.fr.sql_script_08_desc).toContain('dist/install.sql');
    });
  });
});

