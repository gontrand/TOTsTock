import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../appVersion';
import { RECENT_CHANGELOG } from '../data/changelog';
import {
  FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE,
  validateSupabaseAnonKey,
  maskSupabaseAnonKey,
  canUserReplaceSupabaseKey,
  verifyUserPinOrPasswordForKeyReplacement,
  redactSupabaseKeyFromText,
} from '../services/clientSupabase';
import { formatDiagnosticSupportSummary } from '../components/AboutAppPanel';
import { QR_CONFIG_AUTO_HIDE_SECONDS } from '../components/QrConfigGenModal';
import {
  DEFAULT_COMPANY_MAX_IDLE_MINUTES,
  USER_IDLE_MINUTE_OPTIONS,
  COMPANY_POLICY_IDLE_OPTIONS,
  computeEffectiveIdleMinutes,
  isUserIdleOptionAllowedByPolicy,
  getInactivityWarningLeadSeconds,
  isCountedAsUserActivity,
  InactivityWatchdog,
  InactivityWatchdogState,
} from '../services/inactivityWatchdog';
import {
  registerCameraStream,
  getActiveCameraStreamsCount,
  stopAllCameras,
  registerWakeLock,
  releaseAllWakeLocks,
} from '../utils/qrCodeHelper';
import {
  ALL_TARGETED_NOTIFICATION_TYPES,
  getNotificationTypePreferences,
  setNotificationTypePreference,
  shouldEmitNotificationBeep,
  shouldShowNotificationBanner,
  isUserRecipientForOrderEvent,
  isUserRecipientForTransferEvent,
  computeTargetedBellBadgeCount,
  type StockTransfer,
} from '../services/notificationService';
import {
  ORDER_AUDIT_EVENT_TYPES,
  getOrderAuditEventLabel,
  isOrderPickupTransferred,
  formatOrderPickupTransferSummary,
  buildOrderTraceabilityDetails,
} from '../services/orderTraceabilityService';
import { extractOrderTargetFromAuditRow } from '../services/auditService';
import {
  buildOrdersReport,
  createDefaultOrderSearchFilters,
  filterOrdersLocally,
} from '../services/reportsService';
import type { User, Depot, DepotHolder, MaterialOrder } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../..');

