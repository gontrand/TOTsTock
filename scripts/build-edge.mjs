import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Lit les noms exacts des fonctions Edge depuis la source unique src/constants/edgeFunctions.ts
 */
export function readEdgeFunctionNamesFromConstants(rootDir = ROOT_DIR) {
  const edgeConstPath = path.join(rootDir, 'src', 'constants', 'edgeFunctions.ts');
  const content = fs.readFileSync(edgeConstPath, 'utf8');

  const extractObj = (constName) => {
    const regex = new RegExp(`export\\s+const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as\\s+const`, 'm');
    const m = content.match(regex);
    if (!m) {
      throw new Error(`Impossible de lire ${constName} dans src/constants/edgeFunctions.ts`);
    }
    const result = {};
    const propRegex = /([a-zA-Z0-9_]+)\s*:\s*['"]([^'"]+)['"]/g;
    let pm;
    while ((pm = propRegex.exec(m[1])) !== null) {
      result[pm[1]] = pm[2];
    }
    return result;
  };

  return {
    EDGE_FUNCTIONS: extractObj('EDGE_FUNCTIONS'),
    MASTER_EDGE_FUNCTIONS: extractObj('MASTER_EDGE_FUNCTIONS'),
  };
}

/**
 * Supprime toutes les instructions import (multi-lignes ou simples) d'un module source
 * et retourne séparément les imports distants https:// et le corps du module nettoyé.
 */
function extractHttpsImportsAndStripImports(sourceCode) {
  const httpsImports = [];
  const importRegex = /^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;

  let m;
  while ((m = importRegex.exec(sourceCode)) !== null) {
    const fullStmt = m[0].trim();
    const spec = m[1].trim();
    if (spec.startsWith('https://') || spec.startsWith('http://')) {
      httpsImports.push(fullStmt.endsWith(';') ? fullStmt : `${fullStmt};`);
    }
  }

  let body = sourceCode.replace(importRegex, '');
  // Supprimer les déclarations redondantes declare const Deno si présentes dans plusieurs modules
  body = body.replace(/^\s*declare\s+const\s+Deno\s*:\s*any\s*;?\s*$/gm, '');
  return {
    httpsImports,
    body: body.trim(),
  };
}

/**
 * Déduplique les imports https:// par URL cible en fusionnant les identifiants nommés si nécessaire.
 */
function deduplicateHttpsImports(importStatements) {
  const byUrl = new Map();
  const rawFallbacks = [];

  for (const stmt of importStatements) {
    const clean = stmt.replace(/\s+/g, ' ').trim();
    const namedMatch = clean.match(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?$/);
    if (namedMatch) {
      const names = namedMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const url = namedMatch[2];
      if (!byUrl.has(url)) {
        byUrl.set(url, new Set());
      }
      const set = byUrl.get(url);
      for (const n of names) {
        set.add(n);
      }
    } else {
      if (!rawFallbacks.includes(clean)) {
        rawFallbacks.push(clean);
      }
    }
  }

  const merged = [];
  for (const [url, namesSet] of byUrl.entries()) {
    merged.push(`import { ${Array.from(namesSet).join(', ')} } from '${url}';`);
  }
  for (const raw of rawFallbacks) {
    merged.push(raw);
  }
  return merged;
}

