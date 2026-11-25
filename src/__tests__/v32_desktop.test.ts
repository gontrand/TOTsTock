import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import {
  buildDesktopCsp,
  isAllowedExternalUrl,
  isAllowedNavigationUrl,
  isAllowedPermissionRequest,
  MAX_PRINT_HTML_BYTES,
  resolveSafeProtocolPath,
  sanitizeLogMessage,
  sanitizePrintSettings,
  sanitizeWindowBounds,
  validatePrintLabelPayload,
} from '../../desktop/security.mjs';
import {
  getDesktopPlatform,
  getDesktopPrintSettings,
  getLabelPageDimensionsMm,
  isDesktopApp,
  listDesktopPrinters,
  openExternalUrl,
  printDesktopLabel,
  setDesktopPrintSettings,
  shouldRegisterServiceWorker,
  TotDesktopBridge,
} from '../services/desktopBridge';
import {
  dispatchStationPrintDocument,
  executeStationPrintJob,
  PrintJobRecord,
} from '../services/printStationService';
import {
  detectClientDesktopOs,
  getConfiguredBinaryInstallerUrl,
} from '../utils/desktopInstallerDownload';
import { Product } from '../types';

describe('Prompt v32 — Sécurité du processus principal Electron (desktop/security.mjs)', () => {
  describe('1. Filtrage des URL de navigation interne (isAllowedNavigationUrl)', () => {
    it('accepte uniquement app://tot et ses chemins internes', () => {
      expect(isAllowedNavigationUrl('app://tot')).toBe(true);
      expect(isAllowedNavigationUrl('app://tot/')).toBe(true);
      expect(isAllowedNavigationUrl('app://tot/index.html')).toBe(true);
      expect(isAllowedNavigationUrl('app://tot/assets/main-abc123.js')).toBe(true);
    });

    it('refuse http://, https://, file://, javascript:, data:, et autres origines', () => {
      expect(isAllowedNavigationUrl('http://localhost:3000')).toBe(false);
      expect(isAllowedNavigationUrl('https://xyz.supabase.co')).toBe(false);
      expect(isAllowedNavigationUrl('file:///etc/passwd')).toBe(false);
      expect(isAllowedNavigationUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedNavigationUrl('data:text/html,<h1>test</h1>')).toBe(false);
      expect(isAllowedNavigationUrl('app://other-host/index.html')).toBe(false);
      expect(isAllowedNavigationUrl('app://user:pass@tot/index.html')).toBe(false);
      expect(isAllowedNavigationUrl('')).toBe(false);
      expect(isAllowedNavigationUrl(null)).toBe(false);
    });
  });

  describe('2. Filtrage des URL externes (isAllowedExternalUrl)', () => {
    it('accepte les URL https:// valides sans identifiants', () => {
      expect(isAllowedExternalUrl('https://github.com/org/repo/releases')).toBe(true);
      expect(isAllowedExternalUrl('https://abcd1234.supabase.co/storage/v1/object/public/update.exe')).toBe(true);
    });

    it('refuse http://, javascript:, file:, data:, domaines locaux et identifiants user:pass@', () => {
      expect(isAllowedExternalUrl('http://example.com')).toBe(false);
      expect(isAllowedExternalUrl('javascript:alert(document.cookie)')).toBe(false);
      expect(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
      expect(isAllowedExternalUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
      expect(isAllowedExternalUrl('https://admin:secret@example.com/update')).toBe(false);
      expect(isAllowedExternalUrl('https://localhost/update')).toBe(false);
      expect(isAllowedExternalUrl('https://intranet.local/update')).toBe(false);
      expect(isAllowedExternalUrl('https://server.internal/update')).toBe(false);
      expect(isAllowedExternalUrl('')).toBe(false);
    });
  });

  describe('3. Permissions Chromium (isAllowedPermissionRequest)', () => {
    it('autorise uniquement media depuis app://tot', () => {
      expect(isAllowedPermissionRequest('media', 'app://tot/index.html')).toBe(true);
      expect(isAllowedPermissionRequest('geolocation', 'app://tot/index.html')).toBe(false);
      expect(isAllowedPermissionRequest('notifications', 'app://tot/index.html')).toBe(false);
      expect(isAllowedPermissionRequest('media', 'https://evil.example.com')).toBe(false);
    });
  });

  describe('4. Résolution sûre de chemin pour le protocole app://tot (resolveSafeProtocolPath)', () => {
    const fakeDist = path.resolve('/opt/tot-stock/dist');

    it('résout la racine et les fichiers normaux dans dist/', () => {
      const rootRes = resolveSafeProtocolPath(fakeDist, 'app://tot/');
      expect(rootRes.ok).toBe(true);
      if (rootRes.ok) {
        expect(rootRes.filePath).toBe(path.join(fakeDist, 'index.html'));
        expect(rootRes.relativePath).toBe('index.html');
      }

      const assetRes = resolveSafeProtocolPath(fakeDist, 'app://tot/assets/app.js?v=5.5.0');
      expect(assetRes.ok).toBe(true);
      if (assetRes.ok) {
        expect(assetRes.filePath).toBe(path.join(fakeDist, 'assets', 'app.js'));
      }
    });

    it('bloque toute traversée de répertoire (../, %2e%2e, %2f, \\, octets nuls)', () => {
      expect(resolveSafeProtocolPath(fakeDist, 'app://tot/../package.json').ok).toBe(false);
      expect(resolveSafeProtocolPath(fakeDist, 'app://tot/assets/../../secret.env').ok).toBe(false);
      expect(resolveSafeProtocolPath(fakeDist, 'app://tot/%2e%2e/%2e%2e/etc/passwd').ok).toBe(false);
      expect(resolveSafeProtocolPath(fakeDist, 'app://tot/assets%2f..%2f..%2fetc/passwd').ok).toBe(false);
      expect(resolveSafeProtocolPath(fakeDist, 'app://tot/index.html%00.png').ok).toBe(false);
      expect(resolveSafeProtocolPath(fakeDist, 'https://tot/index.html').ok).toBe(false);
    });
  });

  describe('5. Construction de la Content-Security-Policy (buildDesktopCsp)', () => {
    it('construit une CSP stricte sans unsafe-eval et avec *.supabase.co par défaut', () => {
      const csp = buildDesktopCsp('');
      expect(csp).toContain("default-src 'self' app:");
      expect(csp).toContain("script-src 'self' app:");
      expect(csp).toContain("style-src 'self' app: 'unsafe-inline'");
      expect(csp).toContain("img-src 'self' app: data: blob: https:");
      expect(csp).toContain("connect-src 'self' app: https://*.supabase.co wss://*.supabase.co");
      expect(csp).not.toContain('unsafe-eval');
    });

    it('inclut les hôtes supplémentaires de VITE_ALLOWED_SUPABASE_HOSTS', () => {
      const csp = buildDesktopCsp('stock.mon-entreprise.be, *.groupe-btp.fr');
      expect(csp).toContain('https://stock.mon-entreprise.be');
      expect(csp).toContain('wss://stock.mon-entreprise.be');
      expect(csp).toContain('https://*.groupe-btp.fr');
      expect(csp).toContain('wss://*.groupe-btp.fr');
      expect(csp).not.toContain('unsafe-eval');
    });
  });

  describe('6. Validation des paramètres IPC printLabel (validatePrintLabelPayload)', () => {
    const validPrinters = ['Zebra_GK420d', 'Brother_HL_L2350DW'];
    const baseValidPayload = {
      html: '<!DOCTYPE html><html><body><div>Étiquette TOT</div></body></html>',
      pageWidthMm: 50,
      pageHeightMm: 30,
      printerName: 'Zebra_GK420d',
      copies: 2,
      silent: true,
    };

    it('accepte une charge utile valide et convertit les mm en microns', () => {
      const res = validatePrintLabelPayload(baseValidPayload, validPrinters);
      expect(res.ok).toBe(true);
      if (res.ok && res.value) {
        expect(res.value.widthMicrons).toBe(50_000);
        expect(res.value.heightMicrons).toBe(30_000);
        expect(res.value.copies).toBe(2);
        expect(res.value.silent).toBe(true);
        expect(res.value.printerName).toBe('Zebra_GK420d');
      }
    });

    it('refuse un nombre de copies hors bornes (1..100) ou non entier', () => {
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, copies: 0 }, validPrinters).ok
      ).toBe(false);
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, copies: 101 }, validPrinters).ok
      ).toBe(false);
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, copies: 1.5 }, validPrinters).ok
      ).toBe(false);
    });

    it('refuse des dimensions de page hors bornes (20..300 mm)', () => {
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, pageWidthMm: 19 }, validPrinters).ok
      ).toBe(false);
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, pageHeightMm: 301 }, validPrinters).ok
      ).toBe(false);
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, pageWidthMm: Number.NaN }, validPrinters).ok
      ).toBe(false);
    });

    it('refuse un HTML vide ou dépassant 1 Mo', () => {
      expect(
        validatePrintLabelPayload({ ...baseValidPayload, html: '   ' }, validPrinters).ok
      ).toBe(false);

      const oversizedHtml = '<div>' + 'A'.repeat(MAX_PRINT_HTML_BYTES + 10) + '</div>';
      const overRes = validatePrintLabelPayload(
        { ...baseValidPayload, html: oversizedHtml },
        validPrinters
      );
      expect(overRes.ok).toBe(false);
      if (!overRes.ok) {
        expect(overRes.errorCode).toBe('HTML_TOO_LARGE');
      }
    });

    it("refuse un nom d'imprimante inconnu ou absent de getPrintersAsync()", () => {
      const unknownRes = validatePrintLabelPayload(
        { ...baseValidPayload, printerName: 'Imprimante_Fantome' },
        validPrinters
      );
      expect(unknownRes.ok).toBe(false);
      if (!unknownRes.ok) {
        expect(unknownRes.errorCode).toBe('PRINTER_NOT_FOUND');
      }
    });

    it('nettoie les préférences, les dimensions de fenêtre et les journaux', () => {
      expect(sanitizePrintSettings({ printerName: '  Zebra_GK420d ', silent: false })).toEqual({
        printerName: 'Zebra_GK420d',
        silent: false,
      });
      expect(sanitizeWindowBounds({ width: 500, height: 400 })).toEqual({
        width: 1280,
        height: 820,
        x: undefined,
        y: undefined,
        isMaximized: false,
      });
      const log = sanitizeLogMessage('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig <div>secret</div>');
      expect(log).not.toContain('eyJhbGci');
      expect(log).not.toContain('<div>');
    });
  });
});

