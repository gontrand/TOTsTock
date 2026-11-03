#!/usr/bin/env node
/**
 * Génère les icônes de l'application de bureau à partir de l'icône existante du projet (`public/pwa-512x512.png`) :
 * - `desktop/build/icon.png` (512×512 pour Linux)
 * - `desktop/build/icon.ico` (conteneur Windows ICO encapsulant le PNG)
 * - `desktop/build/icon.icns` (conteneur macOS ICNS `ic09` 512×512 encapsulant le PNG)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePngPath = path.join(repoRoot, 'public', 'pwa-512x512.png');
const buildDir = path.resolve(__dirname, '..', 'build');

if (!fs.existsSync(sourcePngPath)) {
  console.error(`❌ Icône source introuvable : ${sourcePngPath}`);
  process.exit(1);
}

fs.mkdirSync(buildDir, { recursive: true });
const pngBuffer = fs.readFileSync(sourcePngPath);

// 1. Linux : icon.png (512x512)
const targetPngPath = path.join(buildDir, 'icon.png');
fs.writeFileSync(targetPngPath, pngBuffer);

// 2. Windows : icon.ico (Format ICO standard encapsulant une image PNG)
function createIcoFromPng(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(1, 4); // Count: 1 image

  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0); // Width (0 = 256+ px)
  dirEntry.writeUInt8(0, 1); // Height (0 = 256+ px)
  dirEntry.writeUInt8(0, 2); // Color palette
  dirEntry.writeUInt8(0, 3); // Reserved
  dirEntry.writeUInt16LE(1, 4); // Color planes
  dirEntry.writeUInt16LE(32, 6); // Bits per pixel
  dirEntry.writeUInt32LE(pngBuf.length, 8); // Image data size
  dirEntry.writeUInt32LE(6 + 16, 12); // Offset to image data

  return Buffer.concat([header, dirEntry, pngBuf]);
}

const targetIcoPath = path.join(buildDir, 'icon.ico');
fs.writeFileSync(targetIcoPath, createIcoFromPng(pngBuffer));

// 3. macOS : icon.icns (Format ICNS standard avec bloc `ic09` 512x512 PNG)
function createIcnsFromPng(pngBuf) {
  const totalLength = 8 + 8 + pngBuf.length;
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);

  const entryHeader = Buffer.alloc(8);
  entryHeader.write('ic09', 0, 4, 'ascii'); // 512x512 PNG
  entryHeader.writeUInt32BE(8 + pngBuf.length, 4);

  return Buffer.concat([header, entryHeader, pngBuf]);
}

const targetIcnsPath = path.join(buildDir, 'icon.icns');
fs.writeFileSync(targetIcnsPath, createIcnsFromPng(pngBuffer));

console.log('✅ Icônes bureau générées dans desktop/build/ (icon.png, icon.ico, icon.icns)');