export function buildClientEdgeFunctionBundle(rootDir, fnName, handlerFile, factoryName, roleDescription) {
  const sharedDir = path.join(rootDir, 'supabase', 'functions', '_shared');
  const orderedFiles = [
    { label: 'cors.ts', absPath: path.join(sharedDir, 'cors.ts') },
    { label: 'config.ts', absPath: path.join(sharedDir, 'config.ts') },
    { label: 'auth.ts', absPath: path.join(sharedDir, 'auth.ts') },
    ...(handlerFile === 'sendReportEmailHandler.ts'
      ? [{ label: 'mailProviders.ts', absPath: path.join(sharedDir, 'mailProviders.ts') }]
      : []),
    { label: handlerFile, absPath: path.join(sharedDir, handlerFile) },
  ];

  const allHttpsImports = [
    `import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';`,
  ];
  const sections = [];

  for (const mod of orderedFiles) {
    const raw = fs.readFileSync(mod.absPath, 'utf8');
    const { httpsImports, body } = extractHttpsImportsAndStripImports(raw);
    allHttpsImports.push(...httpsImports);
    sections.push(
      [
        `// -------------------------------------------------------------------------`,
        `// Module inliné : _shared/${mod.label}`,
        `// -------------------------------------------------------------------------`,
        body,
      ].join('\n')
    );
  }

  const uniqueHttpsImports = deduplicateHttpsImports(allHttpsImports);

  return [
    `// =========================================================================`,
    `// TOT STOCK — FONCTION EDGE AUTONOME (FICHIER UNIQUE COPIER-COLLER)`,
    `// Nom exact à créer dans Supabase : ${fnName}`,
    `// Rôle : ${roleDescription}`,
    `// Généré automatiquement par : scripts/build-edge.mjs (npm run build:sql)`,
    `// =========================================================================`,
    ``,
    ...uniqueHttpsImports,
    ``,
    `declare const Deno: any;`,
    ``,
    ...sections,
    ``,
    `// -------------------------------------------------------------------------`,
    `// Point d'entrée Deno Edge Function`,
    `// -------------------------------------------------------------------------`,
    `serve(${factoryName}());`,
    ``,
  ].join('\n');
}

export function buildMasterEdgeFunctionBundle(rootDir, masterFnName) {
  const masterBaseDir = path.join(rootDir, 'supabase-master', 'functions');
  const discoverPath = path.join(masterBaseDir, '_shared', 'discover.ts');
  const indexPath = path.join(masterBaseDir, masterFnName, 'index.ts');

  const discoverRaw = fs.readFileSync(discoverPath, 'utf8');
  const indexRaw = fs.readFileSync(indexPath, 'utf8');

  const dParsed = extractHttpsImportsAndStripImports(discoverRaw);
  const iParsed = extractHttpsImportsAndStripImports(indexRaw);

  const uniqueHttpsImports = deduplicateHttpsImports([
    ...iParsed.httpsImports,
    ...dParsed.httpsImports,
  ]);

  return [
    `// =========================================================================`,
    `// TOT STOCK (ÉDITEUR MAÎTRE) — FONCTION EDGE AUTONOME (FICHIER UNIQUE)`,
    `// Nom exact à créer dans Supabase Maître : ${masterFnName}`,
    `// Rôle : Gestion maître des licences, émission de jetons Ed25519 et découverte`,
    `// Généré automatiquement par : scripts/build-edge.mjs (npm run build:sql)`,
    `// =========================================================================`,
    ``,
    ...uniqueHttpsImports,
    ``,
    `declare const Deno: any;`,
    ``,
    `// -------------------------------------------------------------------------`,
    `// Module inliné : _shared/discover.ts`,
    `// -------------------------------------------------------------------------`,
    dParsed.body,
    ``,
    `// -------------------------------------------------------------------------`,
    `// Point d'entrée & logique maître : ${masterFnName}/index.ts`,
    `// -------------------------------------------------------------------------`,
    iParsed.body,
    ``,
  ].join('\n');
}

