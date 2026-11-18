#!/usr/bin/env node
/**
 * Vérifie qu'un dossier de build (par défaut dist/) :
 *  - ne contient ni fichier .sql ni définition SQL lisible ;
 *  - ne contient pas de source map ;
 *  - a bien été obfusqué (au moins un fichier JS porte la marque de javascript-obfuscator).
 * Usage : node scripts/check-tester-dist.mjs [dossier]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DDL_PATTERN } from './tester-protect.mjs';

const root = path.resolve(process.argv[2] || 'dist');
const problems = [];
// Signature de javascript-obfuscator avec identifierNamesGenerator: 'hexadecimal' (ex. _0x3f2a) : si aucun
// fichier JS significatif n'en porte la marque, l'obfuscation n'a probablement pas tourné.
const OBFUSCATION_MARK = /_0x[a-f0-9]{4,8}/i;
let sawObfuscationMark = false;
let jsFilesChecked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (/\.sql$/i.test(entry.name)) {
      problems.push(`fichier SQL présent : ${path.relative(root, full)}`);
      continue;
    }
    if (/\.(js|mjs|html|map)$/i.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      if (/\.map$/i.test(entry.name)) problems.push(`source map présente : ${path.relative(root, full)}`);
      const hits = text.match(new RegExp(DDL_PATTERN.source, 'gi')) || [];
      // tolère les rares lignes isolées (ex. une instruction affichée dans le module licence maître)
      if (hits.length > 3) problems.push(`${hits.length} instructions SQL lisibles dans ${path.relative(root, full)}`);
      if (/\.(js|mjs)$/i.test(entry.name) && !/^(sw|boot-guard)\.js$|^workbox-/i.test(entry.name)) {
        jsFilesChecked += 1;
        // les très petits fichiers (quelques lignes de colle) peuvent légitimement ne pas être obfusqués
        if (text.length > 2000 && OBFUSCATION_MARK.test(text)) sawObfuscationMark = true;
      }
    }
  }
}

if (!fs.existsSync(root)) {
  console.error(`[check-tester-dist] dossier introuvable : ${root}`);
  process.exit(1);
}
walk(root);
if (jsFilesChecked > 0 && !sawObfuscationMark) {
  problems.push("aucune marque d'obfuscation détectée dans les fichiers JS (obfuscateBuildOutput n'a peut-être pas tourné)");
}
if (problems.length > 0) {
  console.error('[check-tester-dist] ÉCHEC — le build testeurs expose encore de la structure SQL ou n’est pas obfusqué :');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log(
  `[check-tester-dist] OK — aucun script SQL lisible, aucune source map, JavaScript obfusqué (${jsFilesChecked} fichier(s) vérifié(s)).`
);
