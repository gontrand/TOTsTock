/**
 * TOT Stock — Protection des versions « testeurs » (v5.18.0)
 *
 * Quand VITE_DISTRIBUTION=tester, le build :
 *  1. remplace par une chaîne vide tous les scripts SQL et fonctions Edge importés en « ?raw »
 *     depuis supabase-client/ (ils ne sont donc pas embarqués dans le JavaScript distribué) ;
 *  2. vide les gabarits SQL (CREATE TABLE / FUNCTION / POLICY / TRIGGER…) écrits en dur dans le code source ;
 *  3. supprime dist/install.sql et tout autre fichier .sql du dossier de sortie ;
 *  4. obfusque le JavaScript final (dist/**\/*.js) avec javascript-obfuscator — ce même dossier dist/ est
 *     celui copié tel quel dans l'APK Android par « cap sync » et dans l'application de bureau Electron
 *     (extraResources), donc l'obfuscation s'applique aux trois cibles (PWA, APK, bureau) en une seule passe.
 *
 * Limite : l'application appelle forcément les tables et fonctions de la base ; leurs NOMS restent donc lisibles
 * dans le code (obfusqué ou non). Ce qui est masqué par le point 1-3, c'est le code SQL (structure complète,
 * corps des fonctions, règles RLS) ; ce qui est masqué par le point 4, c'est la logique JavaScript elle-même
 * (noms de variables/fonctions, chaînes de caractères). L'obfuscation ralentit et décourage un curieux qui
 * ouvrirait l'APK (simple fichier .zip) ou les outils de développement ; elle n'empêche pas un attaquant motivé
 * et outillé de revenir au comportement du code, car celui-ci s'exécute forcément côté client.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DDL_PATTERN =
  /CREATE\s+(OR\s+REPLACE\s+)?(TABLE|FUNCTION|POLICY|TRIGGER|INDEX|VIEW|TYPE)|ALTER\s+TABLE|DROP\s+(POLICY|TABLE|FUNCTION|TRIGGER)|SECURITY\s+DEFINER/i;

const TEMPLATE_ASSIGNMENT =
  /((?:\bconst\s+\w+\s*(?::\s*[\w<>[\]| ]+)?=|\breturn)\s*)`((?:[^`\\]|\\[\s\S])*)`/g;

/** Vide les gabarits `...` qui contiennent du SQL de définition (const x = `...` ou return `...`). */
export function blankSqlTemplates(code) {
  let count = 0;
  const out = String(code).replace(TEMPLATE_ASSIGNMENT, (match, prefix, body) => {
    if (DDL_PATTERN.test(body)) {
      count += 1;
      return `${prefix}''`;
    }
    return match;
  });
  return { code: out, count };
}

export function isTesterDistribution(env = process.env) {
  return String(env.VITE_DISTRIBUTION || '').trim().toLowerCase() === 'tester';
}

function removeSqlFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += removeSqlFiles(full);
    } else if (/\.sql$/i.test(entry.name)) {
      fs.rmSync(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/** Options d'obfuscation : équilibre protection / taille / vitesse d'exécution sur mobile (webview Android). */
export const OBFUSCATOR_OPTIONS = {
  compact: true,
  // Désactivés : coûteux en taille et en temps d'exécution sur un appareil mobile, pour un gain de protection
  // marginal par rapport au reste des réglages.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  // renameProperties reste FAUX : l'application accède à des propriétés par nom dynamique (clés venant de
  // Supabase, JSON, i18n...) ; le renommage casserait ces accès au lieu de les protéger.
  renameProperties: false,
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  rotateStringArray: true,
  shuffleStringArray: true,
  // Protection anti-manipulation du code en mémoire, sans bloquer l'ouverture des outils de développement
  // (utile si un testeur doit vous envoyer une erreur console en support).
  selfDefending: true,
  debugProtection: false,
  disableConsoleOutput: false,
  numbersToExpressions: true,
  splitStrings: false,
  target: 'browser',
};

/** Fichiers du dossier de sortie à ne jamais obfusquer (comportement figé attendu par le navigateur/webview). */
function isProtectedBuildFile(fileName) {
  return (
    fileName === 'sw.js' ||
    fileName === 'boot-guard.js' ||
    /^workbox-/i.test(fileName) ||
    /\.min\.map$|\.map$/i.test(fileName)
  );
}

function listJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listJsFiles(full, out);
    } else if (/\.(js|mjs|cjs)$/i.test(entry.name) && !isProtectedBuildFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Obfusque tous les fichiers JavaScript du dossier de build (en place, même nom de fichier : les références
 * dans index.html et entre modules ne changent pas). Lève une erreur explicite si javascript-obfuscator
 * n'est pas installé : en build testeurs, mieux vaut un build en échec qu'un build livré sans protection.
 */
export async function obfuscateBuildOutput(outDir) {
  let JavaScriptObfuscator;
  try {
    ({ default: JavaScriptObfuscator } = await import('javascript-obfuscator'));
  } catch {
    throw new Error(
      "[tester-protect] javascript-obfuscator n'est pas installé (npm install) : le build testeurs ne peut pas être protégé. " +
        'Installez la dépendance ou construisez sans VITE_DISTRIBUTION=tester.'
    );
  }
  const files = listJsFiles(path.resolve(outDir));
  let bytesBefore = 0;
  let bytesAfter = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    bytesBefore += source.length;
    const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATOR_OPTIONS).getObfuscatedCode();
    bytesAfter += result.length;
    fs.writeFileSync(file, result, 'utf8');
  }
  return { files: files.length, bytesBefore, bytesAfter };
}

export function testerProtectPlugin(outDir = 'dist') {
  const enabled = isTesterDistribution();
  return {
    name: 'tot-tester-protect',
    enforce: 'pre',
    load(id) {
      if (!enabled) return null;
      if (/[\\/]supabase-client[\\/].*\?raw$/.test(id) || /[\\/]supabase-master[\\/].*\?raw$/.test(id)) {
        return 'export default "";';
      }
      return null;
    },
    transform(code, id) {
      if (!enabled) return null;
      const clean = id.split('?')[0];
      if (!/[\\/]src[\\/].*\.(ts|tsx)$/.test(clean) || /__tests__/.test(clean)) return null;
      const result = blankSqlTemplates(code);
      return result.count > 0 ? { code: result.code, map: null } : null;
    },
    async closeBundle() {
      if (!enabled) return;
      const removed = removeSqlFiles(path.resolve(outDir));
      console.log(`[tester-protect] build testeurs : ${removed} fichier(s) .sql retiré(s) de ${outDir}/`);
      const stats = await obfuscateBuildOutput(outDir);
      const pct = stats.bytesBefore > 0 ? Math.round((stats.bytesAfter / stats.bytesBefore) * 100) : 100;
      console.log(
        `[tester-protect] build testeurs : ${stats.files} fichier(s) JS obfusqué(s) dans ${outDir}/ (taille ${pct}% de l'original).`
      );
    },
  };
}
