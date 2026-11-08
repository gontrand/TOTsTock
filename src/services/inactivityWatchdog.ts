import { LAST_ACTIVITY_TS_KEY } from './deviceSecurityService';
import { stopAllCameras, releaseAllWakeLocks } from '../utils/qrCodeHelper';

export const DEFAULT_COMPANY_MAX_IDLE_MINUTES = 10;
export const USER_IDLE_MINUTE_OPTIONS = [1, 3, 5, 10, 15, 30, 60] as const;
export const COMPANY_POLICY_IDLE_OPTIONS = [1, 3, 5, 10, 15, 30, 60, 0] as const;
export const IDLE_BROADCAST_CHANNEL_NAME = 'tot_stock_inactivity_sync_v1';

export const ALLOWED_USER_ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
] as const;

export type AllowedUserActivityEvent =
  | (typeof ALLOWED_USER_ACTIVITY_EVENTS)[number]
  | 'explicit_scan_validation'
  | 'stay_connected_button';

const ALLOWED_ACTIVITY_SET = new Set<string>([
  ...ALLOWED_USER_ACTIVITY_EVENTS,
  'explicit_scan_validation',
  'stay_connected_button',
]);

/**
 * Vérifie si une source d'événement compte comme une vraie activité utilisateur.
 * Ne comptent JAMAIS : flux caméra, boucle de détection code-barres/QR, WakeLock,
 * événements Supabase Realtime, timers, notifications.
 */
export function isCountedAsUserActivity(source: string): boolean {
  if (!source) return false;
  return ALLOWED_ACTIVITY_SET.has(source.trim().toLowerCase());
}

/**
 * Normalise le plafond entreprise `security_max_idle_minutes` (défaut : 10 minutes).
 * `0` signifie « Pas de limite » (explicitement autorisé par l'administrateur).
 */
export function normalizeCompanyMaxIdleMinutes(raw?: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_COMPANY_MAX_IDLE_MINUTES;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    return DEFAULT_COMPANY_MAX_IDLE_MINUTES;
  }
  return Math.floor(num);
}

/**
 * Calcule le délai effectif de déconnexion automatique (en minutes) en appliquant le plafond d'entreprise.
 * - Si `companyMaxMinutes > 0` (défaut 10 min) :
 *   - Le choix « Désactivé » (`0`) est interdit et ramené à `companyMaxMinutes`.
 *   - Toute valeur utilisateur supérieure à `companyMaxMinutes` est ramenée à `companyMaxMinutes`.
 * - Si `companyMaxMinutes === 0` (« Pas de limite ») :
 *   - Le choix utilisateur (y compris `0` = Désactivé) est respecté tel quel.
 */
export function computeEffectiveIdleMinutes(
  userIdleMinutes?: number | string | null,
  companyMaxIdleMinutes?: number | string | null
): number {
  const companyCap = normalizeCompanyMaxIdleMinutes(companyMaxIdleMinutes);
  const parsedUser =
    userIdleMinutes === undefined || userIdleMinutes === null || userIdleMinutes === ''
      ? companyCap > 0
        ? companyCap
        : DEFAULT_COMPANY_MAX_IDLE_MINUTES
      : Math.max(0, Math.floor(Number(userIdleMinutes)));

  const safeUser = Number.isFinite(parsedUser)
    ? parsedUser
    : companyCap > 0
    ? companyCap
    : DEFAULT_COMPANY_MAX_IDLE_MINUTES;

  if (companyCap > 0) {
    if (safeUser <= 0 || safeUser > companyCap) {
      return companyCap;
    }
    return safeUser;
  }

  return safeUser;
}

/**
 * Indique si une option de délai utilisateur (ex. 1, 3, 5, 10, 15, 30, 60 ou 0 = Désactivé)
 * est autorisée par la politique d'entreprise (`security_max_idle_minutes`).
 */
export function isUserIdleOptionAllowedByPolicy(
  optionMinutes: number,
  companyMaxIdleMinutes?: number | string | null
): boolean {
  const companyCap = normalizeCompanyMaxIdleMinutes(companyMaxIdleMinutes);
  if (companyCap === 0) {
    return true;
  }
  if (optionMinutes <= 0) {
    return false;
  }
  return optionMinutes <= companyCap;
}

