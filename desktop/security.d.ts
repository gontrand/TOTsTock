export const MAX_PRINT_HTML_BYTES: number;
export const MIN_PAGE_SIZE_MM: number;
export const MAX_PAGE_SIZE_MM: number;
export const MIN_PRINT_COPIES: number;
export const MAX_PRINT_COPIES: number;
export const PRINT_TIMEOUT_MS: number;
export const APP_PROTOCOL_SCHEME: string;
export const APP_PROTOCOL_HOST: string;
export const APP_PROTOCOL_ORIGIN: string;

export function isAllowedNavigationUrl(rawUrl: unknown): boolean;
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