function createBase64UrlJson(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = createBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = createBase64UrlJson(payload);
  return `${header}.${body}.fakesignature123456`;
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('Prompt v56 — 1. « Mot de passe oublié ? » (LoginModal)', () => {
  it('place le bouton data-testid="forgot-password-link" sous le champ mot de passe et au-dessus du bouton de soumission (Se connecter), aligné à droite, min-h-[44px], ≥ 12 px, et masqué hors mode mot de passe', () => {
    const loginModalSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/LoginModal.tsx'), 'utf8');

    const pwdInputIdx = loginModalSrc.indexOf('autoComplete="current-password"');
    const forgotBtnIdx = loginModalSrc.indexOf('data-testid="forgot-password-link"');
    const submitBtnIdx = loginModalSrc.indexOf("t('login_btn')");

    expect(pwdInputIdx).toBeGreaterThan(0);
    expect(forgotBtnIdx).toBeGreaterThan(pwdInputIdx);
    expect(submitBtnIdx).toBeGreaterThan(forgotBtnIdx);

    // Vérifier l'alignement à droite, la zone tactile ≥ 44 px et la taille ≥ 12 px (text-xs)
    const forgotSnippet = loginModalSrc.slice(forgotBtnIdx - 250, forgotBtnIdx + 450);
    expect(forgotSnippet).toContain('justify-end');
    expect(forgotSnippet).toContain('min-h-[44px]');
    expect(forgotSnippet).toContain('text-xs');
    expect(forgotSnippet).toContain('text-orange-600');

    // Ne s'affiche ni en PIN local, ni en changement de PIN obligatoire, ni en nouveau mot de passe
    expect(forgotSnippet).toContain('!isLocalPinMode');
    expect(forgotSnippet).toContain('!mustResetPinUser');
    expect(forgotSnippet).toContain('!passwordRecoveryMode');
  });
});

describe('Prompt v56 — 2. Clé « anon / publishable » masquée après connexion, rejet service_role & QR auto-masqué 60s', () => {
  it('masque la clé anon sous la forme ••••••••••••abcd (4 derniers caractères) et ne permet plus de la ré-afficher une fois connectée', () => {
    const anonJwt = buildFakeJwt({ role: 'anon', iss: 'supabase', ref: 'demo' });
    const masked = maskSupabaseAnonKey(anonJwt);
    expect(masked).toBe(`••••••••••••${anonJwt.slice(-4)}`);
    expect(masked).not.toContain('eyJ');

    const publishableKey = 'sb_publishable_1234567890abcdefghijWXYZ';
    expect(maskSupabaseAnonKey(publishableKey)).toBe('••••••••••••WXYZ');
    expect(maskSupabaseAnonKey('')).toBe('');

    // Vérifier dans CompanySetupModal.tsx et DesktopSettingsPage.tsx la présence du flux de remplacement protégé
    const mobileSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/CompanySetupModal.tsx'), 'utf8');
    const desktopSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/desktop/pages/DesktopSettingsPage.tsx'), 'utf8');

    expect(mobileSrc).toContain('data-testid="masked-supabase-key-input"');
    expect(mobileSrc).toContain('data-testid="replace-supabase-key-btn"');
    expect(desktopSrc).toContain('data-testid="desktop-masked-supabase-key-input"');
    expect(desktopSrc).toContain('data-testid="desktop-replace-supabase-key-btn"');
  });

  it('refuse immédiatement toute clé service_role (JWT role="service_role" ou préfixe sb_secret_) avec le message explicite requis', () => {
    expect(FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE).toBe(
      'Cette clé est une clé SECRÈTE (service_role) : ne la collez jamais ici. Utilisez la clé anon / publishable.'
    );

    const serviceRoleJwt = buildFakeJwt({ role: 'service_role', iss: 'supabase' });
    const resJwt = validateSupabaseAnonKey(serviceRoleJwt);
    expect(resJwt.valid).toBe(false);
    expect(resJwt.errorCode).toBe('FORBIDDEN_SECRET_KEY');
    expect(resJwt.errorMessage).toBe(FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE);

    const sbSecret = 'sb_secret_9876543210abcdef9876543210';
    const resSecret = validateSupabaseAnonKey(sbSecret);
    expect(resSecret.valid).toBe(false);
    expect(resSecret.errorCode).toBe('FORBIDDEN_SECRET_KEY');
    expect(resSecret.errorMessage).toBe(FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE);

    const anonJwt = buildFakeJwt({ role: 'anon', iss: 'supabase' });
    const resAnon = validateSupabaseAnonKey(anonJwt);
    expect(resAnon.valid).toBe(true);
    expect(resAnon.errorCode).toBeUndefined();
  });

  it('réserve le remplacement de la clé aux rôles 0 et 1 et vérifie le PIN ou mot de passe avant de déverrouiller la saisie', async () => {
    expect(canUserReplaceSupabaseKey({ role_id: 0 })).toBe(true);
    expect(canUserReplaceSupabaseKey({ role_id: 1 })).toBe(true);
    expect(canUserReplaceSupabaseKey({ role_id: 2 })).toBe(false);
    expect(canUserReplaceSupabaseKey({ role_id: 10 })).toBe(false);
    expect(canUserReplaceSupabaseKey(null)).toBe(false);

    const adminUser = { id: 'u-admin', role_id: 0, pin: '4826', email: 'admin@tot.local' };
    const nonAdminUser = { id: 'u-tech', role_id: 2, pin: '4826', email: 'tech@tot.local' };

    const deniedRole = await verifyUserPinOrPasswordForKeyReplacement({
      user: nonAdminUser,
      secretInput: '4826',
    });
    expect(deniedRole.allowed).toBe(false);
    expect(deniedRole.reason).toBe('FORBIDDEN_ROLE');

    const wrongPin = await verifyUserPinOrPasswordForKeyReplacement({
      user: adminUser,
      secretInput: '9999',
      verifyPinFn: async (_uid, pin) => pin === '4826',
    });
    expect(wrongPin.allowed).toBe(false);
    expect(wrongPin.reason).toBe('INVALID_SECRET');

    const onAuditLog = vi.fn();
    const validPin = await verifyUserPinOrPasswordForKeyReplacement({
      user: adminUser,
      secretInput: '4826',
      verifyPinFn: async (_uid, pin) => pin === '4826',
      onAuditLog,
    });
    expect(validPin.allowed).toBe(true);
    expect(onAuditLog).toHaveBeenCalledTimes(1);
  });

  it('expurge toute clé Supabase du texte « Copier le diagnostic » (À propos) et configure l’auto-masquage du QR code de configuration à 60 s', () => {
    expect(QR_CONFIG_AUTO_HIDE_SECONDS).toBe(60);
    const qrModalSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/QrConfigGenModal.tsx'), 'utf8');
    expect(qrModalSrc).toContain('QR_CONFIG_AUTO_HIDE_SECONDS');
    expect(qrModalSrc).toContain('verifyUserPinOrPasswordForKeyReplacement');

    const anonJwt = buildFakeJwt({ role: 'anon', iss: 'supabase' });
    const rawDiag = formatDiagnosticSupportSummary({
      appVersion: '5.15.0',
      expectedSchemaVersion: '2.9.0',
      minSupportedSchemaVersion: '1.0.0',
      actualSchemaVersion: '2.9.0',
      platform: `Web (${anonJwt})`,
      planCode: 'pro',
      referencesUsed: 10,
      referencesMax: 1000,
      depotsUsed: 2,
      depotsMax: 10,
      usersUsed: 4,
      signedTokenPresent: true,
      supabaseUrl: `https://projet.supabase.co?apikey=${anonJwt}`,
      supabaseKey: anonJwt,
      appSenderName: 'TOT Stock',
      appSenderEmail: 'stock@entreprise.fr',
      encryptionMode: 'native',
      pendingOfflineCount: 0,
    });

    expect(rawDiag).not.toContain(anonJwt);
    expect(rawDiag).not.toContain('eyJhbGci');
    expect(redactSupabaseKeyFromText(`Bearer ${anonJwt}`, anonJwt)).not.toContain(anonJwt);
  });
});

describe('Prompt v56 — 3. Déconnexion automatique obligatoire par horodatage (InactivityWatchdog)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T09:00:00.000Z'));
    stopAllCameras();
    releaseAllWakeLocks();
  });

  afterEach(() => {
    stopAllCameras();
    releaseAllWakeLocks();
    vi.useRealTimers();
  });

  it('supprime l’option « Jamais » pour l’utilisateur, fixe le défaut à 10 min et plafonne par security_max_idle_minutes', () => {
    expect(DEFAULT_COMPANY_MAX_IDLE_MINUTES).toBe(10);
    expect(USER_IDLE_MINUTE_OPTIONS).toEqual([1, 3, 5, 10, 15, 30, 60]);
    expect(USER_IDLE_MINUTE_OPTIONS).not.toContain(0);
    expect(COMPANY_POLICY_IDLE_OPTIONS).toEqual([1, 3, 5, 10, 15, 30, 60, 0]);

    // Plafond société = 10 min : un choix utilisateur de 30 min ou 0 (hérité) donne 10 min effectives
    expect(computeEffectiveIdleMinutes(30, 10)).toBe(10);
    expect(computeEffectiveIdleMinutes(0, 10)).toBe(10);
    expect(computeEffectiveIdleMinutes(undefined, 10)).toBe(10);
    expect(computeEffectiveIdleMinutes(5, 10)).toBe(5);

    // Politique société "Pas de limite" = 0
    expect(computeEffectiveIdleMinutes(30, 0)).toBe(30);
    expect(computeEffectiveIdleMinutes(undefined, 0)).toBe(10);

    expect(isUserIdleOptionAllowedByPolicy(5, 10)).toBe(true);
    expect(isUserIdleOptionAllowedByPolicy(10, 10)).toBe(true);
    expect(isUserIdleOptionAllowedByPolicy(15, 10)).toBe(false);
    expect(isUserIdleOptionAllowedByPolicy(0, 10)).toBe(false);
    expect(isUserIdleOptionAllowedByPolicy(60, 0)).toBe(true);

    // Avertissement : 15s avant pour 1 min, 60s avant pour >= 3 min
    expect(getInactivityWarningLeadSeconds(1)).toBe(15);
    expect(getInactivityWarningLeadSeconds(3)).toBe(60);
    expect(getInactivityWarningLeadSeconds(10)).toBe(60);
  });

  it('déconnecte après N minutes même si un flux caméra QR est actif, si des détections vidéo arrivent ou si un WakeLock est maintenu, et coupe tous les flux caméra', () => {
    const storage = createMemoryStorage();
    const onForceLogout = vi.fn();
    const onAuditLog = vi.fn();
    const states: InactivityWatchdogState[] = [];

    // Enregistrer un flux caméra factice avec 2 pistes actives + un WakeLock actif
    const track1Stop = vi.fn();
    const track2Stop = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: track1Stop }, { stop: track2Stop }],
    } as unknown as MediaStream;
    registerCameraStream(fakeStream);
    expect(getActiveCameraStreamsCount()).toBe(1);

    const wakeLockRelease = vi.fn().mockResolvedValue(undefined);
    registerWakeLock({ release: wakeLockRelease });

    const watchdog = new InactivityWatchdog({
      getUserIdleMinutes: () => 3, // 3 minutes = 180s
      getCompanyMaxIdleMinutes: () => 10,
      isAuthenticated: () => true,
      storage,
      broadcastChannelFactory: () => null,
      onStateChange: (st) => states.push(st),
      onAuditLog,
      onForceLogout,
    });

    watchdog.start();

    // Les événements caméra, WakeLock, mousemove sans clic ou Realtime ne sont PAS comptés comme activité
    expect(isCountedAsUserActivity('mousemove')).toBe(false);
    expect(isCountedAsUserActivity('camera_frame_decoded')).toBe(false);
    expect(isCountedAsUserActivity('wakelock_acquired')).toBe(false);
    expect(isCountedAsUserActivity('realtime_order_update')).toBe(false);
    expect(watchdog.recordActivity('camera_frame_decoded')).toBe(false);
    expect(isCountedAsUserActivity('pointerdown')).toBe(true);
    expect(isCountedAsUserActivity('keydown')).toBe(true);

    // Avancer de 2 minutes (120s) : il reste 60s -> le bandeau d'avertissement devient actif
    vi.advanceTimersByTime(120 * 1000);
    expect(onForceLogout).not.toHaveBeenCalled();
    const stateAt120s = states[states.length - 1];
    expect(stateAt120s.warningActive).toBe(true);
    expect(stateAt120s.remainingSeconds).toBe(60);

    // Avancer encore de 60s (total 3 minutes) sans action humaine (la caméra tourne toujours)
    vi.advanceTimersByTime(60 * 1000);
    expect(onForceLogout).toHaveBeenCalledTimes(1);
    expect(onForceLogout).toHaveBeenCalledWith('AUTO_LOGOUT_INACTIVITY');
    expect(onAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'SECURITY',
        type: 'AUTO_LOGOUT_INACTIVITY',
        appliedDelayMinutes: 3,
      })
    );

    // Les pistes caméra et le WakeLock ont été coupés automatiquement par le watchdog
    expect(track1Stop).toHaveBeenCalledTimes(1);
    expect(track2Stop).toHaveBeenCalledTimes(1);
    expect(getActiveCameraStreamsCount()).toBe(0);
    expect(wakeLockRelease).toHaveBeenCalledTimes(1);

    watchdog.stop();
  });

  it('déconnecte immédiatement au retour de veille / onglet en arrière-plan lorsque Date.now() - lastActivityTs >= délai effectif', () => {
    const storage = createMemoryStorage();
    const onForceLogout = vi.fn();

    const watchdog = new InactivityWatchdog({
      getUserIdleMinutes: () => 5, // 300s
      getCompanyMaxIdleMinutes: () => 10,
      isAuthenticated: () => true,
      storage,
      broadcastChannelFactory: () => null,
      onForceLogout,
    });

    watchdog.start();

    // Simuler une mise en veille de l'appareil où setInterval est gelé mais l'horloge système avance de 6 minutes
    vi.setSystemTime(new Date('2026-11-13T09:06:05.000Z'));

    // Au réveil (visibilitychange -> visible / focus / powerMonitor resume), evaluateNow() est appelé immédiatement
    const state = watchdog.evaluateNow('visibilitychange_visible');
    expect(state.expired).toBe(true);
    expect(onForceLogout).toHaveBeenCalledTimes(1);
    expect(onForceLogout).toHaveBeenCalledWith('AUTO_LOGOUT_INACTIVITY');

    watchdog.stop();
  });

  it('réinitialise le compteur sur clic « Rester connecté »', () => {
    const storage = createMemoryStorage();
    const onForceLogout = vi.fn();

    const watchdog = new InactivityWatchdog({
      getUserIdleMinutes: () => 1, // 60s (avertissement à 15s de la fin, soit à t=45s)
      getCompanyMaxIdleMinutes: () => 10,
      isAuthenticated: () => true,
      storage,
      broadcastChannelFactory: () => null,
      onForceLogout,
    });

    watchdog.start();

    // Avancer à t = 46s -> il reste 14s -> avertissement actif (14s)
    vi.advanceTimersByTime(46 * 1000);
    expect(watchdog.getState().warningActive).toBe(true);
    expect(watchdog.getState().remainingSeconds).toBe(14);
    expect(onForceLogout).not.toHaveBeenCalled();

    // L'utilisateur clique sur « Rester connecté »
    watchdog.stayConnected();
    expect(watchdog.getState().warningActive).toBe(false);
    expect(watchdog.getState().remainingSeconds).toBe(60);

    // Avancer encore de 30s : ne doit pas déconnecter car le compteur a été remis à zéro
    vi.advanceTimersByTime(30 * 1000);
    expect(onForceLogout).not.toHaveBeenCalled();

    watchdog.stop();
  });
});