/**
 * Retourne le délai d'avertissement avant échéance :
 * - 15 secondes si le délai effectif est de 1 minute ;
 * - 60 secondes pour tous les autres délais (> 1 minute).
 */
export function getInactivityWarningLeadSeconds(effectiveMinutes: number): number {
  if (!Number.isFinite(effectiveMinutes) || effectiveMinutes <= 0) return 0;
  if (effectiveMinutes === 1) return 15;
  return 60;
}

export interface InactivityWatchdogState {
  effectiveMinutes: number;
  remainingSeconds: number;
  warningActive: boolean;
  warningLeadSeconds: number;
  expired: boolean;
  lastActivityTs: number;
}

export interface InactivityAuditPayload {
  category: 'SECURITY';
  type: 'AUTO_LOGOUT_INACTIVITY';
  appliedDelayMinutes: number;
  workstation: string;
  trigger: string;
}

export interface InactivityWatchdogOptions {
  getUserIdleMinutes?: () => number | null | undefined;
  getCompanyMaxIdleMinutes?: () => number | string | null | undefined;
  userIdleMinutes?: number | null | undefined;
  companyMaxIdleMinutes?: number | string | null | undefined;
  isAuthenticated?: () => boolean;
  onStateChange?: (state: InactivityWatchdogState) => void;
  onWarning?: (info: { remainingSeconds: number; effectiveMinutes: number }) => void;
  onWarningClear?: () => void;
  onCloseAllModals?: () => void;
  onStopCameras?: () => number;
  onAuditLog?: (payload: InactivityAuditPayload) => Promise<unknown> | void;
  onForceLogout?: (reason: 'AUTO_LOGOUT_INACTIVITY') => Promise<unknown> | void;
  onLogout?: (info: { effectiveIdleMinutes: number; elapsedMs: number }) => Promise<unknown> | void;
  nowFn?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  broadcastChannelFactory?: (name: string) => BroadcastChannel | null;
  enableBroadcastChannel?: boolean;
  workstationLabel?: string;
  pointerMoveThrottleMs?: number;
}

export class InactivityWatchdog {
  private options: InactivityWatchdogOptions;
  private lastActivityTs: number;
  private lastPointerMoveTs = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private isLoggingOut = false;
  private currentState: InactivityWatchdogState;

  constructor(options: InactivityWatchdogOptions) {
    this.options = options;
    const now = this.now();
    this.lastActivityTs = now;
    this.persistLastActivity(now);
    const effectiveMinutes = this.getEffectiveMinutes();
    const warningLeadSeconds = getInactivityWarningLeadSeconds(effectiveMinutes);
    this.currentState = {
      effectiveMinutes,
      remainingSeconds: effectiveMinutes > 0 ? effectiveMinutes * 60 : 0,
      warningActive: false,
      warningLeadSeconds,
      expired: false,
      lastActivityTs: now,
    };
  }

  private now(): number {
    return this.options.nowFn ? this.options.nowFn() : Date.now();
  }

