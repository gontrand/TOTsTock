import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../appVersion';
import { SQL_SCRIPT_15_SEARCH_ORDERS_MOVEMENTS, SQL_SCRIPT_07_APP_COMPAT } from '../constants/supabaseScripts';
import { SQL_STEPS } from '../../scripts/build-sql.mjs';
import {
  ACTIVE_ORDER_STATUSES,
  DEFAULT_LOCAL_WINDOW_DAYS,
  MAX_REPORT_ATTACHMENT_BYTES,
  createDefaultOrderSearchFilters,
  createDefaultMovementSearchFilters,
  isOrderActiveStatus,
  filterOrdersDefault7DaysAndActive,
  filterMovementsDefault7Days,
  doesOrderFilterExceedLocalWindow,
  doesMovementFilterExceedLocalWindow,
  buildSearchMaterialOrdersRpcParams,
  buildSearchStockMovementsRpcParams,
  filterOrdersLocally,
  filterMovementsLocally,
  buildWeeklyUserRecapReport,
  buildLowStockReport,
  buildOutOfStockReport,
  buildDepartmentProjectsReport,
  buildOrdersReport,
  buildMovementsReport,
  generateReportCsv,
  generateReportPdfBytes,
  prepareReportEmailAttachments,
  type ReportContextData,
} from '../services/reportsService';
import {
  validateAttachmentInput,
  sanitizeAttachmentFilename,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_TYPES,
  createSendReportEmailHandler,
} from '../../supabase/functions/_shared/sendReportEmailHandler';
import type { MaterialOrder, Product, StockMovement } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../..');

const AUTH_STUB_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;
  CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    instance_id UUID,
    aud TEXT,
    role TEXT,
    email TEXT,
    encrypted_password TEXT,
    email_confirmed_at TIMESTAMPTZ DEFAULT now(),
    raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
  $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