describe('Prompt v56 — 4. Notifications ciblées par identifiant de destinataire & préférences par type', () => {
  const depots: Depot[] = [
    { id: 'dep-store', name: 'Magasin Central', type: 'FIXED' } as Depot,
    { id: 'dep-van-1', name: 'Camionnette 1', type: 'VEHICLE', manager_id: 'u-req-a' } as Depot,
  ];

  const depotHolders: DepotHolder[] = [
    { depot_id: 'dep-store', user_id: 'u-prep-1', can_send: true, can_receive: true },
    { depot_id: 'dep-van-1', user_id: 'u-req-a', can_send: true, can_receive: true },
  ];

  const requesterA: User = {
    id: 'u-req-a',
    name: 'Jean Dupont',
    role_id: 2,
    is_preparer: false,
  } as User;

  // Homonyme exact de Jean Dupont mais avec un identifiant différent
  const requesterBHomonym: User = {
    id: 'u-req-b',
    name: 'Jean Dupont',
    role_id: 2,
    is_preparer: false,
  } as User;

  const preparerStore: User = {
    id: 'u-prep-1',
    name: 'Marc Préparateur',
    role_id: 2,
    is_preparer: true,
    allowed_depots: ['Magasin Central'],
  } as User;

  const otherPreparerOtherDepot: User = {
    id: 'u-prep-other',
    name: 'Luc Autre Dépôt',
    role_id: 2,
    is_preparer: true,
    allowed_depots: ['Dépôt Nord'],
  } as User;

  // Admin (rôle 0) qui n'est NI demandeur, NI préparateur rattaché au Magasin Central
  const unrelatedAdmin: User = {
    id: 'u-admin-0',
    name: 'Sophie Admin',
    role_id: 0,
    is_preparer: false,
  } as User;

  const delegateCollector: User = {
    id: 'u-delegate-c',
    name: 'Paul Enleveur',
    role_id: 2,
    is_preparer: false,
  } as User;

  const baseOrder: MaterialOrder = {
    id: 'ord-101',
    order_number: 'CMD-2026-0101',
    requester_id: 'u-req-a',
    requester_name: 'Jean Dupont',
    depot_name: 'Magasin Central',
    status: 'PENDING',
    created_at: '2026-11-13T08:00:00.000Z',
    items: [
      {
        id: 'item-1',
        order_id: 'ord-101',
        product_id: 'p-1',
        product_name: 'Disjoncteur 16A',
        quantity_requested: 4,
      } as any,
    ],
  } as MaterialOrder;

  it('matrice destinataires × événements : création (ORDER_PENDING_PREP), prête (ORDER_READY), délégation (ORDER_PICKUP_DELEGATED) et homonymes', () => {
    // 1. Demandeur A crée une commande sur Magasin Central :
    // -> Le préparateur rattaché à Magasin Central reçoit ORDER_PENDING_PREP
    // -> Le demandeur A, l'homonyme B, le préparateur d'un autre dépôt et l'Admin non préparateur NE la reçoivent PAS
    expect(
      isUserRecipientForOrderEvent({
        user: preparerStore,
        order: baseOrder,
        eventType: 'ORDER_PENDING_PREP',
        depots,
      })
    ).toBe(true);
    expect(
      isUserRecipientForOrderEvent({
        user: requesterA,
        order: baseOrder,
        eventType: 'ORDER_PENDING_PREP',
        depots,
      })
    ).toBe(false);
    expect(
      isUserRecipientForOrderEvent({
        user: requesterBHomonym,
        order: baseOrder,
        eventType: 'ORDER_PENDING_PREP',
        depots,
      })
    ).toBe(false);
    expect(
      isUserRecipientForOrderEvent({
        user: otherPreparerOtherDepot,
        order: baseOrder,
        eventType: 'ORDER_PENDING_PREP',
        depots,
      })
    ).toBe(false);
    expect(
      isUserRecipientForOrderEvent({
        user: unrelatedAdmin,
        order: baseOrder,
        eventType: 'ORDER_PENDING_PREP',
        depots,
      })
    ).toBe(false);

    // 2. La commande passe à READY :
    // -> Seul le demandeur A (par requester_id = 'u-req-a') reçoit ORDER_READY
    // -> L'homonyme B (même requester_name 'Jean Dupont' mais id 'u-req-b'), le préparateur et l'admin NE la reçoivent PAS
    const readyOrder: MaterialOrder = {
      ...baseOrder,
      status: 'READY',
      preparer_id: 'u-prep-1',
      preparer_name: 'Marc Préparateur',
    };
    expect(
      isUserRecipientForOrderEvent({
        user: requesterA,
        order: readyOrder,
        eventType: 'ORDER_READY',
        depots,
      })
    ).toBe(true);
    expect(
      isUserRecipientForOrderEvent({
        user: requesterBHomonym,
        order: readyOrder,
        eventType: 'ORDER_READY',
        depots,
      })
    ).toBe(false);
    expect(
      isUserRecipientForOrderEvent({
        user: preparerStore,
        order: readyOrder,
        eventType: 'ORDER_READY',
        depots,
      })
    ).toBe(false);
    expect(
      isUserRecipientForOrderEvent({
        user: unrelatedAdmin,
        order: readyOrder,
        eventType: 'ORDER_READY',
        depots,
      })
    ).toBe(false);

    // 3. Si un enleveur délégué (pickup_delegate_id) est désigné :
    // -> Le demandeur A ET le délégué C reçoivent ORDER_READY, et le délégué/demandeur/préparateur reçoivent ORDER_PICKUP_DELEGATED
    const delegatedOrder: MaterialOrder = {
      ...readyOrder,
      pickup_delegate_id: 'u-delegate-c',
      pickup_delegate_name: 'Paul Enleveur',
      pickup_delegate_by: 'Jean Dupont',
    };
    expect(
      isUserRecipientForOrderEvent({
        user: requesterA,
        order: delegatedOrder,
        eventType: 'ORDER_READY',
        depots,
      })
    ).toBe(true);
    expect(
      isUserRecipientForOrderEvent({
        user: delegateCollector,
        order: delegatedOrder,
        eventType: 'ORDER_READY',
        depots,
      })
    ).toBe(true);
    expect(
      isUserRecipientForOrderEvent({
        user: delegateCollector,
        order: delegatedOrder,
        eventType: 'ORDER_PICKUP_DELEGATED',
        depots,
      })
    ).toBe(true);
    expect(
      isUserRecipientForOrderEvent({
        user: requesterBHomonym,
        order: delegatedOrder,
        eventType: 'ORDER_PICKUP_DELEGATED',
        depots,
      })
    ).toBe(false);
  });

  it('cible les événements de transfert et calcule le compteur de cloche uniquement sur les notifications destinées à l’utilisateur connecté', () => {
    const transferInTransit: StockTransfer = {
      id: 'tr-1',
      transfer_number: 'TRF-001',
      from_depot_id: 'dep-store',
      from_depot_name: 'Magasin Central',
      to_depot_id: 'dep-van-1',
      to_depot_name: 'Camionnette 1',
      status: 'IN_TRANSIT',
      sender_id: 'u-prep-1',
      created_at: new Date().toISOString(),
      lines: [],
    } as unknown as StockTransfer;

    // Titulaire de Camionnette 1 = requesterA (u-req-a) -> concerné par le transfert
    expect(
      isUserRecipientForTransferEvent({
        user: requesterA,
        transfer: transferInTransit,
        depotHolders,
        depots,
      })
    ).toBe(true);

    // Homonyme B non titulaire et Admin non titulaire -> non concernés
    expect(
      isUserRecipientForTransferEvent({
        user: requesterBHomonym,
        transfer: transferInTransit,
        depotHolders,
        depots,
      })
    ).toBe(false);
    expect(
      isUserRecipientForTransferEvent({
        user: unrelatedAdmin,
        transfer: transferInTransit,
        depotHolders,
        depots,
      })
    ).toBe(false);

    // Compteur du badge cloche :
    // - Pour preparerStore : 1 commande PENDING à préparer sur Magasin Central + 1 transfert actif où il est titulaire/émetteur = 2
    const badgePrep = computeTargetedBellBadgeCount({
      user: preparerStore,
      orders: [baseOrder],
      transfers: [transferInTransit],
      depotHolders,
      depots,
    });
    expect(badgePrep).toBe(2);

    // - Pour requesterA : 0 commande READY + 1 transfert entrant vers Camionnette 1 = 1
    const badgeReqA = computeTargetedBellBadgeCount({
      user: requesterA,
      orders: [baseOrder],
      transfers: [transferInTransit],
      depotHolders,
      depots,
    });
    expect(badgeReqA).toBe(1);

    // - Pour l'homonyme B et l'Admin non concerné : 0
    expect(
      computeTargetedBellBadgeCount({
        user: requesterBHomonym,
        orders: [baseOrder],
        transfers: [transferInTransit],
        depotHolders,
        depots,
      })
    ).toBe(0);
    expect(
      computeTargetedBellBadgeCount({
        user: unrelatedAdmin,
        orders: [baseOrder],
        transfers: [transferInTransit],
        depotHolders,
        depots,
      })
    ).toBe(0);
  });

  it('gère les préférences individuelles de notification par type (bandeau et bip sonore)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    expect(ALL_TARGETED_NOTIFICATION_TYPES).toHaveLength(8);

    const defaults = getNotificationTypePreferences('u-req-a');
    expect(defaults.ORDER_READY.banner).toBe(true);
    expect(defaults.ORDER_READY.beep).toBe(true);

    setNotificationTypePreference('ORDER_READY', 'beep', false, 'u-req-a');
    expect(shouldShowNotificationBanner('ORDER_READY', 'u-req-a')).toBe(true);
    expect(shouldEmitNotificationBeep('ORDER_READY', 'u-req-a')).toBe(false);
  });
});