  private getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (this.options.storage !== undefined) return this.options.storage;
    return typeof localStorage !== 'undefined' ? localStorage : null;
  }

  private persistLastActivity(ts: number): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(LAST_ACTIVITY_TS_KEY, String(ts));
    } catch {}
  }

  public getEffectiveMinutes(): number {
    const userVal = this.options.getUserIdleMinutes
      ? this.options.getUserIdleMinutes()
      : this.options.userIdleMinutes;
    const companyVal = this.options.getCompanyMaxIdleMinutes
      ? this.options.getCompanyMaxIdleMinutes()
      : this.options.companyMaxIdleMinutes;
    return computeEffectiveIdleMinutes(userVal, companyVal);
  }

  public getLastActivityTimestamp(): number {
    return this.lastActivityTs;
  }

  public getRemainingSeconds(explicitNow?: number): number {
    const now = explicitNow ?? this.now();
    const effectiveMinutes = this.getEffectiveMinutes();
    if (effectiveMinutes <= 0) return 0;
    const timeoutMs = effectiveMinutes * 60 * 1000;
    const elapsedMs = Math.max(0, now - this.lastActivityTs);
    return Math.ceil(Math.max(0, timeoutMs - elapsedMs) / 1000);
  }

  public getState(): InactivityWatchdogState {
    return { ...this.currentState };
  }

  /**
   * Enregistre une activité uniquement si la source fait partie des gestes utilisateur autorisés.
   * Les flux caméra, détections code-barres/QR, WakeLock, Realtime ou timers sont ignorés.
   */
  public recordActivity(
    sourceOrNow: string | number = 'pointerdown',
    explicitNow?: number,
    broadcast = true
  ): boolean {
    const source = typeof sourceOrNow === 'number' ? 'pointerdown' : sourceOrNow;
    const nowArg = typeof sourceOrNow === 'number' ? sourceOrNow : explicitNow;
    if (!isCountedAsUserActivity(source)) {
      return false;
    }
    const now = nowArg ?? this.now();
    if (source.toLowerCase() === 'pointermove') {
      const throttle = this.options.pointerMoveThrottleMs ?? 1000;
      if (now - this.lastPointerMoveTs < throttle) {
        return false;
      }
      this.lastPointerMoveTs = now;
    }

    this.lastActivityTs = now;
    this.persistLastActivity(now);

    if (broadcast && this.channel) {
      try {
        this.channel.postMessage({ type: 'ACTIVITY', ts: now });
      } catch {}
    }

    this.evaluateNow('user_activity', now);
    return true;
  }

  public handleDomEvent(eventType: string, explicitNow?: number): boolean {
    return this.recordActivity(eventType, explicitNow, true);
  }

  /**
   * Validation explicite d'un scan par l'utilisateur (ex. ajout au lot / confirmation de ligne).
   */
  public recordExplicitScanValidation(explicitNow?: number): boolean {
    return this.recordActivity('explicit_scan_validation', explicitNow, true);
  }

  /**
   * Action explicite sur le bouton « Rester connecté » du bandeau/modale d'avertissement.
   */
  public stayConnected(explicitNow?: number): boolean {
    return this.recordActivity('stay_connected_button', explicitNow, true);
  }

  /**
   * Évalue immédiatement l'inactivité par horodatage (`now - lastActivityTs`).
   */
  public evaluateNow(
    triggerOrNow: string | number = 'tick',
    explicitNow?: number
  ): InactivityWatchdogState {
    const trigger = typeof triggerOrNow === 'number' ? 'tick' : triggerOrNow;
    const now = typeof triggerOrNow === 'number' ? triggerOrNow : explicitNow ?? this.now();

    // Synchroniser depuis localStorage si une autre fenêtre a mis à jour un timestamp plus récent
    const storage = this.getStorage();
    if (storage) {
      try {
        const storedTs = Number(storage.getItem(LAST_ACTIVITY_TS_KEY));
        if (Number.isFinite(storedTs) && storedTs > this.lastActivityTs && storedTs <= now) {
          this.lastActivityTs = storedTs;
        }
      } catch {}
    }

    const effectiveMinutes = this.getEffectiveMinutes();
    const warningLeadSeconds = getInactivityWarningLeadSeconds(effectiveMinutes);
    const isAuth = this.options.isAuthenticated ? this.options.isAuthenticated() : true;

    if (!isAuth || effectiveMinutes <= 0) {
      const wasWarning = this.currentState.warningActive;
      this.isLoggingOut = false;
      this.currentState = {
        effectiveMinutes,
        remainingSeconds: effectiveMinutes > 0 ? effectiveMinutes * 60 : 0,
        warningActive: false,
        warningLeadSeconds,
        expired: false,
        lastActivityTs: this.lastActivityTs,
      };
      this.options.onStateChange?.(this.currentState);
      if (wasWarning) {
        this.options.onWarningClear?.();
      }
      return this.currentState;
    }

    const timeoutMs = effectiveMinutes * 60 * 1000;
    const elapsedMs = Math.max(0, now - this.lastActivityTs);
    const remainingMs = Math.max(0, timeoutMs - elapsedMs);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const expired = elapsedMs >= timeoutMs;
    const warningActive = !expired && remainingSeconds <= warningLeadSeconds && remainingSeconds > 0;
    const wasWarning = this.currentState.warningActive;

    this.currentState = {
      effectiveMinutes,
      remainingSeconds,
      warningActive,
      warningLeadSeconds,
      expired,
      lastActivityTs: this.lastActivityTs,
    };

    this.options.onStateChange?.(this.currentState);
    if (warningActive) {
      this.options.onWarning?.({ remainingSeconds, effectiveMinutes });
    } else if (wasWarning) {
      this.options.onWarningClear?.();
    }

    if (expired && !this.isLoggingOut) {
      this.triggerForcedLogout(trigger, effectiveMinutes, true, elapsedMs);
    }

    return this.currentState;
  }

  public triggerForcedLogout(
    trigger: string = 'inactivity_timeout',
    effectiveMinutes: number = this.getEffectiveMinutes(),
    broadcast: boolean = true,
    elapsedMs: number = Math.max(0, this.now() - this.lastActivityTs)
  ): void {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;

    // 1. Arrêter immédiatement toutes les pistes caméra et libérer les WakeLocks
    try {
      if (this.options.onStopCameras) {
        this.options.onStopCameras();
      } else {
        stopAllCameras();
      }
      releaseAllWakeLocks();
    } catch {}

    // 2. Fermer toutes les modales (scanner, picking, paniers, etc.)
    try {
      this.options.onCloseAllModals?.();
    } catch {}

    // 3. Diffuser aux fenêtres secondaires Desktop via BroadcastChannel
    if (broadcast && this.channel) {
      try {
        this.channel.postMessage({
          type: 'FORCE_LOGOUT',
          reason: 'AUTO_LOGOUT_INACTIVITY',
          ts: this.now(),
        });
      } catch {}
    }

    // 4. Journaliser dans le journal d'audit (SECURITY / AUTO_LOGOUT_INACTIVITY)
    try {
      this.options.onAuditLog?.({
        category: 'SECURITY',
        type: 'AUTO_LOGOUT_INACTIVITY',
        appliedDelayMinutes: effectiveMinutes,
        workstation: this.options.workstationLabel || 'Web/Desktop',
        trigger,
      });
    } catch {}

    // 5. Déconnecter la session et revenir à l'écran de connexion
    try {
      this.options.onForceLogout?.('AUTO_LOGOUT_INACTIVITY');
      this.options.onLogout?.({ effectiveIdleMinutes: effectiveMinutes, elapsedMs });
    } catch {}
  }

  public start(explicitNow?: number): void {
    this.stop();
    const now = explicitNow ?? this.now();
    this.lastActivityTs = now;
    this.persistLastActivity(now);

    try {
      if (this.options.enableBroadcastChannel === false) {
        this.channel = null;
      } else if (this.options.broadcastChannelFactory) {
        this.channel = this.options.broadcastChannelFactory(IDLE_BROADCAST_CHANNEL_NAME);
      } else if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(IDLE_BROADCAST_CHANNEL_NAME);
      }
      if (this.channel) {
        this.channel.onmessage = (event: MessageEvent) => {
          const data = event?.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'ACTIVITY' && typeof data.ts === 'number') {
            if (data.ts > this.lastActivityTs) {
              this.lastActivityTs = data.ts;
              this.persistLastActivity(data.ts);
              this.evaluateNow('broadcast_activity', this.now());
            }
          } else if (data.type === 'FORCE_LOGOUT') {
            this.triggerForcedLogout('broadcast_force_logout', this.getEffectiveMinutes(), false);
          }
        };
      }
    } catch {
      this.channel = null;
    }

    this.intervalId = setInterval(() => {
      this.evaluateNow('interval_1s');
    }, 1000);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.channel) {
      try {
        this.channel.close();
      } catch {}
      this.channel = null;
    }
  }
}

let globalRecordExplicitUserActivityCallback: ((nowMs: number) => void) | null = null;

export function registerGlobalExplicitUserActivityCallback(
  cb: ((nowMs: number) => void) | null
): void {
  globalRecordExplicitUserActivityCallback = cb;
}

/**
 * Fonction utilitaire appelée lors d'une validation explicite d'un scan par l'utilisateur
 * (ex. ajout d'un article scanné au lot ou validation d'une ligne de picking).
 */
export function recordExplicitUserScanActivity(): void {
  try {
    globalRecordExplicitUserActivityCallback?.(Date.now());
  } catch {}
}
