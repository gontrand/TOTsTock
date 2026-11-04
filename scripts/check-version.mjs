import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const desktopPkgPath = path.join(rootDir, 'desktop', 'package.json');
const appVersionPath = path.join(rootDir, 'src', 'appVersion.ts');
const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
const versionCodeJsonPath = path.join(rootDir, 'android', 'version-code.json');

const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const appVersionSource = fs.readFileSync(appVersionPath, 'utf-8');

const match = appVersionSource.match(/export\s+const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!match) {
  console.error('[check:version] ERREUR : Constante APP_VERSION introuvable dans src/appVersion.ts');
  process.exit(1);
}

const appVersion = match[1].trim();
const pkgVersion = String(pkgJson.version || '').trim();

if (appVersion !== pkgVersion) {
  console.error(
    `[check:version] ERREUR DE COHÉRENCE DE VERSION : package.json (${pkgVersion}) !== APP_VERSION dans src/appVersion.ts (${appVersion}).`
  );
  process.exit(1);
}

// Vérification Desktop (desktop/package.json)
if (!fs.existsSync(desktopPkgPath)) {
  console.error('[check:version] ERREUR : Fichier desktop/package.json introuvable.');
  process.exit(1);
}
const desktopPkgJson = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf-8'));
const desktopPkgVersion = String(desktopPkgJson.version || '').trim();
if (appVersion !== desktopPkgVersion) {
  console.error(
    `[check:version] ERREUR DE COHÉRENCE BUREAU : desktop/package.json (${desktopPkgVersion}) !== APP_VERSION dans src/appVersion.ts (${appVersion}).`
  );
  process.exit(1);
}

// Vérification Android (android/app/build.gradle & android/version-code.json)
if (!fs.existsSync(gradlePath)) {
  console.error('[check:version] ERREUR : Fichier android/app/build.gradle introuvable.');
  process.exit(1);
}
if (!fs.existsSync(versionCodeJsonPath)) {
  console.error('[check:version] ERREUR : Fichier android/version-code.json introuvable.');
  process.exit(1);
}

const gradleSource = fs.readFileSync(gradlePath, 'utf-8');
const versionCodeJson = JSON.parse(fs.readFileSync(versionCodeJsonPath, 'utf-8'));
const expectedMinVersionCode = Number(versionCodeJson.versionCode);

if (!Number.isInteger(expectedMinVersionCode) || expectedMinVersionCode < 1) {
  console.error(
    `[check:version] ERREUR : versionCode invalide dans android/version-code.json (${versionCodeJson.versionCode}).`
  );
  process.exit(1);
}

const gradleVersionNameMatch = gradleSource.match(/versionName\s+["']([^"']+)["']/);
const gradleVersionCodeMatch = gradleSource.match(/versionCode\s+(\d+)/);

if (!gradleVersionNameMatch) {
  console.error('[check:version] ERREUR : versionName introuvable dans android/app/build.gradle.');
  process.exit(1);
}
if (!gradleVersionCodeMatch) {
  console.error('[check:version] ERREUR : versionCode introuvable dans android/app/build.gradle.');
  process.exit(1);
}

const gradleVersionName = gradleVersionNameMatch[1].trim();
const gradleVersionCode = Number(gradleVersionCodeMatch[1]);

if (gradleVersionName !== appVersion) {
  console.error(
    `[check:version] ERREUR DE COHÉRENCE ANDROID : versionName dans android/app/build.gradle (${gradleVersionName}) !== APP_VERSION (${appVersion}).`
  );
  process.exit(1);
}

if (gradleVersionCode < expectedMinVersionCode) {
  console.error(
    `[check:version] ERREUR DE COHÉRENCE ANDROID : versionCode dans android/app/build.gradle (${gradleVersionCode}) est inférieur à android/version-code.json (${expectedMinVersionCode}).`
  );
  process.exit(1);
}