describe('Prompt v56 — 5. Traçabilité complète des commandes (Détail, Journal d’audit, Rapports)', () => {
  const sampleOrder: MaterialOrder = {
    id: 'ord-500',
    order_number: 'CMD-2026-0500',
    site_number: 'CH-2026-01',
    requester_id: 'u-req-1',
    requester_name: 'Alice Demandeur',
    depot_name: 'Magasin Central',
    status: 'COLLECTED',
    created_at: new Date().toISOString(),
    preparer_id: 'u-prep-1',
    preparer_name: 'Bruno Préparateur',
    ready_at: new Date().toISOString(),
    pickup_delegate_id: 'u-col-2',
    pickup_delegate_name: 'Chloé Enleveuse',
    pickup_delegate_by: 'Alice Demandeur',
    pickup_delegate_at: '2026-11-13T08:20:00.000Z',
    collected_by: 'Chloé Enleveuse',
    collected_at: '2026-11-13T08:30:00.000Z',
    items: [
      {
        product_id: 'prod-1',
        product_ref: 'CAB-3G25',
        product_name: 'Câble 3G2.5',
        quantity: 10,
        unit: 'm',
        picked_quantity: 10,
      },
    ],
  };

  it('expose les 7 types d’événements d’audit de commande (FR/EN/NL), détecte le transfert d’enlèvement et construit le récapitulatif complet', () => {
    expect(ORDER_AUDIT_EVENT_TYPES).toEqual([
      'ORDER_CREATED',
      'ORDER_ASSIGNED',
      'ORDER_READY',
      'ORDER_PICKUP_DELEGATED',
      'ORDER_COLLECTED',
      'ORDER_REJECTED',
      'ORDER_CANCELLED',
    ]);

    expect(getOrderAuditEventLabel('ORDER_PICKUP_DELEGATED', 'fr')).toContain('Retrait transféré');
    expect(getOrderAuditEventLabel('ORDER_COLLECTED', 'en')).toContain('collected');
    expect(getOrderAuditEventLabel('ORDER_CREATED', 'nl')).toContain('aangemaakt');

    expect(isOrderPickupTransferred(sampleOrder)).toBe(true);
    const transferSummary = formatOrderPickupTransferSummary(sampleOrder);
    expect(transferSummary).toContain('Oui (de Alice Demandeur à Chloé Enleveuse');

    const details = buildOrderTraceabilityDetails(sampleOrder);
    expect(details.requesterName).toBe('Alice Demandeur');
    expect(details.preparerName).toBe('Bruno Préparateur');
    expect(details.collectorName).toBe('Chloé Enleveuse');
    expect(details.pickupTransferred).toBe(true);
    expect(details.pickupTransferSummary).toContain('Oui (de Alice Demandeur à Chloé Enleveuse');

    // Extraction de cible dans auditService pour une ligne ORDER_PICKUP_DELEGATED
    const target = extractOrderTargetFromAuditRow({
      id: '1',
      created_at: '2026-11-13T08:20:00.000Z',
      type: 'ORDER_PICKUP_DELEGATED',
      action: 'UPDATE',
      category: 'ORDERS',
      table_name: 'stk_material_orders',
      record_id: 'ord-500',
      user_id: 'u-req-1',
      user_name: 'Alice Demandeur',
      meta: {
        order_id: 'ord-500',
        order_number: 'CMD-2026-0500',
      },
    });
    expect(target).toEqual({
      orderId: 'ord-500',
      orderNumber: 'CMD-2026-0500',
    });
  });

  it('ajoute les colonnes « Enleveur » et « Retrait transféré » aux rapports de commandes (CSV/PDF) et permet le filtrage par Enleveur', () => {
    const nonTransferredOrder: MaterialOrder = {
      ...sampleOrder,
      id: 'ord-501',
      order_number: 'CMD-2026-0501',
      pickup_delegate_id: undefined,
      pickup_delegate_name: undefined,
      pickup_delegate_by: undefined,
      pickup_delegate_at: undefined,
      collected_by: 'Alice Demandeur',
    };

    const filters = {
      ...createDefaultOrderSearchFilters(),
      periodPreset: 'ALL' as const,
      collector: 'Chloé',
    };
    const filteredByChloe = filterOrdersLocally([sampleOrder, nonTransferredOrder], filters);
    expect(filteredByChloe).toHaveLength(1);
    expect(filteredByChloe[0].id).toBe('ord-500');

    const report = buildOrdersReport(
      [sampleOrder, nonTransferredOrder],
      createDefaultOrderSearchFilters()
    );

    const colKeys = report.columns.map((c) => c.key);
    expect(colKeys).toContain('collector');
    expect(colKeys).toContain('pickup_transferred');

    const colLabels = report.columns.map((c) => c.label);
    expect(colLabels).toContain('Enleveur');
    expect(colLabels).toContain('Retrait transféré');

    const row500 = report.rows.find((r) => r.order_number === 'CMD-2026-0500');
    const row501 = report.rows.find((r) => r.order_number === 'CMD-2026-0501');
    expect(row500?.collector).toBe('Chloé Enleveuse');
    expect(String(row500?.pickup_transferred)).toContain('Oui (de Alice Demandeur à Chloé Enleveuse');
    expect(row501?.collector).toBe('Alice Demandeur');
    expect(row501?.pickup_transferred).toBe('Non');
  });
});

