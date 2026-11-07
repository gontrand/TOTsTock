import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

export const EDGE_FUNCTIONS = [
  {
    name: 'APP_TOT-Stock_admin-users',
    handlerFile: 'adminUsersHandler.ts',
    entryCall: 'serve(handleAdminUsersRequest);',
  },
  {
    name: 'APP_TOT-Stock_licenses_sync-license',
    handlerFile: 'syncLicenseHandler.ts',
    entryCall: 'serve(handleSyncLicenseRequest);',
  },
  {
    name: 'APP_TOT-Stock_send-report-email',
    handlerFile: 'sendReportEmailHandler.ts',
    entryCall: 'serve(handleSendReportEmailRequest);',
  },
];

function stripLocalImports(code) {
  return code
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^import\s+.*from\s+['"]\.\.?\/.*['"];?$/.test(trimmed)) return false;
      if (/^import\s+.*from\s+['"]https:\/\//.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

export function generateSingleFunctionBundle(fnDef, rootDir = ROOT_DIR) {
  const sharedDir = path.join(rootDir, 'supabase', 'functions', '_shared');
  const corsRaw = stripLocalImports(fs.readFileSync(path.join(sharedDir, 'cors.ts'), 'utf8'));
  const configRaw = stripLocalImports(fs.readFileSync(path.join(sharedDir, 'config.ts'), 'utf8'));
  const authRaw = stripLocalImports(fs.readFileSync(path.join(sharedDir, 'auth.ts'), 'utf8'));
  const mailProvidersRaw =
    fnDef.handlerFile === 'sendReportEmailHandler.ts'
      ? stripLocalImports(fs.readFileSync(path.join(sharedDir, 'mailProviders.ts'), 'utf8'))
      : '';
  const handlerRaw = stripLocalImports(fs.readFileSync(path.join(sharedDir, fnDef.handlerFile), 'utf8'));

  return [
    '// =========================================================================',
    `// TOT STOCK — EDGE FUNCTION AUTONOME : ${fnDef.name} (${fnDef.name}.single.ts)`,
    '// Généré automatiquement par : npm run bundle:functions (scripts/bundle-functions.mjs)',
    '// Prêt à coller dans l\'éditeur Edge Functions du tableau de bord Supabase (sans CLI)',
    '// =========================================================================',
    'import { serve } from "https://deno.land/std@0.168.0/http/server.ts";',
    'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";',
    '',
    '// --- _shared/cors.ts ---',
    corsRaw,
    '',
    '// --- _shared/config.ts ---',
    configRaw,
    '',
    '// --- _shared/auth.ts ---',
    authRaw,
    ...(mailProvidersRaw
      ? ['', '// --- _shared/mailProviders.ts ---', mailProvidersRaw]
      : []),
    '',
    `// --- _shared/${fnDef.handlerFile} ---`,
    handlerRaw,
    '',
    '// --- Entry Point ---',
    fnDef.entryCall,
    '',
  ].join('\n');
}

export function bundleAllFunctions(rootDir = ROOT_DIR) {
  const outDir = path.join(rootDir, 'dist', 'functions');
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  for (const fnDef of EDGE_FUNCTIONS) {
    const content = generateSingleFunctionBundle(fnDef, rootDir);
    const outPath = path.join(outDir, `${fnDef.name}.single.ts`);
    fs.writeFileSync(outPath, content, 'utf8');
    written.push(outPath);
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const files = bundleAllFunctions();
  for (const f of files) {
    console.log(`[bundle:functions] Généré : ${path.relative(ROOT_DIR, f)}`);
  }
}
