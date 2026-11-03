export const MAX_PRINT_HTML_BYTES: number;
export const MIN_PAGE_SIZE_MM: number;
export const MAX_PAGE_SIZE_MM: number;
export const MIN_PRINT_COPIES: number;
export const MAX_PRINT_COPIES: number;
export const PRINT_TIMEOUT_MS: number;
export const MAX_ZPL_BYTES: number;
export const ZPL_TCP_TIMEOUT_MS: number;
export const ALLOWED_ZPL_PORTS: number[];
export const MAX_OPEN_WINDOWS: number;
export const ALLOWED_INTERNAL_ROUTES: string[];
export const APP_PROTOCOL_SCHEME: string;
export const APP_PROTOCOL_HOST: string;
export const APP_PROTOCOL_ORIGIN: string;

export function isAllowedNavigationUrl(rawUrl: unknown): boolean;
export function isAllowedIpcSender(senderUrl: unknown): boolean;
export function isAllowedExternalUrl(rawUrl: unknown): boolean;
export function isAllowedPermissionRequest(permission: string, requestingUrl: string): boolean;

export type SafeProtocolPathResult =
  | { ok: true; filePath: string; relativePath: string }
  | { ok: false; error: string };

export function resolveSafeProtocolPath(distRoot: string, requestUrl: string): SafeProtocolPathResult;
export function parseAllowedSupabaseHosts(allowedHostsEnv?: string): string[];
export function buildDesktopCsp(allowedHostsEnv?: string): string;

export interface ValidatedPrintPayload {
  html: string;
  pageWidthMm: number;
  pageHeightMm: number;
  widthMicrons: number;
  heightMicrons: number;
  printerName: string;
  copies: number;
  silent: boolean;
}

export type ValidatePrintPayloadResult =
  | { ok: true; value: ValidatedPrintPayload }
  | { ok: false; errorCode: string; errorMessage: string };

export function validatePrintLabelPayload(
  payload: unknown,
  availablePrinterNames?: string[]
): ValidatePrintPayloadResult;

export function isValidZplPrinterTarget(
  host: unknown,
  port?: unknown
): { ok: boolean; host?: string; port?: number; error?: string };

export function validateZplPrintPayload(
  payload: unknown,
  availablePrinterNames?: string[]
):
  | {
      ok: true;
      value: {
        zpl: string;
        transport: 'tcp' | 'raw_queue';
        host?: string;
        port?: number;
        rawPrinterName?: string;
      };
    }
  | { ok: false; errorCode: string; errorMessage: string };

export function sanitizeNotificationPayload(payload: unknown):
  | {
      ok: true;
      value: { title: string; body: string; route: string; dedupeKey: string };
    }
  | { ok: false; error: string };

export function createNotificationRateLimiter(options?: {
  maxPerMinute?: number;
  windowMs?: number;
}): {
  canSend: (
    dedupeKey?: string,
    nowMs?: number
  ) => { allowed: boolean; reason?: string };
};

export interface DesktopPrintSettings {
  printerName: string;
  silent: boolean;
}

export function sanitizePrintSettings(raw: unknown): DesktopPrintSettings;

export interface DesktopWindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

export function sanitizeWindowBounds(raw: unknown): DesktopWindowBounds;
export function sanitizeLogMessage(input: unknown): string;
