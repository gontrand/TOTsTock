export const DDL_PATTERN: RegExp;
export function blankSqlTemplates(code: string): { code: string; count: number };
export function isTesterDistribution(env?: Record<string, string | undefined>): boolean;
export function testerProtectPlugin(outDir?: string): {
  name: string;
  enforce: 'pre';
  load(id: string): string | null;
  transform(code: string, id: string): { code: string; map: null } | null;
  closeBundle(): Promise<void>;
};
export const OBFUSCATOR_OPTIONS: Record<string, unknown>;
export function obfuscateBuildOutput(outDir: string): Promise<{ files: number; bytesBefore: number; bytesAfter: number }>;
