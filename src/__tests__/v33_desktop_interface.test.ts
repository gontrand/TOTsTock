import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeLayoutModeFromWidth,
  DESKTOP_MIN_WIDTH_PX,
} from '../hooks/useLayoutMode';
import {
  buildInventoryCsvContent,
  computeSelectionAfterClick,
  createInitialBarcodeBurstState,
  filterInventoryProducts,
  matchDesktopShortcut,
  processKeyForBarcodeBurst,
  sanitizeCsvCell,
  sortInventoryProducts,
} from '../services/desktopInventoryLogic';
import {
  buildMovementsCsvContent,
  canUserApproveOrRejectOrder,
  filterMovementsList,
  filterOrdersByStatusAndSearch,
  getPickingLineVisualStatus,
  sortMovementsList,
} from '../services/desktopOrdersMovementsLogic';
import {
  generateBinRackZplLabel,
  generateOrderReadyZplLabel,
  generateProductZplLabel,
  mmToDots,
  sanitizeZplField,
  validateZplPrinterAddress,
} from '../services/zplLabel';
import {
  decodeCsvArrayBuffer,
  detectCsvSeparator,
  guessCsvColumnMapping,
  neutralizeFormulaInjectionOnImport,
  parseCsvText,
  validateCsvProductImport,
} from '../services/csvProductImport';
import {
  ALLOWED_DESKTOP_COMMANDS,
  ALLOWED_INTERNAL_ROUTES,
  createNotificationRateLimiter,
  DESKTOP_IPC_MENU_COMMAND_CHANNEL,
  isAllowedDesktopCommand,
  isAllowedInternalRoute,
  isAllowedIpcSender,
  isValidZplPrinterTarget,
  ROUTE_TO_DESKTOP_COMMAND,
  routeToDesktopCommand,
  sanitizeInternalRoute,
  sanitizeNotificationPayload,
  validateZplPrintPayload,
} from '../../desktop/security.mjs';
import { DESKTOP_SHELL_RECOGNIZED_COMMANDS } from '../desktop/DesktopShell';
import { DESKTOP_INTERNAL_ROUTES, DESKTOP_MENU_COMMANDS } from '../services/desktopBridge';
import type {
  Department,
  MaterialOrder,
  Product,
  StockMovement,
  SubCategory,
  User,
} from '../types';