const expectedSchemaMatch = appVersionSource.match(/export\s+const\s+EXPECTED_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
const minSchemaMatch = appVersionSource.match(/export\s+const\s+MIN_SUPPORTED_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);

if (!expectedSchemaMatch || !minSchemaMatch) {
  console.error('[check:version] ERREUR : Constantes EXPECTED_SCHEMA_VERSION ou MIN_SUPPORTED_SCHEMA_VERSION introuvables dans src/appVersion.ts');
  process.exit(1);
}

const expectedSchemaVersion = expectedSchemaMatch[1].trim();
const minSchemaVersion = minSchemaMatch[1].trim();

const sql07Path = path.join(rootDir, 'supabase-client', '07_app_compat.sql');
if (fs.existsSync(sql07Path)) {
  const sql07Source = fs.readFileSync(sql07Path, 'utf-8');
  if (!sql07Source.includes(`'${expectedSchemaVersion}'`)) {
    console.error(
      `[check:version] ERREUR DE COHÉRENCE SQL : 07_app_compat.sql ne mentionne pas EXPECTED_SCHEMA_VERSION (${expectedSchemaVersion}).`
    );
    process.exit(1);
  }
}

// Contrôle d'absence de fichiers *.apk dans public/, dist/ et android/app/src/main/assets/
function findFilesByExt(dirPath, ext, ignoredDirs = new Set()) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesByExt(fullPath, ext, ignoredDirs));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

const apkForbiddenDirs = [
  path.join(rootDir, 'public'),
  path.join(rootDir, 'dist'),
  path.join(rootDir, 'android', 'app', 'src', 'main', 'assets'),
];

for (const checkDir of apkForbiddenDirs) {
  const foundApks = findFilesByExt(checkDir, '.apk');
  if (foundApks.length > 0) {
    const relPaths = foundApks.map((p) => path.relative(rootDir, p)).join(', ');
    console.error(
      `[check:version] ERREUR SÉCURITÉ APK : Fichier(s) *.apk interdit(s) détecté(s) dans le projet : ${relPaths}`
    );
    process.exit(1);
  }
}

// Contrôle d'absence d'installateurs bureau (.exe, .dmg, .AppImage, .deb) hors desktop/release
const installerIgnoredDirs = new Set(['node_modules', '.git', '.gradle', 'release']);
for (const ext of ['.exe', '.dmg', '.appimage', '.deb']) {
  const foundInstallers = findFilesByExt(rootDir, ext, installerIgnoredDirs);
  if (foundInstallers.length > 0) {
    const relPaths = foundInstallers.map((p) => path.relative(rootDir, p)).join(', ');
    console.error(
      `[check:version] ERREUR INSTALLATEUR BUREAU : Fichier(s) *${ext} détecté(s) dans le dépôt : ${relPaths}`
    );
    process.exit(1);
  }
}

// Contrôle d'absence de fichiers *.zip hors node_modules (interdiction des zips imbriqués dans le projet)
const zipIgnoredDirs = new Set(['node_modules', '.git', '.gradle']);
const foundZips = findFilesByExt(rootDir, '.zip', zipIgnoredDirs);
if (foundZips.length > 0) {
  const relPaths = foundZips.map((p) => path.relative(rootDir, p)).join(', ');
  console.error(
    `[check:version] ERREUR ARCHIVE ZIP IMBRIQUÉE : Fichier(s) *.zip interdit(s) détecté(s) hors node_modules : ${relPaths}`
  );
  process.exit(1);
}

// Contrôle d'absence de clé privée dans tout fichier *.pem du dépôt
const allPemFiles = findFilesByExt(
  rootDir,
  '.pem',
  new Set(['node_modules', '.git', '.gradle', 'build'])
);
for (const pemFile of allPemFiles) {
  const content = fs.readFileSync(pemFile, 'utf-8');
  if (content.includes('PRIVATE KEY')) {
    const relPath = path.relative(rootDir, pemFile);
    console.error(
      `[check:version] ERREUR SÉCURITÉ CLÉ PRIVÉE : Fichier *.pem contenant "PRIVATE KEY" détecté dans le dépôt : ${relPath}`
    );
    process.exit(1);
  }
}

console.log(
  `[check:version] OK : package.json, desktop/package.json, APP_VERSION et android/app/build.gradle sont alignés sur v${appVersion} (versionCode=${gradleVersionCode} >= ${expectedMinVersionCode}, schema=${expectedSchemaVersion}, minSchema=${minSchemaVersion}, 0 APK embarqué, 0 zip imbriqué, 0 clé privée .pem).`
);


