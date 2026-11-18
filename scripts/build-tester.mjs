#!/usr/bin/env node
/**
 * Build « testeurs » en une commande (Windows, Linux, macOS) :
 *   npm run build:tester
 * Active VITE_DISTRIBUTION=tester, construit l'application puis vérifie que dist/ ne contient plus de SQL
 * et que le JavaScript a bien été obfusqué (javascript-obfuscator doit être installé : npm install).
 */
import { spawnSync } from 'node:child_process';

const env = { ...process.env, VITE_DISTRIBUTION: 'tester' };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npm', ['run', 'build']);
run('node', ['scripts/check-tester-dist.mjs', 'dist']);
console.log('[build:tester] Build testeurs prêt : aucun script SQL embarqué, JavaScript obfusqué.');