describe('Prompt v33 — Lot 1 : useLayoutMode & logique Inventaire bureau', () => {
  it('bascule entre mobile (< 1024 px) et desktop (≥ 1024 px)', () => {
    expect(DESKTOP_MIN_WIDTH_PX).toBe(1024);
    expect(computeLayoutModeFromWidth(320)).toBe('mobile');
    expect(computeLayoutModeFromWidth(768)).toBe('mobile');
    expect(computeLayoutModeFromWidth(1023)).toBe('mobile');
    expect(computeLayoutModeFromWidth(1024)).toBe('desktop');
    expect(computeLayoutModeFromWidth(1440)).toBe('desktop');
    expect(computeLayoutModeFromWidth(1920)).toBe('desktop');
  });

  const subCategories: SubCategory[] = [
    { id: 1, name: 'Câbles' },
    { id: 2, name: 'Disjoncteurs' },
  ];

  const products: Product[] = [
    {
      id: 'prod-1',
      reference: 'CAB-RJ45',
      brand: 'Nexans',
      model: 'Câble RJ45 Cat6',
      barcode: '3700001',
      sub_category_id: 1,
      min_stock_alert: 50,
      unit_price: 1.2,
      quantity: 20,
      store_name: 'Dépôt Central',
      rack_location: 'A-01-02',
    },
    {
      id: 'prod-2',
      reference: 'DIS-16A',
      brand: 'Schneider',
      model: 'Disjoncteur 16A',
      barcode: '3700002',
      sub_category_id: 2,
      min_stock_alert: 10,
      unit_price: 14.5,
      quantity: 0,
      store_name: 'Dépôt Central',
      rack_location: 'B-03-01',
    },
    {
      id: 'prod-3',
      reference: 'GAI-20',
      brand: 'Courant',
      model: 'Gaine ICTA 20mm',
      barcode: '3700003',
      sub_category_id: 1,
      min_stock_alert: 10,
      unit_price: 0.8,
      quantity: 100,
      store_name: 'Atelier Nord',
      rack_location: 'C-01-01',
    },
  ];

  it('filtre et trie la liste multi-colonnes de l’inventaire bureau', () => {
    const outOfStock = filterInventoryProducts(
      products,
      { stockStatus: 'OUT' },
      { isLambdaUser: false, includeClosedDepots: true, closedDepotNames: new Set() }
    );
    expect(outOfStock).toHaveLength(1);
    expect(outOfStock[0].id).toBe('prod-2');

    const lowStock = filterInventoryProducts(
      products,
      { stockStatus: 'LOW', selectedStore: 'Dépôt Central' },
      { isLambdaUser: false, includeClosedDepots: true, closedDepotNames: new Set() }
    );
    expect(lowStock.map((r) => r.id)).toEqual(['prod-1']);

    const sortedByQty = sortInventoryProducts(products, 'quantity', 'desc', subCategories);
    expect(sortedByQty.map((p) => p.id)).toEqual(['prod-3', 'prod-1', 'prod-2']);
  });

  it('gère la sélection par plage Maj+clic (Shift+Click)', () => {
    const orderedIds = ['prod-1', 'prod-2', 'prod-3'];
    const res = computeSelectionAfterClick({
      currentSelectedIds: new Set(['prod-1']),
      clickedId: 'prod-3',
      orderedIds,
      shiftKey: true,
      lastClickedId: 'prod-1',
    });
    expect(Array.from(res.selectedIds)).toEqual(['prod-1', 'prod-2', 'prod-3']);
  });

  it('détecte une rafale de douchette USB HID (< 50 ms) et ignore la frappe humaine lente ou dans un input', () => {
    // Rafale rapide (< 50 ms entre chaque caractère) hors champ de saisie
    let state = createInitialBarcodeBurstState();
    let t = 1000;
    for (const ch of '3700001') {
      const step = processKeyForBarcodeBurst(state, ch, t, { isEditableTarget: false });
      state = step.state;
      t += 12;
    }
    const finalStep = processKeyForBarcodeBurst(state, 'Enter', t + 10, { isEditableTarget: false });
    expect(finalStep.committedCode).toBe('3700001');

    // Frappe humaine lente (200 ms entre touches) -> ignorée
    state = createInitialBarcodeBurstState();
    t = 5000;
    for (const ch of '3700002') {
      const step = processKeyForBarcodeBurst(state, ch, t, { isEditableTarget: false });
      state = step.state;
      t += 200;
    }
    const slowFinal = processKeyForBarcodeBurst(state, 'Enter', t + 200, { isEditableTarget: false });
    expect(slowFinal.committedCode).toBeNull();

    // Rafale rapide mais focus dans un input -> ignorée par le détecteur global
    state = createInitialBarcodeBurstState();
    t = 9000;
    for (const ch of '3700003') {
      const step = processKeyForBarcodeBurst(state, ch, t, { isEditableTarget: true });
      state = step.state;
      t += 10;
    }
    const inputFinal = processKeyForBarcodeBurst(state, 'Enter', t + 10, { isEditableTarget: true });
    expect(inputFinal.committedCode).toBeNull();
  });

  it('associe les raccourcis clavier hors champ de saisie et les bloque dans un input', () => {
    expect(
      matchDesktopShortcut({
        key: 'k',
        ctrlKey: true,
        target: { tagName: 'DIV' },
      })
    ).toBe('OPEN_COMMAND_PALETTE');

    expect(
      matchDesktopShortcut({
        key: 'n',
        ctrlKey: true,
        target: { tagName: 'DIV' },
      })
    ).toBe('NEW_ITEM');

    // En étant dans un input, aucun raccourci ne s'active
    expect(
      matchDesktopShortcut({
        key: '/',
        target: { tagName: 'INPUT' },
      })
    ).toBeNull();
  });

  it('neutralise les formules dangereuses (=, +, -, @) dans l’export CSV inventaire', () => {
    expect(sanitizeCsvCell('=CMD|"/C calc"!A0')).toContain("'=CMD");
    expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(sanitizeCsvCell('Câble normal')).toBe('Câble normal');

    const csv = buildInventoryCsvContent(
      [
        {
          ...products[0],
          model: '=HYPERLINK("http://evil.tld")',
        },
      ],
      subCategories,
      false
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain('Prix_Unitaire_HT');
  });
});

describe('Prompt v33 — Lot 2 : Mouvements, Commandes et Préparation bureau', () => {
  const products: Product[] = [
    {
      id: 'prod-1',
      reference: 'CAB-RJ45',
      brand: 'Nexans',
      model: 'Câble RJ45',
      sub_category_id: 1,
      min_stock_alert: 5,
      unit_price: 1.5,
      quantity: 20,
      store_name: 'Central',
    },
    {
      id: 'prod-2',
      reference: 'DIS-16A',
      brand: 'Schneider',
      model: 'Disjoncteur',
      sub_category_id: 2,
      min_stock_alert: 2,
      unit_price: 12,
      quantity: 5,
      store_name: 'Nord',
    },
  ];

  const movements: StockMovement[] = [
    {
      id: 'mov-1',
      product_id: 'prod-1',
      product_ref: 'CAB-RJ45',
      movement_type: 'IN',
      quantity_changed: 25,
      created_at: new Date().toISOString(),
      depot_name: 'Central',
      user_name: 'Alice',
      department_name: 'Chantier A',
    },
    {
      id: 'mov-2',
      product_id: 'prod-2',
      product_ref: 'DIS-16A',
      movement_type: 'OUT',
      quantity_changed: 4,
      created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      depot_name: 'Nord',
      user_name: 'Bob',
      department_name: 'Maintenance',
    },
  ];

  it('filtre, trie et exporte les mouvements en CSV', () => {
    const filtered = filterMovementsList(movements, products, null, {
      periodFilter: '7D',
      typeFilter: 'IN',
      depotFilter: 'Central',
      userOrDeptFilter: 'Chantier A',
      searchQuery: 'Câble',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('mov-1');

    const sorted = sortMovementsList(movements, 'quantity_changed', 'desc');
    expect(sorted[0].id).toBe('mov-1');

    const csv = buildMovementsCsvContent(sorted, products, { canViewPrices: false });
    expect(csv).toContain('CAB-RJ45');
    expect(csv).toContain('DIS-16A');
  });

  it('vérifie les permissions d’approbation de commandes et l’état visuel des lignes de picking', () => {
    const adminUser: User = { id: 0, name: 'Admin', trigram: 'ADM', role_id: 0, is_blocked: false };
    const workerUser: User = { id: 42, name: 'Ouvrier', trigram: 'OUV', role_id: 3, is_blocked: false };
    const departments: Department[] = [{ id: 1, name: 'Chantier Sud', manager_id: 99 }];

    const waitingOrder: MaterialOrder = {
      id: 'o-1',
      order_number: 'CMD-2026-001',
      site_number: 'CH-100',
      requester_id: '42',
      requester_name: 'Jean',
      requester_department: 'Chantier Sud',
      status: 'WAITING_APPROVAL',
      created_at: new Date().toISOString(),
      items: [
        {
          product_id: 'prod-1',
          product_ref: 'CAB-RJ45',
          product_name: 'Câble RJ45',
          quantity: 10,
          unit: 'm',
          picked_quantity: 10,
          picked: true,
        },
        {
          product_id: 'prod-2',
          product_ref: 'DIS-16A',
          product_name: 'Disjoncteur',
          quantity: 5,
          unit: 'pcs',
          unavailable: true,
        },
      ],
    };

    expect(canUserApproveOrRejectOrder(waitingOrder, adminUser, departments, true)).toBe(true);
    expect(canUserApproveOrRejectOrder(waitingOrder, workerUser, departments, false)).toBe(false);

    const matching = filterOrdersByStatusAndSearch([waitingOrder], adminUser, {
      statusFilter: 'WAITING_APPROVAL',
      searchQuery: 'CMD-2026-001',
    });
    expect(matching).toHaveLength(1);
    expect(getPickingLineVisualStatus(waitingOrder.items[0])).toBe('picked');
    expect(getPickingLineVisualStatus(waitingOrder.items[1])).toBe('missing');
  });
});

describe('Prompt v33 — Lot 4 : Génération ZPL II, Import CSV et Sécurité IPC/SSRF', () => {
  it('convertit les millimètres en points (203 et 300 dpi) et échappe les caractères ZPL réservés', () => {
    expect(mmToDots(50, 203)).toBe(400);
    expect(mmToDots(30, 203)).toBe(240);
    expect(mmToDots(50, 300)).toBe(591);
    expect(sanitizeZplField('Câble ^XA ~SD15 \\test')).toBe('Câble \\5EXA \\7ESD15 \\5Ctest');

    const productZpl = generateProductZplLabel(
      {
        reference: 'DIS-16A',
        brand: 'Schneider',
        model: 'Disjoncteur ^16A',
        barcode: '3700002',
        store_name: 'Dépôt Central',
        rack_location: 'A-01-02',
      },
      { format: '50x30', dpi: 203, copies: 2 }
    );
    expect(productZpl).toContain('^XA');
    expect(productZpl).toContain('^CI28');
    expect(productZpl).toContain('^PW400');
    expect(productZpl).toContain('^LL240');
    expect(productZpl).toContain('^PQ2,0,1,Y');
    expect(productZpl).toContain('\\5E16A');
    expect(productZpl).toContain('^XZ');

    const orderZpl = generateOrderReadyZplLabel(
      {
        order_number: 'CMD-0042',
        site_name: 'Chantier Opéra',
        requester_name: 'Marc',
        pickup_zone: 'Casier B2',
      },
      { dpi: 203, copies: 1 }
    );
    expect(orderZpl).toContain('TOT-ORDER:CMD-0042');

    const binZpl = generateBinRackZplLabel(
      {
        locationCode: 'RACK-A01',
        depotName: 'Central',
      },
      { dpi: 300 }
    );
    expect(binZpl).toContain('RACK-A01');
  });

  it('bloque toute adresse IP publique, link-local (169.254.x.x), localhost ou nom d’hôte (anti-SSRF strict RFC 1918) pour l’impression TCP ZPL', () => {
    expect(validateZplPrinterAddress('192.168.1.50', 9100).valid).toBe(true);
    expect(validateZplPrinterAddress('10.0.4.12', 9101).valid).toBe(true);
    expect(validateZplPrinterAddress('172.20.0.10', 9102).valid).toBe(true);

    // Interdits : localhost, boucle locale, link-local 169.254.x.x, noms d'hôtes, IP publiques, ports hors 9100..9102
    expect(validateZplPrinterAddress('127.0.0.1', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('localhost', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('169.254.10.20', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('monserveur', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('zebra-atelier.local', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('8.8.8.8', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('172.32.0.1', 9100).valid).toBe(false);
    expect(validateZplPrinterAddress('192.168.1.50', 80).valid).toBe(false);

    expect(isValidZplPrinterTarget('192.168.1.200', 9100).ok).toBe(true);
    expect(isValidZplPrinterTarget('10.12.0.5', 9101).ok).toBe(true);
    expect(isValidZplPrinterTarget('172.16.0.10', 9102).ok).toBe(true);
    expect(isValidZplPrinterTarget('169.254.1.1', 9100).ok).toBe(false);
    expect(isValidZplPrinterTarget('monserveur', 9100).ok).toBe(false);
    expect(isValidZplPrinterTarget('imprimante.local', 9100).ok).toBe(false);
    expect(isValidZplPrinterTarget('localhost', 9100).ok).toBe(false);
    expect(isValidZplPrinterTarget('1.1.1.1', 9100).ok).toBe(false);

    const validPayload = validateZplPrintPayload(
      { transport: 'tcp', host: '192.168.1.200', port: 9100, zpl: '^XA^FDTest^FS^XZ' },
      []
    );
    expect(validPayload.ok).toBe(true);

    const invalidHostnamePayload = validateZplPrintPayload(
      { transport: 'tcp', host: 'monserveur', port: 9100, zpl: '^XA^FDTest^FS^XZ' },
      []
    );
    expect(invalidHostnamePayload.ok).toBe(false);

    const invalidPayload = validateZplPrintPayload(
      { transport: 'tcp', host: '192.168.1.200', port: 9100, zpl: 'NOT_ZPL' },
      []
    );
    expect(invalidPayload.ok).toBe(false);
  });

  it('décode un CSV en UTF-8 et Windows-1252, détecte le séparateur, valide les lignes et respecte max_references', () => {
    const sampleCsv = [
      'SKU;Nom;Code-barres;Catégorie;Dépôt;Quantité;Seuil;Prix',
      'CAB-01;=Câble 3G2.5;3700100;Câbles;Central;10;25;1,45',
      'DIS-16A;Disjoncteur 16A mis à jour;3700002;Disjoncteurs;Central;5;12;15,00',
      'CAB-01;Doublon dans le fichier;3700999;Câbles;Central;1;10;1,00',
      'ERR-01;;3700888;Câbles;Central;1;-5;abc',
    ].join('\n');

    expect(detectCsvSeparator(sampleCsv)).toBe(';');
    const parsed = parseCsvText(sampleCsv);
    expect(parsed.headers).toHaveLength(8);
    expect(parsed.rows).toHaveLength(4);

    const mapping = guessCsvColumnMapping(parsed.headers);
    expect(mapping.reference).toBe('SKU');
    expect(mapping.model).toBe('Nom');
    expect(mapping.barcode).toBe('Code-barres');

    const existingProducts: Product[] = [
      {
        id: 'p-existing',
        reference: 'DIS-16A',
        brand: 'Schneider',
        model: 'Disjoncteur 16A',
        barcode: '3700002',
        sub_category_id: 2,
        min_stock_alert: 10,
        unit_price: 12,
        quantity: 5,
      },
    ];

    const summary = validateCsvProductImport({
      rows: parsed.rows,
      mapping,
      existingProducts,
      subCategories: [{ id: 2, name: 'Disjoncteurs' }],
      defaultDepotName: 'Central',
      license: { plan_type: 'pro', status: 'active' } as any,
    });

    expect(summary.toCreateCount).toBe(1);
    expect(summary.toUpdateCount).toBe(1);
    expect(summary.duplicateInFileCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.quotaExceeded).toBe(false);
    // Vérifie la neutralisation de formule sur le modèle '=Câble 3G2.5'
    expect(summary.rows[0].productDraft.model).toBe('Câble 3G2.5');
    expect(neutralizeFormulaInjectionOnImport('@SUM(1,2)')).toBe('SUM(1,2)');

    // Test décodage Windows-1252 (octet 0xE9 = 'é')
    const win1252Bytes = new Uint8Array([0x43, 0xe9, 0x6d, 0x65, 0x6e, 0x74]); // "Cément"
    expect(decodeCsvArrayBuffer(win1252Bytes.buffer)).toBe('Cément');
  });

  it('filtre et limite le débit des notifications système et vérifie l’origine IPC', () => {
    const clean = sanitizeNotificationPayload({
      title: 'Commande urgente\n#12',
      body: 'Chantier Nord attend validation',
      route: 'orders',
      dedupeKey: 'order:12',
    });
    expect(clean.ok).toBe(true);
    expect(clean.value?.route).toBe('orders');

    // Route externe ou inconnue ramenée vers 'dashboard'
    const fallbackRoute = sanitizeNotificationPayload({
      title: 'Test',
      body: 'Body',
      route: 'https://evil.example.com',
      dedupeKey: 'evt:1',
    });
    expect(fallbackRoute.ok).toBe(true);
    expect(fallbackRoute.value?.route).toBe('dashboard');

    const limiter = createNotificationRateLimiter();
    expect(limiter.canSend('order:1', 1000).allowed).toBe(true);
    // Doublon immédiat sur le même dedupeKey -> refusé
    expect(limiter.canSend('order:1', 2000).allowed).toBe(false);
    // Plafond de 5 par minute
    expect(limiter.canSend('order:2', 2000).allowed).toBe(true);
    expect(limiter.canSend('order:3', 3000).allowed).toBe(true);
    expect(limiter.canSend('order:4', 4000).allowed).toBe(true);
    expect(limiter.canSend('order:5', 5000).allowed).toBe(true);
    expect(limiter.canSend('order:6', 6000).allowed).toBe(false);

    expect(isAllowedIpcSender('app://tot/index.html')).toBe(true);
    expect(isAllowedIpcSender('https://evil.example.com')).toBe(false);
  });

  it('vérifie la cohérence des canaux IPC, routes et commandes entre main.mjs, preload.cjs, security.mjs et DesktopShell.tsx (v34)', () => {
    expect(DESKTOP_IPC_MENU_COMMAND_CHANNEL).toBe('tot:menu-command');
    expect(Array.from(ALLOWED_INTERNAL_ROUTES)).toEqual(Array.from(DESKTOP_INTERNAL_ROUTES));
    expect(Array.from(ALLOWED_DESKTOP_COMMANDS)).toEqual(Array.from(DESKTOP_MENU_COMMANDS));
    expect(Array.from(ALLOWED_DESKTOP_COMMANDS)).toEqual(
      Array.from(DESKTOP_SHELL_RECOGNIZED_COMMANDS)
    );

    // Validation des routes internes (print_station avec tiret bas uniquement)
    expect(isAllowedInternalRoute('print_station')).toBe(true);
    expect(isAllowedInternalRoute('print-station')).toBe(false);
    expect(sanitizeInternalRoute('print_station', 'inventory')).toBe('print_station');
    expect(sanitizeInternalRoute('print-station', 'inventory')).toBe('inventory');

    // Validation des commandes
    for (const cmd of ALLOWED_DESKTOP_COMMANDS) {
      expect(isAllowedDesktopCommand(cmd)).toBe(true);
    }
    expect(isAllowedDesktopCommand('navigate:print-station')).toBe(false);
    expect(isAllowedDesktopCommand('export-inventory-csv')).toBe(false);
    expect(isAllowedDesktopCommand('toggle-print-station-pause')).toBe(false);

    // Chaque route interne correspond à une commande nav-* valide
    for (const route of ALLOWED_INTERNAL_ROUTES) {
      const navCmd = routeToDesktopCommand(route);
      expect(navCmd).toBe((ROUTE_TO_DESKTOP_COMMAND as Record<string, string>)[route]);
      expect(isAllowedDesktopCommand(navCmd)).toBe(true);
    }

    // Lecture statique de desktop/main.mjs, desktop/preload.cjs et src/desktop/DesktopShell.tsx
    const mainMjsPath = path.resolve(__dirname, '..', '..', 'desktop', 'main.mjs');
    const preloadCjsPath = path.resolve(__dirname, '..', '..', 'desktop', 'preload.cjs');
    const desktopShellPath = path.resolve(__dirname, '..', 'desktop', 'DesktopShell.tsx');

    const mainSource = fs.readFileSync(mainMjsPath, 'utf8');
    const preloadSource = fs.readFileSync(preloadCjsPath, 'utf8');
    const shellSource = fs.readFileSync(desktopShellPath, 'utf8');

    // Aucun canal orphelin tot:app-command ou tot:navigate-route
    expect(mainSource).not.toContain('tot:app-command');
    expect(mainSource).not.toContain('tot:navigate-route');
    expect(preloadSource).not.toContain('tot:app-command');
    expect(preloadSource).not.toContain('tot:navigate-route');
    expect(preloadSource).toContain("ipcRenderer.on('tot:menu-command'");

    // Extraction des commandes émises par main.mjs (menu + tray via sendAppCommandToMain('...') + notifications via routeToDesktopCommand)
    const directSendMatches = Array.from(
      mainSource.matchAll(/sendAppCommandToMain\(\s*['"]([^'"]+)['"]\s*\)/g),
      (m) => m[1]
    );
    expect(directSendMatches.length).toBeGreaterThan(0);

    const emittedByMainSet = new Set<string>(directSendMatches);
    if (mainSource.includes('sendAppCommandToMain(routeToDesktopCommand(')) {
      for (const route of ALLOWED_INTERNAL_ROUTES) {
        emittedByMainSet.add(routeToDesktopCommand(route));
      }
    }

    // Extraction des commandes traitées dans DesktopShell.tsx (branches cmd === '...')
    const handledInShellMatches = Array.from(
      shellSource.matchAll(/cmd\s*===\s*['"]([^'"]+)['"]/g),
      (m) => m[1]
    );
    const handledByShellSet = new Set<string>(handledInShellMatches);

    // 1. Chaque commande émise par main.mjs (menu, tray, notification) existe dans la liste reconnue par DesktopShell
    for (const cmd of emittedByMainSet) {
      expect(DESKTOP_SHELL_RECOGNIZED_COMMANDS).toContain(cmd);
      expect(handledByShellSet.has(cmd)).toBe(true);
    }

    // 2. Inversement, chaque commande reconnue par DesktopShell existe dans les commandes émises par main.mjs
    for (const cmd of DESKTOP_SHELL_RECOGNIZED_COMMANDS) {
      expect(emittedByMainSet.has(cmd)).toBe(true);
      expect(handledByShellSet.has(cmd)).toBe(true);
    }
    for (const cmd of handledByShellSet) {
      expect(emittedByMainSet.has(cmd)).toBe(true);
      expect(ALLOWED_DESKTOP_COMMANDS).toContain(cmd);
    }
  });

  it('garantit qu’aucun fichier de src/desktop/ n’importe une modale mobile (*Modal.tsx) de src/components/', () => {
    const desktopDir = path.resolve(__dirname, '..', 'desktop');
    const collectTsFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectTsFiles(full));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          files.push(full);
        }
      }
      return files;
    };

    const desktopFiles = collectTsFiles(desktopDir);
    expect(desktopFiles.length).toBeGreaterThan(5);

    const forbiddenImports: string[] = [];
    // Vérifie qu'aucun fichier dans src/desktop/ n'importe un composant *Modal depuis ../components/ ou ../../components/
    const modalImportRegex = /from\s+['"](?:\.\.\/)+components\/[A-Za-z0-9_]*Modal['"]/;

    for (const file of desktopFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (modalImportRegex.test(content)) {
        forbiddenImports.push(path.relative(desktopDir, file));
      }
    }

    expect(forbiddenImports).toEqual([]);
  });

  it('autorise un Responsable de département (BIM, role_id = 8, perm_order_approve ou departments.manager_id) à voir et valider les commandes WAITING_APPROVAL de son département, de ses chantiers et ses propres commandes', () => {
    const bimManager: User = {
      id: 'usr-bim',
      name: 'BIM Manager',
      trigram: 'BIM',
      role_id: 8,
      department: 'BIM',
      is_blocked: false,
      allowed_depots: ['Dépôt Secondaire'],
    };
    const workerBim: User = {
      id: 'usr-tech',
      name: 'Technicien BIM',
      trigram: 'TBM',
      role_id: 3,
      department: 'BIM',
      is_blocked: false,
    };
    const departments: Department[] = [
      {
        id: 10,
        name: 'BIM',
        manager_id: 'usr-bim',
        require_order_approval: true,
        order_approval_threshold: 300,
      },
    ];
    const projects = [
      {
        id: 100,
        department_id: 10,
        project_number: 'CH-BIM-01',
        project_name: 'Maquette Numérique Tour A',
      },
    ];

    const teamOrder: MaterialOrder = {
      id: 'ord-team',
      order_number: 'CH-BIM-01-CMD-001',
      site_number: 'CH-BIM-01',
      requester_id: 'usr-tech',
      requester_name: 'Technicien BIM',
      requester_department: 'BIM',
      depot_name: 'Dépôt Central',
      status: 'WAITING_APPROVAL',
      total_cost: 650,
      created_at: new Date().toISOString(),
      items: [],
    };

    const projectOnlyOrder: MaterialOrder = {
      id: 'ord-proj',
      order_number: 'CH-BIM-01-CMD-002',
      site_number: 'CH-BIM-01',
      requester_id: 'usr-other',
      requester_name: 'Opérateur Externe',
      requester_department: '',
      depot_name: 'Dépôt Central',
      status: 'WAITING_APPROVAL',
      total_cost: 800,
      created_at: new Date().toISOString(),
      items: [],
    };

    const bimOwnOrder: MaterialOrder = {
      id: 'ord-self',
      order_number: 'CH-BIM-01-CMD-003',
      site_number: 'CH-BIM-01',
      requester_id: 'usr-bim',
      requester_name: 'BIM Manager',
      requester_department: 'BIM',
      depot_name: 'Dépôt Central',
      status: 'WAITING_APPROVAL',
      total_cost: 1200,
      created_at: new Date().toISOString(),
      items: [],
    };

    // BIM peut valider la commande de son équipe, la commande rattachée à son chantier, et sa propre commande
    expect(
      canUserApproveOrRejectOrder(teamOrder, bimManager, departments, false, projects)
    ).toBe(true);
    expect(
      canUserApproveOrRejectOrder(projectOnlyOrder, bimManager, departments, false, projects)
    ).toBe(true);
    expect(
      canUserApproveOrRejectOrder(bimOwnOrder, bimManager, departments, false, projects)
    ).toBe(true);

    // Un simple technicien ne peut pas valider sa propre commande ni celle du service
    expect(
      canUserApproveOrRejectOrder(teamOrder, workerBim, departments, false, projects)
    ).toBe(false);

    // BIM voit bien les 3 commandes WAITING_APPROVAL dans la liste filtrée Bureau même si elles sont sur Dépôt Central
    const visibleForBim = filterOrdersByStatusAndSearch(
      [teamOrder, projectOnlyOrder, bimOwnOrder],
      bimManager,
      {
        statusFilter: 'WAITING_APPROVAL',
        canViewAllOrders: false,
        departments,
        projects,
      }
    );
    expect(visibleForBim.map((o) => o.id).sort()).toEqual([
      'ord-proj',
      'ord-self',
      'ord-team',
    ]);
  });
});

