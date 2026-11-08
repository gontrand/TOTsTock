#!/usr/bin/env node
/**
 * TOT Stock — Installateur & Mise à jour rapide Supabase (v24)
 *
 * Commande :
 *   node scripts/tot-install.mjs [options]
 *   npm run install:tot -- [options]
 *
 * Options prises en charge :
 *   --update                      Exécute uniquement les étapes 2, 3 et 7 (mise à jour compatible)
 *   --dry-run                     Affiche et simule les étapes sans rien modifier
 *   --yes                         Mode non interactif (CI/CD), n'interroge jamais le clavier
 *   --no-functions                Saute le déploiement des Edge Functions (étape 3)
 *   --no-admin                    Saute la création du premier Super Administrateur (étape 5)
 *   --maintenance                 Active maintenance = true dans app_compat avant db push et le remet à false en finally
 *   --set-min-app-version <x>     Met à jour min_app_version lors d'un --update
 *   --project-ref <ref>           Référence du projet Supabase (sinon SUPABASE_PROJECT_REF ou saisie interactive)
 *
 * Sécurité :
 *   - Aucun secret (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, service_role, mot de passe admin, clé de licence)
 *     n'est jamais affiché à l'écran, écrit dans les journaux ou enregistré dans tot-install-report.txt.
 *   - Les adresses e-mail personnelles sont masquées dans le rapport (ex. g***@gmail.com).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export const TABLES = {
  users: 'core_users',
  appSettings: 'core_app_settings',
  appCompat: 'core_app_compat',
};

/**
 * Lit les constantes de version depuis src/appVersion.ts
 */