describe('Prompt v32 — Pont Frontend desktopBridge.ts & Poste d’impression', () => {
  beforeEach(() => {
    if (typeof (globalThis as any).window === 'undefined') {
      (globalThis as any).window = globalThis;
    }
    delete (globalThis as any).window.totDesktop;
    delete (globalThis as any).totDesktop;
  });

  afterEach(() => {
    if ((globalThis as any).window) {
      delete (globalThis as any).window.totDesktop;
    }
    delete (globalThis as any).totDesktop;
  });

  it('sans window.totDesktop : conserve le comportement web et autorise le Service Worker', async () => {
    expect(isDesktopApp()).toBe(false);
    expect(getDesktopPlatform()).toBeNull();
    expect(shouldRegisterServiceWorker()).toBe(true);
    expect(await listDesktopPrinters()).toEqual([]);
    expect(await getDesktopPrintSettings()).toEqual({ printerName: '', silent: true });

    const printRes = await printDesktopLabel({
      html: '<html><body>Test</body></html>',
      pageWidthMm: 50,
      pageHeightMm: 30,
      printerName: 'Zebra',
      copies: 1,
      silent: true,
    });
    expect(printRes.ok).toBe(false);
    expect(printRes.errorCode).toBe('NOT_DESKTOP');
  });

  it('avec un faux pont window.totDesktop : le poste d’impression utilise printLabel avec les bonnes dimensions', async () => {
    const printLabelSpy = vi.fn().mockResolvedValue({ ok: true });
    const openExternalSpy = vi.fn().mockResolvedValue({ ok: true });

    const fakeBridge: TotDesktopBridge = {
      isDesktop: true,
      platform: 'win32',
      listPrinters: vi.fn().mockResolvedValue([
        {
          name: 'Zebra_ZD421',
          displayName: 'Zebra ZD421 Thermique',
          description: 'Imprimante comptoir',
          status: 0,
          isDefault: true,
        },
      ]),
      printLabel: printLabelSpy,
      getPrintSettings: vi.fn().mockResolvedValue({
        printerName: 'Zebra_ZD421',
        silent: true,
      }),
      setPrintSettings: vi.fn().mockResolvedValue({
        ok: true,
        settings: { printerName: 'Zebra_ZD421', silent: true },
      }),
      openExternal: openExternalSpy,
    };

    window.totDesktop = fakeBridge;

    expect(isDesktopApp()).toBe(true);
    expect(getDesktopPlatform()).toBe('win32');
    expect(shouldRegisterServiceWorker()).toBe(false);

    const printers = await listDesktopPrinters();
    expect(printers).toHaveLength(1);
    expect(printers[0].name).toBe('Zebra_ZD421');

    const savedOk = await setDesktopPrintSettings({
      printerName: 'Zebra_ZD421',
      silent: true,
    });
    expect(savedOk).toBe(true);

    // Vérification des dimensions par format
    expect(getLabelPageDimensionsMm('thermal_50x30')).toEqual({
      pageWidthMm: 50,
      pageHeightMm: 30,
    });
    expect(getLabelPageDimensionsMm('avery_70x37')).toEqual({
      pageWidthMm: 210,
      pageHeightMm: 297,
    });

    // Test de dispatchStationPrintDocument
    const dispatchRes = await dispatchStationPrintDocument({
      html: '<!DOCTYPE html><html><body><div>Étiquette test</div></body></html>',
      format: 'thermal_50x30',
      copies: 3,
    });
    expect(dispatchRes.ok).toBe(true);
    expect(dispatchRes.usedDesktopBridge).toBe(true);
    expect(printLabelSpy).toHaveBeenCalledTimes(1);
    expect(printLabelSpy).toHaveBeenCalledWith({
      html: '<!DOCTYPE html><html><body><div>Étiquette test</div></body></html>',
      pageWidthMm: 50,
      pageHeightMm: 30,
      printerName: 'Zebra_ZD421',
      copies: 3,
      silent: true,
    });

    // Test d'un travail complet executeStationPrintJob
    const sampleProducts: Product[] = [
      {
        id: 'prod-1',
        reference: 'VIS-M8-50',
        brand: 'Fischer',
        model: 'Boulon M8x50',
        sub_category_id: 1,
        store_name: 'Dépôt Central',
        room_name: 'Allée A',
        shelf_name: 'Bac 12',
        quantity: 100,
        min_stock_alert: 10,
        unit_price: 0.45,
      },
    ];

    const sampleJob: PrintJobRecord = {
      id: 'job-123',
      station_id: 'station-1',
      created_by: 'user-1',
      kind: 'product_label',
      format: 'thermal_50x30',
      payload: {
        product_id: 'prod-1',
        product_ref: 'VIS-M8-50',
      },
      copies: 2,
      status: 'PRINTING',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    printLabelSpy.mockClear();
    const jobRes = await executeStationPrintJob(sampleJob, sampleProducts, []);
    expect(jobRes.ok).toBe(true);
    expect(jobRes.usedDesktopBridge).toBe(true);
    expect(printLabelSpy).toHaveBeenCalledTimes(1);
    const callArg = printLabelSpy.mock.calls[0][0];
    expect(callArg.printerName).toBe('Zebra_ZD421');
    expect(callArg.pageWidthMm).toBe(50);
    expect(callArg.pageHeightMm).toBe(30);
    expect(callArg.copies).toBe(2);
    expect(callArg.silent).toBe(true);
    expect(callArg.html).toContain('VIS-M8-50');

    // Test d'ouverture de lien externe
    const extOk = await openExternalUrl('https://github.com/org/tot-stock/releases');
    expect(extOk).toBe(true);
    expect(openExternalSpy).toHaveBeenCalledWith('https://github.com/org/tot-stock/releases');
  });

  it('utilise l’adresse configurée (VITE_DESKTOP_INSTALLER_URL ou par OS) quand elle existe, et ne crée aucun Blob sinon (v36)', () => {
    const OriginalBlob = globalThis.Blob;
    const blobSpy = vi.fn((...args: any[]) => new OriginalBlob(...args));
    (globalThis as any).Blob = blobSpy;

    try {
      // 1. Détection du système d'exploitation client
      expect(detectClientDesktopOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32')).toBe('windows');
      expect(detectClientDesktopOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'MacIntel')).toBe('mac');
      expect(detectClientDesktopOs('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')).toBe('linux');

      // 2. Sans URL configurée (ou avec une URL d'APK Android) : retourne null et ne crée aucun Blob
      expect(getConfiguredBinaryInstallerUrl('windows', { envOverride: {}, updateUrl: null })).toBeNull();
      expect(getConfiguredBinaryInstallerUrl('linux', { envOverride: {}, updateUrl: '' })).toBeNull();
      expect(getConfiguredBinaryInstallerUrl('mac', { envOverride: {}, updateUrl: 'https://tot.example.com/tot-stock.apk' })).toBeNull();
      expect(blobSpy).not.toHaveBeenCalled();

      // 3. Avec VITE_DESKTOP_INSTALLER_URL configurée : retourne cette adresse pour tout OS, sans créer de Blob
      const genericReleasesUrl = 'https://github.com/org/tot-stock/releases/latest';
      expect(
        getConfiguredBinaryInstallerUrl('windows', {
          envOverride: { VITE_DESKTOP_INSTALLER_URL: genericReleasesUrl },
        })
      ).toBe(genericReleasesUrl);
      expect(
        getConfiguredBinaryInstallerUrl('linux', {
          envOverride: { VITE_DESKTOP_INSTALLER_URL: genericReleasesUrl },
        })
      ).toBe(genericReleasesUrl);
      expect(
        getConfiguredBinaryInstallerUrl('mac', {
          envOverride: { VITE_DESKTOP_INSTALLER_URL: genericReleasesUrl },
        })
      ).toBe(genericReleasesUrl);

      // 4. Avec une variable spécifique à l'OS (prioritaire sur VITE_DESKTOP_INSTALLER_URL) ou updateUrl compatible
      expect(
        getConfiguredBinaryInstallerUrl('windows', {
          envOverride: {
            VITE_DESKTOP_INSTALLER_URL: genericReleasesUrl,
            VITE_DESKTOP_WIN_URL: 'https://releases.tot.example.com/TOT-Stock-5.5.0-win-x64.exe',
          },
        })
      ).toBe('https://releases.tot.example.com/TOT-Stock-5.5.0-win-x64.exe');

      expect(
        getConfiguredBinaryInstallerUrl(
          'linux',
          'https://releases.tot.example.com/TOT-Stock-5.5.0-linux-amd64.deb'
        )
      ).toBe('https://releases.tot.example.com/TOT-Stock-5.5.0-linux-amd64.deb');

      expect(blobSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).Blob = OriginalBlob;
    }
  });
});

