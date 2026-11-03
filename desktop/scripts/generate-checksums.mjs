#!/usr/bin/env node
/**
 * Calcule l'empreinte SHA-256 de tous les installateurs générés dans `desktop/release/`
 * et produit le fichier `desktop/release/SHA256SUMS.txt`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const releaseDir = path.resolve(__dirname, '..', 'release');
const INSTALLER_EXTENSIONS = new Set(['.exe', '.dmg', '.appimage', '.deb', '.zip', '.tar.gz']);

if (!fs.existsSync(releaseDir)) {
  console.log('ℹ️ Dossier desktop/release/ absent, aucun fichier SHA256SUMS.txt à générer.');
  process.exit(0);
}

const entries = fs.readdirSync(releaseDir, { withFileTypes: true });
const lines = [];

for (const entry of entries) {
  if (!entry.isFile()) continue;
  const ext = path.extname(entry.name).toLowerCase();
  if (!INSTALLER_EXTENSIONS.has(ext)) continue;

  const fullPath = path.join(releaseDir, entry.name);
  const fileBuffer = fs.readFileSync(fullPath);
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  lines.push(`${sha256}  ${entry.name}`);
}

const outputPath = path.join(releaseDir, 'SHA256SUMS.txt');
fs.writeFileSync(outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
console.log(`✅ Empreintes SHA-256 écrites dans ${outputPath} (${lines.length} fichier(s)).`);