export function getEdgeFunctionSpecs(rootDir = ROOT_DIR) {
  const { EDGE_FUNCTIONS, MASTER_EDGE_FUNCTIONS } = readEdgeFunctionNamesFromConstants(rootDir);

  const clientSpecs = [
    {
      key: 'syncLicense',
      fnName: EDGE_FUNCTIONS.syncLicense,
      handlerFile: 'syncLicenseHandler.ts',
      factoryName: 'createSyncLicenseHandler',
      roleDescription: 'Vérification cryptographique Ed25519 et écriture de la licence dans core_license_config',
    },
    {
      key: 'adminUsers',
      fnName: EDGE_FUNCTIONS.adminUsers,
      handlerFile: 'adminUsersHandler.ts',
      factoryName: 'createAdminUsersHandler',
      roleDescription: 'Création, liaison Auth, blocage et administration sécurisée des comptes utilisateurs',
    },
    {
      key: 'sendReportEmail',
      fnName: EDGE_FUNCTIONS.sendReportEmail,
      handlerFile: 'sendReportEmailHandler.ts',
      factoryName: 'createSendReportEmailHandler',
      roleDescription: 'Envoi transactionnel des rapports et alertes par e-mail (Brevo / SMTP)',
    },
  ];

  return {
    clientSpecs,
    masterFnName: MASTER_EDGE_FUNCTIONS.licenses,
  };
}

export function buildEdgeFunctions(rootDir = ROOT_DIR) {
  const { clientSpecs, masterFnName } = getEdgeFunctionSpecs(rootDir);

  const writtenClientFiles = [];
  for (const spec of clientSpecs) {
    const outDir = path.join(rootDir, 'supabase-client', 'generated', 'edge-functions', spec.fnName);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'index.ts');
    const content = buildClientEdgeFunctionBundle(
      rootDir,
      spec.fnName,
      spec.handlerFile,
      spec.factoryName,
      spec.roleDescription
    );
    fs.writeFileSync(outPath, content, 'utf8');
    writtenClientFiles.push({ key: spec.key, fnName: spec.fnName, outPath });
  }

  const masterOutDir = path.join(rootDir, 'supabase-client', 'generated', 'edge-functions-master', masterFnName);
  fs.mkdirSync(masterOutDir, { recursive: true });
  const masterOutPath = path.join(masterOutDir, 'index.ts');
  const masterContent = buildMasterEdgeFunctionBundle(rootDir, masterFnName);
  fs.writeFileSync(masterOutPath, masterContent, 'utf8');

  return {
    writtenClientFiles,
    masterFile: { fnName: masterFnName, outPath: masterOutPath },
  };
}

export function verifyEdgeFunctionsSync(rootDir = ROOT_DIR) {
  const { clientSpecs, masterFnName } = getEdgeFunctionSpecs(rootDir);
  const errors = [];

  for (const spec of clientSpecs) {
    const relPath = `supabase-client/generated/edge-functions/${spec.fnName}/index.ts`;
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) {
      errors.push(`Bundle Edge Function client manquant : ${relPath}`);
      continue;
    }
    const expected = buildClientEdgeFunctionBundle(
      rootDir,
      spec.fnName,
      spec.handlerFile,
      spec.factoryName,
      spec.roleDescription
    );
    const actual = fs.readFileSync(absPath, 'utf8');
    if (actual !== expected) {
      errors.push(`Bundle Edge Function client désynchronisé : ${relPath}`);
    }
  }

  const masterRelPath = `supabase-client/generated/edge-functions-master/${masterFnName}/index.ts`;
  const masterAbsPath = path.join(rootDir, masterRelPath);
  if (!fs.existsSync(masterAbsPath)) {
    errors.push(`Bundle Edge Function maître manquant : ${masterRelPath}`);
  } else {
    const expectedMaster = buildMasterEdgeFunctionBundle(rootDir, masterFnName);
    const actualMaster = fs.readFileSync(masterAbsPath, 'utf8');
    if (actualMaster !== expectedMaster) {
      errors.push(`Bundle Edge Function maître désynchronisé : ${masterRelPath}`);
    }
  }

  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const res = buildEdgeFunctions();
  for (const f of res.writtenClientFiles) {
    console.log(`[build:edge] Client function générée : ${path.relative(ROOT_DIR, f.outPath)}`);
  }
  console.log(
    `[build:edge] Master function générée : ${path.relative(ROOT_DIR, res.masterFile.outPath)}`
  );
}