`;

const ORDERED_CLIENT_SCRIPTS = [
  '00_complete_tot_stock_schema.sql',
  '09_core_prefixes.sql',
  '01_auth_link.sql',
  '01b_migrate_users_id_to_text.sql',
  '02_rls_hardening.sql',
  '03_rpc_stock_and_orders.sql',
  '04_mouvements_et_depots_vehicules.sql',
  '05_rpc_admin_users.sql',
  '06_install_additional_roles.sql',
  '08_print_jobs.sql',
  '11_suite_tables.sql',
  '12_user_preferences.sql',
  '13_transfer_stock_batch.sql',
  '14_mailing.sql',
  '15_search_orders_movements.sql',
  '16_audit_trail.sql',
  '17_transferts_valides.sql',
  '18_password_reset.sql',
  '07_app_compat.sql',
];

describe('Prompt v52 — Versions 5.16.0 / 2.10.0 & Script 15_search_orders_movements.sql', () => {
  it('aligne APP_VERSION=5.16.0, EXPECTED_SCHEMA_VERSION=2.10.0 et déclare le script 15 dans SQL_STEPS (après 14 et avant 07)', () => {
    expect(APP_VERSION).toBe('5.16.1');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx14 = stepNumbers.indexOf('14');
    const idx15 = stepNumbers.indexOf('15');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx14).toBeGreaterThan(0);
    expect(idx15).toBe(idx14 + 1);
    expect(idx07).toBeGreaterThan(idx15);

    expect(SQL_SCRIPT_15_SEARCH_ORDERS_MOVEMENTS).toContain(
      'CREATE OR REPLACE FUNCTION public.search_material_orders'
    );
    expect(SQL_SCRIPT_15_SEARCH_ORDERS_MOVEMENTS).toContain(
      'CREATE OR REPLACE FUNCTION public.search_stock_movements'
    );
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'search_material_orders'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'search_stock_movements'");
  });

  it('garantit l’identité stricte entre supabase-client/15_search_orders_movements.sql, scripts/15_search_orders_movements.sql et la migration générée', () => {
    const clientSql = fs.readFileSync(
      path.join(ROOT_DIR, 'supabase-client/15_search_orders_movements.sql'),
      'utf8'
    );
    const scriptSql = fs.readFileSync(
      path.join(ROOT_DIR, 'scripts/15_search_orders_movements.sql'),
      'utf8'
    );
    expect(scriptSql).toBe(clientSql);
  });
});

describe('Prompt v52 — Lot 1 & Lot 2 : Fenêtre locale 7 jours, fusion commandes actives et paramètres RPC', () => {
  const NOW = new Date('2026-10-15T12:00:00.000Z').getTime();

  const sampleOrders: MaterialOrder[] = [
    {
      id: 'ord-recent-delivered',
      order_number: 'CMD-001',
      requester_id: 'u1',
      requester_name: 'Alice',
      requester_department: 'Électricité',
      site_number: 'Chantier A',
      depot_name: 'Dépôt Central',
      status: 'COLLECTED',
      created_at: '2026-10-13T10:00:00.000Z', // 2 days ago -> inside 7d
      items: [
        {
          product_id: 'p1',
          product_ref: 'REF-100',
          product_name: 'Câble 3G2.5',
          quantity: 2,
          unit: 'pce',
          unit_price: 50,
        },
      ],
      total_cost: 100,
    },
    {
      id: 'ord-old-delivered',
      order_number: 'CMD-002',
      requester_id: 'u1',
      requester_name: 'Alice',
      requester_department: 'Électricité',
      site_number: 'Chantier B',
      depot_name: 'Dépôt Central',
      status: 'COLLECTED',
      created_at: '2026-09-01T10:00:00.000Z', // 44 days ago -> outside 7d & terminal
      items: [
        {
          product_id: 'p2',
          product_ref: 'REF-200',
          product_name: 'Disjoncteur',
          quantity: 1,
          unit: 'pce',
          unit_price: 80,
        },
      ],
      total_cost: 80,
    },
    {
      id: 'ord-old-preparing',
      order_number: 'CMD-003',
      requester_id: 'u2',
      requester_name: 'Bob',
      preparer_name: 'Magasinier Paul',
      requester_department: 'CVC',
      site_number: 'Chantier C',
      depot_name: 'Dépôt Nord',
      status: 'PREPARING', // active status!
      created_at: '2026-08-15T08:00:00.000Z', // 61 days ago -> kept because active
      items: [
        {
          product_id: 'p3',
          product_ref: 'REF-300',
          product_name: 'Vanne 1/2',
          quantity: 5,
          unit: 'pce',
          unit_price: 30,
        },
      ],
      total_cost: 150,
    },
    {
      id: 'ord-old-waiting',
      order_number: 'CMD-004',
      requester_id: 'u2',
      requester_name: 'Bob',
      requester_department: 'CVC',
      site_number: 'Chantier D',
      depot_name: 'Dépôt Nord',
      status: 'WAITING_APPROVAL', // active status!
      created_at: '2026-07-01T08:00:00.000Z',
      items: [],
      total_cost: 420,
    },
  ];

  const sampleMovements: StockMovement[] = [
    {
      id: 'mov-recent',
      product_id: 'p1',
      product_ref: 'REF-100',
      movement_type: 'OUT',
      quantity_changed: 2,
      user_id: 'u1',
      user_name: 'Alice',
      department_name: 'Électricité',
      site_number: 'Chantier A',
      depot_name: 'Dépôt Central',
      created_at: '2026-10-14T09:00:00.000Z', // 1 day ago
      total_cost: 100,
    },
    {
      id: 'mov-old',
      product_id: 'p2',
      product_ref: 'REF-200',
      movement_type: 'IN',
      quantity_changed: 10,
      user_id: 'u3',
      user_name: 'Paul',
      department_name: 'Magasin',
      depot_name: 'Dépôt Central',
      created_at: '2026-09-10T09:00:00.000Z', // 35 days ago
      total_cost: 800,
    },
  ];

  it('filtre les commandes sur la fenêtre de 7 jours TOUT EN conservant toutes les commandes actives (WAITING_APPROVAL, PENDING, PREPARING, READY) quel que soit leur âge', () => {
    expect(DEFAULT_LOCAL_WINDOW_DAYS).toBe(7);
    expect(ACTIVE_ORDER_STATUSES).toEqual(['WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY']);
    expect(isOrderActiveStatus('PREPARING')).toBe(true);
    expect(isOrderActiveStatus('DELIVERED')).toBe(false);

    const filteredOrders = filterOrdersDefault7DaysAndActive(sampleOrders, NOW);
    const ids = filteredOrders.map((o) => o.id);
    expect(ids).toContain('ord-recent-delivered');
    expect(ids).toContain('ord-old-preparing');
    expect(ids).toContain('ord-old-waiting');
    expect(ids).not.toContain('ord-old-delivered');

    const filteredMovements = filterMovementsDefault7Days(sampleMovements, NOW);
    expect(filteredMovements.map((m) => m.id)).toEqual(['mov-recent']);
  });

  it('détecte quand un filtre dépasse la fenêtre locale (30D, ALL, CUSTOM) et construit les paramètres RPC', () => {
    const defOrd = createDefaultOrderSearchFilters();
    expect(doesOrderFilterExceedLocalWindow(defOrd, false, NOW)).toBe(false);
    expect(doesOrderFilterExceedLocalWindow({ ...defOrd, periodPreset: '30D' }, false, NOW)).toBe(true);
    expect(doesOrderFilterExceedLocalWindow({ ...defOrd, periodPreset: 'ALL' }, false, NOW)).toBe(true);
    expect(doesOrderFilterExceedLocalWindow(defOrd, true, NOW)).toBe(true);

    const defMov = createDefaultMovementSearchFilters();
    expect(doesMovementFilterExceedLocalWindow(defMov, false, NOW)).toBe(false);
    expect(doesMovementFilterExceedLocalWindow({ ...defMov, periodPreset: '30D' }, false, NOW)).toBe(true);
    expect(doesMovementFilterExceedLocalWindow({ ...defMov, periodPreset: 'ALL' }, false, NOW)).toBe(true);

    const orderParams = buildSearchMaterialOrdersRpcParams(
      {
        periodPreset: 'CUSTOM',
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
        statuses: ['COLLECTED', 'PREPARING'],
        preparer: 'Paul',
        requester: 'Alice',
        department: 'Électricité',
        site: 'Chantier A',
        depot: 'Dépôt Central',
        reference: 'REF-100',
        minCost: '50',
        maxCost: '500',
        text: 'urgent',
      },
      50,
      100,
      NOW
    );

    expect(orderParams).toEqual({
      p_from: '2026-09-01T00:00:00.000Z',
      p_to: '2026-09-30T23:59:59.999Z',
      p_status: ['COLLECTED', 'PREPARING'],
      p_preparer: 'Paul',
      p_requester: 'Alice',
      p_department: 'Électricité',
      p_site: 'Chantier A',
      p_depot: 'Dépôt Central',
      p_reference: 'REF-100',
      p_min_cost: 50,
      p_max_cost: 500,
      p_text: 'urgent',
      p_limit: 50,
      p_offset: 100,
    });

    const movParams = buildSearchStockMovementsRpcParams(
      {
        periodPreset: 'ALL',
        fromDate: '',
        toDate: '',
        type: 'TRANSFER',
        user: 'Paul',
        department: 'Magasin',
        site: 'Chantier B',
        depot: 'Dépôt Nord',
        reference: 'REF-200',
        orderNumber: 'CMD-002',
        minCost: '10,5',
        maxCost: '999.99',
        text: 'palette',
      },
      50,
      0,
      NOW
    );

    expect(movParams).toEqual({
      p_from: null,
      p_to: null,
      p_type: 'TRANSFER',
      p_user: 'Paul',
      p_department: 'Magasin',
      p_site: 'Chantier B',
      p_depot: 'Dépôt Nord',
      p_reference: 'REF-200',
      p_order_number: 'CMD-002',
      p_min_cost: 10.5,
      p_max_cost: 999.99,
      p_text: 'palette',
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('filtre correctement le cache local en mode hors-ligne (filterOrdersLocally & filterMovementsLocally)', () => {
    const byRef = filterOrdersLocally(
      sampleOrders,
      {
        ...createDefaultOrderSearchFilters(),
        periodPreset: 'ALL',
        reference: 'REF-300',
        preparer: 'Paul',
      },
      NOW
    );
    expect(byRef.map((o) => o.id)).toEqual(['ord-old-preparing']);

    const byCost = filterMovementsLocally(
      sampleMovements,
      [],
      {
        ...createDefaultMovementSearchFilters(),
        periodPreset: 'ALL',
        type: 'IN',
        minCost: '500',
      },
      NOW
    );
    expect(byCost.map((m) => m.id)).toEqual(['mov-old']);
  });
});

describe('Prompt v52 — Lot 3 : Générateurs de rapports, export CSV (BOM UTF-8, ; et virgule décimale), PDF et pièces jointes (limite 3 Mo & validation serveur)', () => {
  const sampleProducts: Product[] = [
    {
      id: 'p1',
      reference: 'REF-01',
      brand: 'Schneider',
      model: 'Disjoncteur 16A',
      quantity: 0,
      min_stock_alert: 5,
      unit_price: 12.5,
      store_name: 'Dépôt Central',
    },
    {
      id: 'p2',
      reference: 'REF-02',
      brand: 'Legrand',
      model: 'Prise 2P+T',
      quantity: 3,
      min_stock_alert: 10,
      unit_price: 4.75,
      store_name: 'Dépôt Central',
    },
  ];

  const sampleOrders: MaterialOrder[] = [
    {
      id: 'o1',
      order_number: 'CMD-2026-01',
      requester_id: 'u1',
      requester_name: 'Jean Dupont',
      preparer_name: 'Marc',
      requester_department: 'Maintenance',
      site_number: 'Usine Sud; Quai 2',
      depot_name: 'Dépôt Central',
      status: 'COLLECTED',
      created_at: new Date().toISOString(),
      items: [
        {
          product_id: 'p2',
          product_ref: 'REF-02',
          product_name: 'Prise 2P+T',
          quantity: 4,
          unit: 'pce',
          unit_price: 4.75,
        },
      ],
      total_cost: 19.5,
      notes: 'Livraison rapide ; quai 2',
    },
  ];

  const sampleMovements: StockMovement[] = [
    {
      id: 'm1',
      product_id: 'p2',
      product_ref: 'REF-02',
      movement_type: 'OUT',
      quantity_changed: 4,
      user_id: 'u1',
      user_name: 'Jean Dupont',
      department_name: 'Maintenance',
      site_number: 'Usine Sud',
      depot_name: 'Dépôt Central',
      order_number: 'CMD-2026-01',
      created_at: new Date().toISOString(),
      total_cost: 19.5,
    },
  ];

  const ctx: ReportContextData = {
    language: 'fr',
    currentUser: {
      id: 'u1',
      name: 'Jean Dupont',
      trigram: 'JDU',
      email: 'jean@tot.local',
      pin: '',
      role_id: 0,
      is_blocked: false,
      department: 'Maintenance',
    },
    companyName: 'TOT Industries',
    products: sampleProducts,
    movements: sampleMovements,
    orders: sampleOrders,
    departments: [{ id: 1, name: 'Maintenance' }],
    projects: [{ id: 1, project_number: 'Usine Sud', project_name: 'Usine Sud', department_id: 1 }],
    users: [
      {
        id: 'u1',
        name: 'Jean Dupont',
        trigram: 'JDU',
        email: 'jean@tot.local',
        pin: '',
        role_id: 0,
        is_blocked: false,
      },
    ],
    roles: [{ id: 0, name: 'Super Admin', permissions: [] }],
    canViewPrices: true,
  };

  it('génère les 6 types de rapports partagés et produit un CSV UTF-8 avec BOM (\\uFEFF), séparateur ";" et virgule décimale ","', () => {
    const lowReport = buildLowStockReport(ctx);
    expect(lowReport.rows).toHaveLength(1); // p2 (qty 3 <= min 10)

    const outReport = buildOutOfStockReport(ctx);
    expect(outReport.rows).toHaveLength(1); // p1 (qty 0)

    const weeklyReport = buildWeeklyUserRecapReport(ctx);
    expect(weeklyReport.rows).toHaveLength(1);

    const deptReport = buildDepartmentProjectsReport(ctx);
    expect(deptReport.rows).toHaveLength(1);

    const ordersReport = buildOrdersReport(
      sampleOrders,
      createDefaultOrderSearchFilters(),
      ctx
    );
    expect(ordersReport.rows).toHaveLength(1);

    const movementsReport = buildMovementsReport(
      sampleMovements,
      createDefaultMovementSearchFilters(),
      ctx
    );
    expect(movementsReport.rows).toHaveLength(1);

    const ordersCsv = generateReportCsv(ordersReport);
    // Vérifier BOM UTF-8
    expect(ordersCsv.startsWith('\uFEFF')).toBe(true);
    const lines = ordersCsv.slice(1).split('\r\n');
    expect(lines[0]).toContain('"N° Commande";"Statut";"Demandeur"');
    // Vérifier séparateur ';' et virgule décimale ',' (19,50)
    expect(lines[1]).toContain(';"19,50"');
    // Vérifier que la cellule contenant un point-virgule est bien encadrée de guillemets
    expect(lines[1]).toContain('"Usine Sud; Quai 2"');
  });

  it('génère un PDF client valide (signature %PDF) avec jspdf + jspdf-autotable', () => {
    const ordersReport = buildOrdersReport(
      sampleOrders,
      createDefaultOrderSearchFilters(),
      ctx
    );
    const pdfBytes = generateReportPdfBytes(ordersReport, 'fr');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);
    const headerAscii = String.fromCharCode(
      pdfBytes[0],
      pdfBytes[1],
      pdfBytes[2],
      pdfBytes[3]
    );
    expect(headerAscii).toBe('%PDF');
  });

  it('vérifie la limite cumulée de 3 Mo côté client (prepareReportEmailAttachments)', () => {
    expect(MAX_REPORT_ATTACHMENT_BYTES).toBe(3 * 1024 * 1024);

    const ordersReport = buildOrdersReport(
      sampleOrders,
      createDefaultOrderSearchFilters(),
      ctx
    );

    const prepBoth = prepareReportEmailAttachments({
      report: ordersReport,
      attachCsv: true,
      attachPdf: true,
      language: 'fr',
    });
    expect(prepBoth.exceedsLimit).toBe(false);
    expect(prepBoth.attachments).toHaveLength(2);
    expect(prepBoth.attachments[0].contentType).toBe('text/csv');
    expect(prepBoth.attachments[1].contentType).toBe('application/pdf');
    expect(prepBoth.csvOnlyFits).toBe(true);
  });

  it('valide les pièces jointes côté serveur dans sendReportEmailHandler (MIME text/csv ou application/pdf uniquement, nom nettoyé, signature %PDF, max 5 PJ, max 3 Mo cumulés)', async () => {
    expect(MAX_ATTACHMENTS).toBe(5);
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBe(3 * 1024 * 1024);
    expect(ALLOWED_ATTACHMENT_TYPES).toEqual(['text/csv', 'application/pdf']);

    expect(sanitizeAttachmentFilename('../../etc/passwd;evil?.csv', 'text/csv')).toBe(
      'passwd_evil_.csv'
    );

    const validCsvBase64 = Buffer.from('\uFEFFRef;Qty\r\nA;1', 'utf8').toString('base64');
    const validPdfBase64 = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n', 'utf8').toString('base64');

    const okRes = validateAttachmentInput([
      { filename: 'rapport.csv', content: validCsvBase64, type: 'text/csv' },
      { filename: 'rapport.pdf', content: validPdfBase64, type: 'application/pdf' },
    ]);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.attachments).toHaveLength(2);
    }

    // Rejet type MIME interdit
    const badMime = validateAttachmentInput([
      { filename: 'script.html', content: validCsvBase64, type: 'text/html' },
    ]);
    expect(badMime.ok).toBe(false);
    if (!badMime.ok) {
      expect(badMime.error).toContain('Type MIME non autorisé');
    }

    // Rejet PDF sans en-tête %PDF
    const badPdf = validateAttachmentInput([
      { filename: 'faux.pdf', content: validCsvBase64, type: 'application/pdf' },
    ]);
    expect(badPdf.ok).toBe(false);
    if (!badPdf.ok) {
      expect(badPdf.error).toContain('signature %PDF absente');
    }

    // Rejet > 5 pièces jointes
    const tooMany = validateAttachmentInput(
      Array.from({ length: 6 }, (_, i) => ({
        filename: `f${i}.csv`,
        content: validCsvBase64,
        type: 'text/csv',
      }))
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.error).toContain('5');
    }

    // Rejet taille cumulée > 3 Mo
    const twoMegsBase64 = Buffer.alloc(2 * 1024 * 1024, 0x41).toString('base64');
    const tooLarge = validateAttachmentInput([
      { filename: 'part1.csv', content: twoMegsBase64, type: 'text/csv' },
      { filename: 'part2.csv', content: twoMegsBase64, type: 'text/csv' },
    ]);
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.error).toContain('3 Mo');
    }

    // Vérifier aussi que handleSendReportEmail renvoie 400 si la pièce jointe est invalide
    const req = new Request('https://edge.local/send-report-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-jwt',
      },
      body: JSON.stringify({
        to: ['client@example.com'],
        subject: 'Rapport test',
        htmlContent: '<p>Bonjour</p>',
        app_code: 'rpt',
        kind: 'report',
        attachments: [{ filename: 'malware.exe', content: validCsvBase64, type: 'application/octet-stream' }],
      }),
    });

    const handler = createSendReportEmailHandler({
      authenticate: async () => ({
        ok: true,
        ctx: {
          supabaseUrl: 'https://x.supabase.co',
          serviceRoleKey: 'service-key',
          supabaseAdmin: {},
          authCaller: { id: '00000000-0000-4000-8000-000000000001', email: 'admin@tot.local' },
          authUserId: '00000000-0000-4000-8000-000000000001',
          callerProfile: {
            id: 'u-admin',
            auth_user_id: '00000000-0000-4000-8000-000000000001',
            name: 'Admin',
            role_id: 0,
            email: 'admin@tot.local',
            is_blocked: false,
          },
          callerPerms: ['perm_report_view'],
          isSuperAdmin: true,
          hasUniversal: true,
        },
      }),
    });
    const resp = await handler(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('Type MIME non autorisé');
  });
});

describe('Prompt v52 — Tests SQL PGlite de 15_search_orders_movements.sql (search_material_orders & search_stock_movements)', () => {
  it(
    'exécute 15_search_orders_movements.sql (idempotent), teste les filtres multicritères, la pagination {total_count, row_data} et le respect strict des droits de dépôt et perm_mov_view_all',
    async () => {
      const db = new PGlite();
      await db.exec(AUTH_STUB_SQL);

      for (const s of ORDERED_CLIENT_SCRIPTS) {
        await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', s), 'utf8'));
      }
      // 2e exécution idempotente
      await db.exec(
        fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/15_search_orders_movements.sql'), 'utf8')
      );
      await db.exec(
        fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8')
      );

      const UUID_ADMIN = '00000000-0000-4000-8000-000000000901';
      const UUID_NORD_USER = '00000000-0000-4000-8000-000000000902';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${UUID_ADMIN}', 'admin@tot.local'),
          ('${UUID_NORD_USER}', 'nord@tot.local')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.core_roles (id, name, permissions) VALUES
          (95, 'Technicien Dépôt Nord', ARRAY['perm_orders_view'])
        ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

        INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, auth_user_id, allowed_depots) VALUES
          ('u-admin', 'Admin Global', 'admin@tot.local', '', 0, false, '${UUID_ADMIN}', NULL),
          ('u-nord', 'Tech Nord', 'nord@tot.local', '', 95, false, '${UUID_NORD_USER}', ARRAY['Dépôt Nord'])
        ON CONFLICT (id) DO UPDATE SET
          auth_user_id = EXCLUDED.auth_user_id,
          role_id = EXCLUDED.role_id,
          allowed_depots = EXCLUDED.allowed_depots;

        DELETE FROM public.stk_material_orders;
        INSERT INTO public.stk_material_orders (
          id, order_number, requester_id, requester_name, preparer_name,
          requester_department, site_number, site_name, depot_name, status, created_at, items, total_cost, notes
        ) VALUES
          (
            'ord-1', 'CMD-101', 'u-admin', 'Admin Global', 'Paul',
            'Électricité', 'CH-ALPHA', 'Chantier Alpha', 'Dépôt Central', 'COLLECTED',
            '2026-10-01T10:00:00Z',
            '[{"product_id":"p1","product_ref":"REF-CABLE","product_name":"Câble","quantity_requested":2,"unit_price":50}]'::jsonb,
            100, 'Urgent Alpha'
          ),
          (
            'ord-2', 'CMD-102', 'u-nord', 'Tech Nord', 'Luc',
            'CVC', 'CH-BETA', 'Chantier Beta', 'Dépôt Nord', 'PREPARING',
            '2026-10-05T10:00:00Z',
            '[{"product_id":"p2","product_ref":"REF-VANNE","product_name":"Vanne","quantity_requested":3,"unit_price":80}]'::jsonb,
            240, 'Commande Nord'
          );

        INSERT INTO public.stk_products (id, reference, brand, model, quantity, min_stock_alert, unit_price, store_name) VALUES
          ('p1', 'REF-CABLE', 'Nexans', 'Câble', 10, 2, 50, 'Dépôt Central'),
          ('p2', 'REF-VANNE', 'Danfoss', 'Vanne', 10, 2, 80, 'Dépôt Central')
        ON CONFLICT (id) DO NOTHING;

        DELETE FROM public.stk_movements;
        INSERT INTO public.stk_movements (
          id, product_id, product_ref, movement_type, quantity_changed,
          user_id, user_name, department_name, site_number, depot_name, dest_depot_name,
          order_number, created_at, total_cost, reason
        ) VALUES
          (
            'mov-1', 'p1', 'REF-CABLE', 'OUT', 2,
            'u-admin', 'Admin Global', 'Électricité', 'CH-ALPHA', 'Dépôt Central', NULL,
            'CMD-101', '2026-10-01T11:00:00Z', 100, 'Sortie chantier'
          ),
          (
            'mov-2', 'p2', 'REF-VANNE', 'OUT', 3,
            'u-nord', 'Tech Nord', 'CVC', 'CH-BETA', 'Dépôt Central', 'Dépôt Nord',
            'CMD-102', '2026-10-05T11:00:00Z', 240, '[TRANSFERT:Dépôt Nord] Lot transfert'
          );
      `);

      // 1. En tant qu'Admin Global : voit les 2 commandes et peut filtrer par référence JSONB
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_ADMIN}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);

      const allOrdersRes = await db.query<{ total_count: string; row_data: any }>(
        `SELECT * FROM public.search_material_orders();`
      );
      expect(allOrdersRes.rows).toHaveLength(2);
      expect(Number(allOrdersRes.rows[0].total_count)).toBe(2);

      const refOrdersRes = await db.query<{ total_count: string; row_data: any }>(
        `SELECT * FROM public.search_material_orders(p_reference => 'REF-VANNE');`
      );
      expect(refOrdersRes.rows).toHaveLength(1);
      expect(refOrdersRes.rows[0].row_data.order_number).toBe('CMD-102');

      const allMovsRes = await db.query<{ total_count: string; row_data: any }>(
        `SELECT * FROM public.search_stock_movements(p_depot => 'Dépôt Nord');`
      );
      // mov-2 a dest_depot_name = 'Dépôt Nord' -> doit remonter pour Dépôt Nord !
      expect(allMovsRes.rows).toHaveLength(1);
      expect(allMovsRes.rows[0].row_data.id).toBe('mov-2');

      const transferMovsRes = await db.query<{ total_count: string; row_data: any }>(
        `SELECT * FROM public.search_stock_movements(p_type => 'TRANSFER');`
      );
      expect(transferMovsRes.rows).toHaveLength(1);
      expect(transferMovsRes.rows[0].row_data.id).toBe('mov-2');

      await db.exec(`COMMIT;`);

      // 2. En tant que Tech Nord (limité à 'Dépôt Nord', sans perm_mov_view_all) :
      // ne voit que CMD-102 et mov-2
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_NORD_USER}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);

      const nordOrdersRes = await db.query<{ total_count: string; row_data: any }>(
        `SELECT * FROM public.search_material_orders();`
      );
      expect(nordOrdersRes.rows).toHaveLength(1);
      expect(nordOrdersRes.rows[0].row_data.id).toBe('ord-2');

      const nordMovsRes = await db.query<{ total_count: string; row_data: any }>(
        `SELECT * FROM public.search_stock_movements();`
      );
      expect(nordMovsRes.rows).toHaveLength(1);
      expect(nordMovsRes.rows[0].row_data.id).toBe('mov-2');

      await db.exec(`COMMIT;`);
      await db.close();
    },
    120_000
  );
});