export function readAppVersionConstants(rootDir = ROOT_DIR) {
  const versionFile = path.join(rootDir, 'src', 'appVersion.ts');
  let appVersion = '5.5.0';
  let expectedSchemaVersion = '1.0.0';
  let minSupportedSchemaVersion = '1.0.0';

  if (fs.existsSync(versionFile)) {
    const content = fs.readFileSync(versionFile, 'utf8');
    const appMatch = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const schemaMatch = content.match(/EXPECTED_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const minSchemaMatch = content.match(/MIN_SUPPORTED_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (appMatch) appVersion = appMatch[1];
    if (schemaMatch) expectedSchemaVersion = schemaMatch[1];
    if (minSchemaMatch) minSupportedSchemaVersion = minSchemaMatch[1];
  }

  return { appVersion, expectedSchemaVersion, minSupportedSchemaVersion };
}

/**
 * Compare deux versions SemVer (ex: "1.2.0" vs "1.1.0")
 * Retourne -1 si a < b, 0 si a == b, 1 si a > b
 */
export function compareSemver(a, b) {
  const cleanA = String(a || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const cleanB = String(b || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length, 3);
  for (let i = 0; i < len; i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Vérifie que la version cible du schéma n'est pas plus ancienne que celle déjà présente en base (Point 4)
 */
export function checkSchemaDowngradeGuard(dbSchemaVersion, targetSchemaVersion) {
  if (!dbSchemaVersion) {
    return { allowed: true, reason: null };
  }
  if (compareSemver(targetSchemaVersion, dbSchemaVersion) < 0) {
    return {
      allowed: false,
      reason: `Refus de rétrogradation : le schéma en base (${dbSchemaVersion}) est plus récent que la version cible (${targetSchemaVersion}).`,
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Masque une adresse e-mail (ex: "guillaume@gmail.com" -> "g***@gmail.com")
 */
export function maskEmail(email) {
  const raw = String(email || '').trim();
  if (!raw || !raw.includes('@')) return '***';
  const [local, domain] = raw.split('@');
  if (!local) return `***@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Nettoie toute chaîne de texte en remplaçant toute occurrence d'un secret connu par [MASQUÉ]
 */
export function sanitizeLogText(text, secrets = []) {
  let output = String(text ?? '');
  for (const s of secrets) {
    const trimmed = String(s ?? '').trim();
    if (trimmed && trimmed.length >= 4) {
      output = output.split(trimmed).join('[MASQUÉ]');
    }
  }
  // Masque également les jetons sbp_..., eyJ... (JWT), xkeysib-...
  output = output.replace(/sbp_[a-zA-Z0-9_-]{8,}/g, '[MASQUÉ]');
  output = output.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[MASQUÉ]');
  output = output.replace(/xkeysib-[a-zA-Z0-9_-]{8,}/g, '[MASQUÉ]');
  output = output.replace(/--password\s+\S+/g, '--password [MASQUÉ]');
  return output;
}

/**
 * Valide la complexité du mot de passe Super Administrateur (>= 10 caractères, majuscule, minuscule, chiffre)
 */
export function validateAdminPassword(password) {
  const pwd = String(password || '');
  if (pwd.length < 10) {
    return { valid: false, reason: 'Le mot de passe doit contenir au moins 10 caractères.' };
  }
  if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
    return {
      valid: false,
      reason: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.',
    };
  }
  return { valid: true, reason: null };
}

/**
 * Analyse les arguments de la ligne de commande
 */
export function parseCliArgs(argv = process.argv.slice(2)) {
  const flags = {
    update: false,
    dryRun: false,
    yes: false,
    noFunctions: false,
    noAdmin: false,
    maintenance: false,
    setMinAppVersion: null,
    projectRef: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--update') flags.update = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--no-functions') flags.noFunctions = true;
    else if (arg === '--no-admin') flags.noAdmin = true;
    else if (arg === '--maintenance') flags.maintenance = true;
    else if (arg === '--set-min-app-version' && argv[i + 1]) {
      flags.setMinAppVersion = argv[++i];
    } else if (arg.startsWith('--set-min-app-version=')) {
      flags.setMinAppVersion = arg.split('=')[1] || null;
    } else if (arg === '--project-ref' && argv[i + 1]) {
      flags.projectRef = argv[++i];
    } else if (arg.startsWith('--project-ref=')) {
      flags.projectRef = arg.split('=')[1] || null;
    }
  }

  return flags;
}

/**
 * Saisie interactive au clavier (avec masquage optionnel pour les mots de passe et jetons)
 */
function promptLine(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden || !process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(String(answer || '').trim());
      });
      return;
    }

    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (char) => {
      const ch = String(char);
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(Boolean(wasRaw));
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value.trim());
      } else if (ch === '\u0003') {
        stdin.setRawMode(Boolean(wasRaw));
        process.stdout.write('\nInterruption utilisateur.\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
        }
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Formate le rapport final écrit dans tot-install-report.txt (aucun secret, données personnelles masquées)
 */
export function formatInstallReport({
  appVersion,
  expectedSchemaVersion,
  projectRef,
  mode,
  dryRun,
  steps,
  adminEmail,
  diagnosticRows,
  secrets = [],
  timestamp = new Date().toISOString(),
}) {
  const lines = [
    '================================================================================',
    `TOT STOCK — RAPPORT D'INSTALLATION / MISE À JOUR (v${appVersion})`,
    '================================================================================',
    `Date                : ${timestamp}`,
    `Mode                : ${mode}${dryRun ? ' (DRY-RUN / SIMULATION)' : ''}`,
    `Projet Supabase     : ${projectRef || 'non spécifié'}`,
    `Version application : ${appVersion}`,
    `Schéma cible        : ${expectedSchemaVersion}`,
    adminEmail ? `Super Admin         : ${maskEmail(adminEmail)}` : null,
    '--------------------------------------------------------------------------------',
    'ÉTAPES EXÉCUTÉES :',
  ].filter(Boolean);

  for (const s of steps) {
    lines.push(`  [${s.status.padEnd(9, ' ')}] Étape ${s.step} — ${s.title} : ${s.details}`);
  }

  if (Array.isArray(diagnosticRows) && diagnosticRows.length > 0) {
    lines.push('--------------------------------------------------------------------------------');
    lines.push('DIAGNOSTIC SQL (public.diagnostic_installation) :');
    for (const r of diagnosticRows) {
      lines.push(`  [${String(r.status).padEnd(9, ' ')}] ${r.check_label} (${r.check_key}) : ${r.details}`);
    }
  }

  lines.push('================================================================================');
  return sanitizeLogText(lines.join('\n') + '\n', secrets);
}

/**
 * Exécute une commande Supabase CLI via npx supabase (zéro dépendance globale)
 */
function defaultRunCli(args, { env = {}, secrets = [], cwd = ROOT_DIR } = {}) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'npx.cmd' : 'npx';
  const fullArgs = ['--yes', 'supabase', ...args];
  const res = spawnSync(cmd, fullArgs, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: isWin,
  });

  const stdout = sanitizeLogText(res.stdout || '', secrets);
  const stderr = sanitizeLogText(res.stderr || '', secrets);
  return {
    status: res.status ?? 1,
    stdout,
    stderr,
  };
}

/**
 * Exécute l'installation ou la mise à jour complète (exportée pour tests Vitest sans réseau)
 */
export async function runTotInstall(options = {}) {
  const flags = options.flags || parseCliArgs(options.argv);
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const runCli = options.runCli || defaultRunCli;
  const promptFn = options.promptFn || promptLine;
  const createSupabaseClient = options.createSupabaseClient || createClient;
  const reportPath = options.reportPath || path.join(ROOT_DIR, 'tot-install-report.txt');
  const logger = options.logger || console;

  const { appVersion, expectedSchemaVersion } = readAppVersionConstants(ROOT_DIR);

  let projectRef = (flags.projectRef || env.SUPABASE_PROJECT_REF || '').trim();
  let accessToken = (env.SUPABASE_ACCESS_TOKEN || '').trim();
  let dbPassword = (env.SUPABASE_DB_PASSWORD || '').trim();
  let licenseKey = (env.TOT_LICENSE_KEY || '').trim();
  let adminEmail = (env.TOT_ADMIN_EMAIL || '').trim();
  let adminPassword = (env.TOT_ADMIN_PASSWORD || '').trim();

  if (!flags.yes && !flags.dryRun) {
    if (!projectRef) {
      projectRef = await promptFn('Référence du projet Supabase (ex: abcdefghijklmnopqrst) : ', {
        hidden: false,
      });
    }
    if (!accessToken) {
      accessToken = await promptFn('Jeton personnel Supabase (SUPABASE_ACCESS_TOKEN, masqué) : ', {
        hidden: true,
      });
    }
    if (!dbPassword) {
      dbPassword = await promptFn('Mot de passe base PostgreSQL (SUPABASE_DB_PASSWORD, masqué) : ', {
        hidden: true,
      });
    }
  } else if (flags.dryRun) {
    projectRef = projectRef || 'dryrun-project-ref';
  }

  const knownSecrets = [accessToken, dbPassword, licenseKey, adminPassword].filter(Boolean);
  const steps = [];
  const diagnosticRows = [];

  const logStep = (step, title, status, details) => {
    const cleanDetails = sanitizeLogText(details, knownSecrets);
    steps.push({ step, title, status, details: cleanDetails });
    logger.log(`[${status}] Étape ${step} (${title}) : ${cleanDetails}`);
  };

  let serviceRoleKey = null;
  let anonKey = null;
  let adminClient = null;
  let maintenanceActivated = false;

  const setMaintenanceMode = async (enabled) => {
    if (!adminClient || flags.dryRun) return;
    try {
      await adminClient
        .from(TABLES.appCompat)
        .update({
          maintenance: Boolean(enabled),
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
    } catch {
      // ignore if table does not exist yet
    }
  };

  try {
    // =========================================================================
    // ÉTAPE 1 — Vérification des prérequis (Node >= 20, réseau, jeton, projet)
    // =========================================================================
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMajor < 20) {
      logStep(1, 'Prérequis', 'ERREUR', `Node.js >= 20 requis (version actuelle : ${process.versions.node}).`);
      throw new Error('Node.js < 20');
    }

    if (flags.dryRun) {
      logStep(
        1,
        'Prérequis',
        'OK',
        `Simulation (--dry-run) : Node ${process.versions.node}, projet cible ${projectRef}.`
      );
    } else {
      if (!projectRef || !accessToken || !dbPassword) {
        logStep(
          1,
          'Prérequis',
          'ERREUR',
          'SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN et SUPABASE_DB_PASSWORD sont requis.'
        );
        throw new Error('Paramètres requis manquants');
      }

      // Vérifie l'accès au projet via Management API officielle : GET /v1/projects/{ref}
      const projRes = await fetchImpl(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!projRes.ok) {
        logStep(
          1,
          'Prérequis',
          'ERREUR',
          `Projet Supabase "${projectRef}" injoignable ou jeton invalide (HTTP ${projRes.status}).`
        );
        throw new Error(`Échec vérification projet HTTP ${projRes.status}`);
      }

      // Récupération des clés API du projet : GET /v1/projects/{ref}/api-keys
      const keysRes = await fetchImpl(
        `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/api-keys`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );

      if (keysRes.ok) {
        const keysData = await keysRes.json();
        if (Array.isArray(keysData)) {
          const sr = keysData.find((k) => k.name === 'service_role' || String(k.tags || '').includes('service_role'));
          const an = keysData.find((k) => k.name === 'anon' || String(k.tags || '').includes('anon'));
          if (sr?.api_key) {
            serviceRoleKey = String(sr.api_key);
            knownSecrets.push(serviceRoleKey);
          }
          if (an?.api_key) {
            anonKey = String(an.api_key);
          }
        }
      }

      if (serviceRoleKey) {
        const supabaseUrl = `https://${projectRef}.supabase.co`;
        adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      }

      logStep(1, 'Prérequis', 'OK', `Node ${process.versions.node}, projet ${projectRef} accessible.`);
    }

    // =========================================================================
    // CONTRÔLE DE NON-RÉTROGRADATION & MODE MAINTENANCE (Point 4)
    // =========================================================================
    if (adminClient && !flags.dryRun) {
      const { data: compatRow } = await adminClient
        .from(TABLES.appCompat)
        .select('schema_version, min_app_version, min_schema_version, maintenance')
        .eq('id', 1)
        .maybeSingle();

      if (compatRow?.schema_version) {
        const guard = checkSchemaDowngradeGuard(compatRow.schema_version, expectedSchemaVersion);
        if (!guard.allowed) {
          logStep(2, 'Schéma & Migrations', 'ERREUR', guard.reason);
          throw new Error(guard.reason);
        }
      }

      if (flags.maintenance) {
        await setMaintenanceMode(true);
        maintenanceActivated = true;
      }
    }

    // =========================================================================
    // ÉTAPE 2 — Liaison du projet et application des migrations (db push)
    // =========================================================================
    if (flags.dryRun) {
      logStep(
        2,
        'Schéma & Migrations',
        'OK',
        `Simulation : génération des migrations SQL puis npx supabase link --project-ref ${projectRef} && npx supabase db push.`
      );
    } else {
      const linkRes = runCli(
        ['link', '--project-ref', projectRef, '--password', dbPassword],
        {
          env: { SUPABASE_ACCESS_TOKEN: accessToken, SUPABASE_DB_PASSWORD: dbPassword },
          secrets: knownSecrets,
        }
      );

      if (linkRes.status !== 0) {
        logStep(2, 'Schéma & Migrations', 'ERREUR', `Échec de supabase link : ${linkRes.stderr || linkRes.stdout}`);
        throw new Error('Échec supabase link');
      }

      const pushRes = runCli(['db', 'push', '--password', dbPassword], {
        env: { SUPABASE_ACCESS_TOKEN: accessToken, SUPABASE_DB_PASSWORD: dbPassword },
        secrets: knownSecrets,
      });

      if (pushRes.status !== 0) {
        logStep(2, 'Schéma & Migrations', 'ERREUR', `Échec de supabase db push : ${pushRes.stderr || pushRes.stdout}`);
        throw new Error('Échec supabase db push');
      }

      logStep(2, 'Schéma & Migrations', 'OK', 'Projet lié et migrations SQL appliquées avec succès.');
    }

    // =========================================================================
    // ÉTAPE 3 — Déploiement des 4 Edge Functions (sans secret manuel)
    // =========================================================================
    const edgeFunctions = [
      'APP_TOT-Stock_admin-users',
      'APP_TOT-Stock_licenses_sync-license',
      'APP_TOT-Stock_send-report-email',
      'APP_TOT-Stock_password-reset',
    ];
    if (flags.noFunctions) {
      logStep(3, 'Edge Functions', 'ATTENTION', 'Déploiement des fonctions ignoré (--no-functions).');
    } else if (flags.dryRun) {
      logStep(
        3,
        'Edge Functions',
        'OK',
        `Simulation : npx supabase functions deploy ${edgeFunctions.join(', ')} --project-ref ${projectRef}.`
      );
    } else {
      for (const fnName of edgeFunctions) {
        const depRes = runCli(['functions', 'deploy', fnName, '--project-ref', projectRef], {
          env: { SUPABASE_ACCESS_TOKEN: accessToken },
          secrets: knownSecrets,
        });
        if (depRes.status !== 0) {
          logStep(
            3,
            'Edge Functions',
            'ERREUR',
            `Échec du déploiement de ${fnName} : ${depRes.stderr || depRes.stdout}`
          );
          throw new Error(`Échec déploiement ${fnName}`);
        }
      }

      // Enregistre le statut des fonctions déployées dans app_settings pour diagnostic_installation()
      if (adminClient) {
        try {
          await adminClient.from(TABLES.appSettings).upsert(
            [
              {
                key: 'edge_functions_status',
                value: JSON.stringify({
                  deployed: edgeFunctions,
                  version: appVersion,
                  updated_at: new Date().toISOString(),
                }),
                updated_at: new Date().toISOString(),
              },
            ],
            { onConflict: 'key' }
          );
        } catch {}
      }

      logStep(3, 'Edge Functions', 'OK', `4 fonctions déployées (${edgeFunctions.join(', ')}) sans secret manuel.`);
    }

    // =========================================================================
    // ÉTAPE 4 — Désactivation des inscriptions publiques (sauf en --update)
    // =========================================================================
    if (!flags.update) {
      if (flags.dryRun) {
        logStep(
          4,
          'Inscriptions publiques',
          'OK',
          `Simulation : PATCH /v1/projects/${projectRef}/config/auth { disable_signup: true }.`
        );
      } else {
        try {
          const authRes = await fetchImpl(
            `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ disable_signup: true }),
            }
          );

          if (authRes.ok) {
            logStep(4, 'Inscriptions publiques', 'OK', 'Inscriptions publiques désactivées (disable_signup = true).');
          } else {
            logStep(
              4,
              'Inscriptions publiques',
              'ATTENTION',
              `API Management HTTP ${authRes.status}. Action manuelle : ouvrez Supabase Dashboard > Authentication > Providers > Email et décochez "Allow new users to sign up".`
            );
          }
        } catch {
          logStep(
            4,
            'Inscriptions publiques',
            'ATTENTION',
            'Impossible de contacter /config/auth. Action manuelle : dans Supabase Dashboard > Authentication > User Signups, désactivez "Allow new users to sign up".'
          );
        }
      }
    }

    // =========================================================================
    // ÉTAPE 5 — Création du premier Super Administrateur (si aucun rôle 0)
    // =========================================================================
    if (!flags.update) {
      if (flags.noAdmin) {
        logStep(5, 'Super Administrateur', 'ATTENTION', 'Création du Super Administrateur ignorée (--no-admin).');
      } else if (flags.dryRun) {
        logStep(
          5,
          'Super Administrateur',
          'OK',
          'Simulation : vérification de public.users (role_id = 0) et création du compte Auth + profil lié si absent.'
        );
      } else if (!adminClient) {
        logStep(
          5,
          'Super Administrateur',
          'ATTENTION',
          'Clé service_role non récupérée via Management API ; création du Super Administrateur ignorée.'
        );
      } else {
        const { data: existingAdmins } = await adminClient
          .from(TABLES.users)
          .select('id, email, role_id')
          .eq('role_id', 0)
          .limit(1);

        if (Array.isArray(existingAdmins) && existingAdmins.length > 0) {
          adminEmail = existingAdmins[0].email || adminEmail;
          logStep(
            5,
            'Super Administrateur',
            'OK',
            `Un Super Administrateur (rôle 0) existe déjà (${maskEmail(existingAdmins[0].email)}), étape ignorée.`
          );
        } else {
          if (!adminEmail && !flags.yes) {
            adminEmail = await promptFn('Adresse e-mail du premier Super Administrateur : ', { hidden: false });
          }
          if (!adminPassword && !flags.yes) {
            adminPassword = await promptFn(
              'Mot de passe du Super Administrateur (>= 10 car., maj, min, chiffre, masqué) : ',
              { hidden: true }
            );
            if (adminPassword) knownSecrets.push(adminPassword);
          }

          const pwdCheck = validateAdminPassword(adminPassword);
          if (!adminEmail || !pwdCheck.valid) {
            logStep(
              5,
              'Super Administrateur',
              'ERREUR',
              pwdCheck.reason || 'Adresse e-mail du Super Administrateur manquante.'
            );
            throw new Error(pwdCheck.reason || 'Super Admin invalide');
          }

          const { data: createdAuth, error: createAuthErr } = await adminClient.auth.admin.createUser({
            email: adminEmail.toLowerCase(),
            password: adminPassword,
            email_confirm: true,
            user_metadata: { name: 'Super Administrateur', role_id: 0 },
          });

          if (createAuthErr && !String(createAuthErr.message || '').toLowerCase().includes('already')) {
            logStep(5, 'Super Administrateur', 'ERREUR', `Échec création Auth : ${createAuthErr.message}`);
            throw new Error('Échec création Auth Super Admin');
          }

          let authUid = createdAuth?.user?.id || null;
          if (!authUid) {
            const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
            const found = listData?.users?.find(
              (u) => String(u.email || '').toLowerCase() === adminEmail.toLowerCase()
            );
            authUid = found?.id || null;
          }

          const profileId = authUid || 'super-admin-0';
          const { error: upsertErr } = await adminClient.from(TABLES.users).upsert(
            [
              {
                id: String(profileId),
                auth_user_id: authUid,
                name: 'Super Administrateur',
                trigram: 'ADM',
                email: adminEmail.toLowerCase(),
                department: 'Direction',
                role_id: 0,
                is_blocked: false,
                must_change_pin: false,
                allowed_depots: ['*'],
              },
            ],
            { onConflict: 'id' }
          );

          if (upsertErr) {
            logStep(5, 'Super Administrateur', 'ERREUR', `Échec profil public.${TABLES.users} : ${upsertErr.message}`);
            throw new Error('Échec création profil Super Admin');
          }

          logStep(
            5,
            'Super Administrateur',
            'OK',
            `Super Administrateur créé et confirmé (${maskEmail(adminEmail)}).`
          );
        }
      }
    }

    // =========================================================================
    // ÉTAPE 6 — Liaison de la licence (facultatif, sauf en --update)
    // =========================================================================
    if (!flags.update) {
      if (flags.dryRun) {
        logStep(6, 'Licence (facultatif)', 'OK', 'Simulation : appel optionnel à APP_TOT-Stock_licenses_sync-license si une clé est fournie.');
      } else {
        if (!licenseKey && !flags.yes) {
          licenseKey = await promptFn(
            'Clé de licence TOT Stock (Entrée pour rester en formule Free) : ',
            { hidden: true }
          );
          if (licenseKey) knownSecrets.push(licenseKey);
        }

        if (!licenseKey) {
          logStep(6, 'Licence (facultatif)', 'OK', 'Aucune clé saisie ; formule Free active par défaut.');
        } else {
          const fnUrl = `https://${projectRef}.supabase.co/functions/v1/APP_TOT-Stock_licenses_sync-license`;
          const bearer = serviceRoleKey || anonKey || '';
          const licRes = await fetchImpl(fnUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(bearer ? { Authorization: `Bearer ${bearer}`, apikey: bearer } : {}),
            },
            body: JSON.stringify({
              action: 'validate',
              license_key: licenseKey,
              client_url: `https://${projectRef}.supabase.co`,
            }),
          });

          if (licRes.ok) {
            logStep(6, 'Licence (facultatif)', 'OK', 'Licence liée et synchronisée via APP_TOT-Stock_licenses_sync-license.');
          } else {
            logStep(
              6,
              'Licence (facultatif)',
              'ATTENTION',
              `Liaison de licence non confirmée (HTTP ${licRes.status}). Vous pourrez la lier depuis l'application.`
            );
          }
        }
      }
    }

    // =========================================================================
    // MISE À JOUR DE app_compat EN FIN DE --update (Point 4)
    // =========================================================================
    if (flags.update && adminClient && !flags.dryRun) {
      const updatePayload = {
        schema_version: expectedSchemaVersion,
        latest_version: appVersion,
        updated_at: new Date().toISOString(),
      };
      if (flags.setMinAppVersion) {
        updatePayload.min_app_version = String(flags.setMinAppVersion).trim();
      }
      const { error: compatUpdateErr } = await adminClient
        .from(TABLES.appCompat)
        .update(updatePayload)
        .eq('id', 1);

      if (compatUpdateErr) {
        logStep(7, 'Mise à jour app_compat', 'ATTENTION', `Avertissement app_compat : ${compatUpdateErr.message}`);
      }
    }

    // =========================================================================
    // ÉTAPE 7 — Vérification finale via public.diagnostic_installation()
    // =========================================================================
    if (flags.dryRun) {
      diagnosticRows.push(
        {
          check_key: 'tables_present',
          check_label: 'Tables principales présentes',
          status: 'OK',
          details: 'Simulation dry-run : 12/12 tables présentes',
        },
        {
          check_key: 'edge_functions_deployed',
          check_label: 'Fonctions Edge déployées',
          status: 'OK',
          details: 'Simulation dry-run : APP_TOT-Stock_admin-users, APP_TOT-Stock_licenses_sync-license, APP_TOT-Stock_send-report-email',
        }
      );
      logStep(7, 'Vérification finale', 'OK', 'Simulation : appel de diagnostic_installation() réussi.');
    } else if (adminClient) {
      // Si les identifiants de l'admin créé sont disponibles et qu'une clé anon existe, teste la connexion Auth
      let diagClient = adminClient;
      if (anonKey && adminEmail && adminPassword) {
        const userClient = createSupabaseClient(`https://${projectRef}.supabase.co`, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error: signInErr } = await userClient.auth.signInWithPassword({
          email: adminEmail.toLowerCase(),
          password: adminPassword,
        });
        if (!signInErr) {
          diagClient = userClient;
        }
      }

      const { data: diagData, error: diagErr } = await diagClient.rpc('diagnostic_installation');
      if (diagErr) {
        logStep(7, 'Vérification finale', 'ERREUR', `Échec de diagnostic_installation() : ${diagErr.message}`);
        throw new Error('Échec diagnostic_installation');
      }

      if (Array.isArray(diagData)) {
        for (const row of diagData) {
          diagnosticRows.push({
            check_key: String(row.check_key || ''),
            check_label: String(row.check_label || ''),
            status: row.status || 'ATTENTION',
            details: sanitizeLogText(row.details || '', knownSecrets),
          });
        }
      }

      const hasDiagError = diagnosticRows.some((r) => r.status === 'ERREUR');
      const hasDiagWarn = diagnosticRows.some((r) => r.status === 'ATTENTION');
      logStep(
        7,
        'Vérification finale',
        hasDiagError ? 'ERREUR' : hasDiagWarn ? 'ATTENTION' : 'OK',
        `${diagnosticRows.length} contrôles exécutés via diagnostic_installation().`
      );
    } else {
      logStep(
        7,
        'Vérification finale',
        'ATTENTION',
        'Diagnostic automatique ignoré (clé API projet non disponible).'
      );
    }
  } catch (err) {
    // L'étape en erreur a déjà été enregistrée dans steps
    if (!steps.some((s) => s.status === 'ERREUR')) {
      logStep(0, 'Exécution', 'ERREUR', err?.message || 'Erreur inattendue');
    }
  } finally {
    if (maintenanceActivated && adminClient && !flags.dryRun) {
      await setMaintenanceMode(false);
    }
  }

  const reportContent = formatInstallReport({
    appVersion,
    expectedSchemaVersion,
    projectRef,
    mode: flags.update ? 'UPDATE' : 'INSTALL',
    dryRun: flags.dryRun,
    steps,
    adminEmail,
    diagnosticRows,
    secrets: knownSecrets,
  });

  if (reportPath) {
    fs.writeFileSync(reportPath, reportContent, 'utf8');
  }

  const hasError = steps.some((s) => s.status === 'ERREUR') || diagnosticRows.some((r) => r.status === 'ERREUR');
  return {
    exitCode: hasError ? 1 : 0,
    steps,
    diagnosticRows,
    reportContent,
  };
}

// Exécution directe en ligne de commande
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runTotInstall().then((res) => {
    process.exit(res.exitCode);
  });
}