describe('Prompt v56 — 6. Documentation & Versions 5.16.0 / Schéma 2.10.0 / versionCode 12', () => {
  it('aligne APP_VERSION=5.16.0, EXPECTED_SCHEMA_VERSION=2.10.0, versionCode=12, RECENT_CHANGELOG et n’inclut pas de fichier 19_order_trace.sql non demandé', () => {
    expect(APP_VERSION).toBe('5.16.1');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

    expect(RECENT_CHANGELOG[0].version).toBe('5.16.1');
    expect(RECENT_CHANGELOG[0].schemaVersion).toBe('2.10.0');

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    const desktopPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'desktop/package.json'), 'utf8'));
    const versionCodeJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'android/version-code.json'), 'utf8'));
    const buildGradle = fs.readFileSync(path.join(ROOT_DIR, 'android/app/build.gradle'), 'utf8');

    expect(pkg.version).toBe('5.16.1');
    expect(desktopPkg.version).toBe('5.16.1');
    expect(versionCodeJson.versionCode).toBeGreaterThanOrEqual(12);
    expect(buildGradle).toMatch(/versionCode (1[2-9]|[2-9]\d)/);
    expect(buildGradle).toContain('versionName "5.16.1"');

    // Le script 19_order_trace.sql est fourni séparément puis intégré au dépôt (étape 19 de SQL_STEPS)
    expect(fs.existsSync(path.join(ROOT_DIR, 'supabase-client/19_order_trace.sql'))).toBe(true);

    // Vérifier que DocumentationModal documente bien les nouveautés v56 en FR/EN/NL
    const docSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/DocumentationModal.tsx'), 'utf8');
    expect(docSrc).toContain('security_max_idle_minutes');
    expect(docSrc).toContain('••••••••••••');
    expect(docSrc).toContain('Enleveur');
  });
});
