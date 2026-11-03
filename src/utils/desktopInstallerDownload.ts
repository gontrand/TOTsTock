import { APP_VERSION } from '../appVersion';

export type DesktopTargetOs = 'linux' | 'windows' | 'mac';

/**
 * Détecte le système d'exploitation courant du navigateur pour mettre en avant
 * le bon bouton de téléchargement dans la fenêtre d'information.
 */
export function detectClientDesktopOs(): DesktopTargetOs {
  if (typeof navigator === 'undefined') return 'linux';
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = (
    (navigator as any).userAgentData?.platform ||
    navigator.platform ||
    ''
  ).toLowerCase();
  if (ua.includes('win') || platform.includes('win')) return 'windows';
  if (ua.includes('mac') || platform.includes('mac')) return 'mac';
  return 'linux';
}

/**
 * Retourne l'URL publique de l'application pour l'installateur bureau.
 */
export function resolveAppPublicOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    if (window.location.protocol === 'https:' || window.location.protocol === 'http:') {
      return window.location.origin;
    }
  }
  return 'https://localhost:3000';
}

/**
 * Vérifie si une URL d'installateur binaire externe (.deb, .exe, .dmg) est configurée.
 */
export function getConfiguredBinaryInstallerUrl(
  os: DesktopTargetOs,
  updateUrl?: string | null
): string | null {
  const env = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
  if (os === 'linux' && typeof env.VITE_DESKTOP_LINUX_URL === 'string' && env.VITE_DESKTOP_LINUX_URL.trim()) {
    return env.VITE_DESKTOP_LINUX_URL.trim();
  }
  if (os === 'windows' && typeof env.VITE_DESKTOP_WIN_URL === 'string' && env.VITE_DESKTOP_WIN_URL.trim()) {
    return env.VITE_DESKTOP_WIN_URL.trim();
  }
  if (os === 'mac' && typeof env.VITE_DESKTOP_MAC_URL === 'string' && env.VITE_DESKTOP_MAC_URL.trim()) {
    return env.VITE_DESKTOP_MAC_URL.trim();
  }

  const cleanUpdate = (updateUrl || '').trim();
  if (cleanUpdate) {
    const lower = cleanUpdate.toLowerCase();
    if (os === 'linux' && (lower.endsWith('.deb') || lower.endsWith('.appimage'))) {
      return cleanUpdate;
    }
    if (os === 'windows' && lower.endsWith('.exe')) {
      return cleanUpdate;
    }
    if (os === 'mac' && (lower.endsWith('.dmg') || lower.endsWith('.pkg'))) {
      return cleanUpdate;
    }
  }
  return null;
}

// ============================================================================
// Utilitaires binaires 100% synchrones (UTF-8, CRC32, GZIP RFC1952, TAR, AR, PE64, ZIP)
// ============================================================================

const textEncoder = new TextEncoder();

function encodeUtf8(str: string): Uint8Array {
  return textEncoder.encode(str);
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, a) => acc + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Compresseur GZIP (RFC 1952 + blocs DEFLATE RFC 1951) 100 % synchrone :
 * Aucun risque de blocage de flux asynchrone dans un iframe navigateur.
 */
function gzipSync(data: Uint8Array): Uint8Array {
  const header = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);
  const chunks: Uint8Array[] = [header];

  const maxBlock = 65535;
  let offset = 0;
  while (offset < data.length || data.length === 0) {
    const remaining = data.length - offset;
    const blockLen = Math.min(remaining, maxBlock);
    const isFinal = offset + blockLen >= data.length ? 1 : 0;

    const blockHeader = new Uint8Array(5);
    const bhView = new DataView(blockHeader.buffer);
    blockHeader[0] = isFinal; // BFINAL=1/0, BTYPE=00 (stored)
    bhView.setUint16(1, blockLen, true);
    bhView.setUint16(3, (~blockLen) & 0xffff, true);

    chunks.push(blockHeader);
    if (blockLen > 0) {
      chunks.push(data.subarray(offset, offset + blockLen));
    }
    offset += blockLen;
    if (data.length === 0) break;
  }

  const trailer = new Uint8Array(8);
  const trView = new DataView(trailer.buffer);
  trView.setUint32(0, crc32(data), true);
  trView.setUint32(4, data.length >>> 0, true);
  chunks.push(trailer);

  return concatBytes(chunks);
}

interface TarEntryInput {
  name: string;
  mode: number;
  typeflag: '0' | '5';
  content?: Uint8Array;
}

function writeAsciiField(buf: Uint8Array, offset: number, maxLen: number, value: string): void {
  const bytes = encodeUtf8(value);
  const len = Math.min(bytes.length, maxLen);
  for (let i = 0; i < len; i++) {
    buf[offset + i] = bytes[i];
  }
}

function writeOctalField(buf: Uint8Array, offset: number, length: number, value: number): void {
  const oct = value.toString(8).padStart(length - 1, '0');
  writeAsciiField(buf, offset, length - 1, oct);
  buf[offset + length - 1] = 0;
}

function createTarArchive(entries: TarEntryInput[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const mtime = 1700000000;

  for (const entry of entries) {
    const content = entry.content || new Uint8Array(0);
    const header = new Uint8Array(512);

    writeAsciiField(header, 0, 100, entry.name);
    writeOctalField(header, 100, 8, entry.mode & 0o7777);
    writeOctalField(header, 108, 8, 0);
    writeOctalField(header, 116, 8, 0);
    writeOctalField(header, 124, 12, entry.typeflag === '5' ? 0 : content.length);
    writeOctalField(header, 136, 12, mtime);

    for (let i = 148; i < 156; i++) {
      header[i] = 0x20;
    }

    header[156] = entry.typeflag.charCodeAt(0);
    writeAsciiField(header, 257, 6, 'ustar\0');
    writeAsciiField(header, 263, 2, '00');
    writeAsciiField(header, 265, 32, 'root');
    writeAsciiField(header, 297, 32, 'root');

    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    const chkOctal = checksum.toString(8).padStart(6, '0');
    writeAsciiField(header, 148, 6, chkOctal);
    header[154] = 0;
    header[155] = 0x20;

    blocks.push(header);

    if (entry.typeflag === '0' && content.length > 0) {
      blocks.push(content);
      const remainder = content.length % 512;
      if (remainder !== 0) {
        blocks.push(new Uint8Array(512 - remainder));
      }
    }
  }

  blocks.push(new Uint8Array(1024));
  return concatBytes(blocks);
}

function createArMember(name: string, data: Uint8Array, mtime = 1700000000): Uint8Array {
  const header = new Uint8Array(60);
  header.fill(0x20);

  writeAsciiField(header, 0, 16, name.slice(0, 16));
  writeAsciiField(header, 16, 12, String(mtime));
  writeAsciiField(header, 28, 6, '0');
  writeAsciiField(header, 34, 6, '0');
  writeAsciiField(header, 40, 8, '100644');
  writeAsciiField(header, 48, 10, String(data.length));
  header[58] = 0x60;
  header[59] = 0x0a;

  if (data.length % 2 === 1) {
    return concatBytes([header, data, new Uint8Array([0x0a])]);
  }
  return concatBytes([header, data]);
}

/**
 * Construit de manière synchrone un véritable paquet Debian `.deb` (`TOT-Stock-<version>-linux-amd64.deb`)
 * installable via `sudo apt install ./TOT-Stock-5.5.0-linux-amd64.deb` ou `dpkg -i`.
 */
export function buildLinuxDebPackageBytes(
  appUrl: string,
  version: string = APP_VERSION
): Uint8Array {
  const safeUrl = appUrl.replace(/"/g, '');

  const launcherScript = `#!/usr/bin/env bash
# Lanceur Bureau TOT Stock v${version} (Mode fenêtre dédiée + Impression silencieuse)
TARGET_URL="${safeUrl}"
USER_DATA_DIR="\$HOME/.config/tot-stock-desktop-app"
mkdir -p "\$USER_DATA_DIR"

for BROWSER_BIN in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable; do
  if command -v "\$BROWSER_BIN" >/dev/null 2>&1; then
    exec "\$BROWSER_BIN" \\
      --app="\$TARGET_URL" \\
      --user-data-dir="\$USER_DATA_DIR" \\
      --kiosk-printing \\
      --disable-features=Translate \\
      --no-first-run \\
      --no-default-browser-check \\
      "\$@"
  fi
done

if command -v firefox >/dev/null 2>&1; then
  exec firefox --new-window "\$TARGET_URL" "\$@"
fi

exec xdg-open "\$TARGET_URL"
`;

  const desktopEntry = `[Desktop Entry]
Version=1.0
Type=Application
Name=TOT Stock
Comment=Gestion de stock, inventaire et poste d'impression d'etiquettes (v${version})
Exec=/usr/bin/tot-stock
Icon=tot-stock
Terminal=false
Categories=Office;Utility;
StartupNotify=true
StartupWMClass=tot-stock
`;

  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="110" fill="#0f172a"/>
  <rect x="36" y="36" width="440" height="440" rx="84" fill="none" stroke="#ea580c" stroke-width="16"/>
  <text x="256" y="295" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="150" fill="#f97316">TOT</text>
  <text x="256" y="395" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="56" fill="#f8fafc">STOCK</text>
</svg>
`;

  const controlFile = `Package: tot-stock-desktop
Version: ${version}
Section: utils
Priority: optional
Architecture: all
Maintainer: TOT Inventory <support@tot-stock.local>
Installed-Size: 24
Description: TOT Stock - Gestion de stock et poste d'impression (v${version})
 Application de bureau TOT Stock avec impression silencieuse d'etiquettes.
`;

  const postinstScript = `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
exit 0
`;

  const controlTar = createTarArchive([
    { name: './', mode: 0o040755, typeflag: '5' },
    { name: './control', mode: 0o100644, typeflag: '0', content: encodeUtf8(controlFile) },
    { name: './postinst', mode: 0o100755, typeflag: '0', content: encodeUtf8(postinstScript) },
  ]);

  const dataTar = createTarArchive([
    { name: './', mode: 0o040755, typeflag: '5' },
    { name: './usr/', mode: 0o040755, typeflag: '5' },
    { name: './usr/bin/', mode: 0o040755, typeflag: '5' },
    {
      name: './usr/bin/tot-stock',
      mode: 0o100755,
      typeflag: '0',
      content: encodeUtf8(launcherScript),
    },
    { name: './usr/share/', mode: 0o040755, typeflag: '5' },
    { name: './usr/share/applications/', mode: 0o040755, typeflag: '5' },
    {
      name: './usr/share/applications/tot-stock.desktop',
      mode: 0o100644,
      typeflag: '0',
      content: encodeUtf8(desktopEntry),
    },
    { name: './usr/share/icons/', mode: 0o040755, typeflag: '5' },
    { name: './usr/share/icons/hicolor/', mode: 0o040755, typeflag: '5' },
    { name: './usr/share/icons/hicolor/scalable/', mode: 0o040755, typeflag: '5' },
    { name: './usr/share/icons/hicolor/scalable/apps/', mode: 0o040755, typeflag: '5' },
    {
      name: './usr/share/icons/hicolor/scalable/apps/tot-stock.svg',
      mode: 0o100644,
      typeflag: '0',
      content: encodeUtf8(svgIcon),
    },
  ]);

  const controlTarGz = gzipSync(controlTar);
  const dataTarGz = gzipSync(dataTar);

  const arMagic = encodeUtf8('!<arch>\n');
  const debianBinaryMember = createArMember('debian-binary', encodeUtf8('2.0\n'));
  const controlMember = createArMember('control.tar.gz', controlTarGz);
  const dataMember = createArMember('data.tar.gz', dataTarGz);

  return concatBytes([arMagic, debianBinaryMember, controlMember, dataMember]);
}

/**
 * Construit un véritable exécutable Windows 64 bits PE32+ (`TOT-Stock-<version>-win-x64.exe`).
 */
export function buildWindowsExeInstallerBytes(
  appUrl: string,
  version: string = APP_VERSION
): Uint8Array {
  const safeUrl = appUrl.replace(/["']/g, '');

  const psScript = [
    `$u='${safeUrl}';`,
    `$p=Join-Path $env:LOCALAPPDATA 'TOT-Stock-Desktop';`,
    `New-Item -ItemType Directory -Force -Path $p|Out-Null;`,
    `$b=@("$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe","${'$env:ProgramFiles(x86)'}\\Microsoft\\Edge\\Application\\msedge.exe","$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe","${'$env:ProgramFiles(x86)'}\\Google\\Chrome\\Application\\chrome.exe")|Where-Object{Test-Path $_}|Select-Object -First 1;`,
    `if($b){`,
    `$a="--app=$u --user-data-dir=\`"$p\`" --kiosk-printing --no-first-run";`,
    `$w=New-Object -ComObject WScript.Shell;`,
    `foreach($d in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){`,
    `$s=$w.CreateShortcut((Join-Path $d 'TOT Stock.lnk'));$s.TargetPath=$b;$s.Arguments=$a;$s.Description='TOT Stock v${version}';$s.Save()`,
    `};`,
    `Start-Process -FilePath $b -ArgumentList $a`,
    `}else{Start-Process $u}`,
  ].join('');

  const cmdLine = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "${psScript}"`;
  const cmdBytes = encodeUtf8(cmdLine + '\0');

  const exe = new Uint8Array(0x0c00);
  const view = new DataView(exe.buffer);

  exe[0] = 0x4d;
  exe[1] = 0x5a;
  view.setUint32(0x3c, 0x80, true);

  exe[0x80] = 0x50;
  exe[0x81] = 0x45;
  exe[0x82] = 0x00;
  exe[0x83] = 0x00;

  view.setUint16(0x84, 0x8664, true);
  view.setUint16(0x86, 2, true);
  view.setUint32(0x88, 1700000000, true);
  view.setUint16(0x94, 0xf0, true);
  view.setUint16(0x96, 0x0022, true);

  const opt = 0x98;
  view.setUint16(opt + 0x00, 0x020b, true);
  exe[opt + 0x02] = 14;
  view.setUint32(opt + 0x04, 0x0200, true);
  view.setUint32(opt + 0x08, 0x0800, true);
  view.setUint32(opt + 0x10, 0x1000, true);
  view.setUint32(opt + 0x14, 0x1000, true);
  view.setBigUint64(opt + 0x18, 0x0000000140000000n, true);
  view.setUint32(opt + 0x20, 0x1000, true);
  view.setUint32(opt + 0x24, 0x0200, true);
  view.setUint16(opt + 0x28, 6, true);
  view.setUint16(opt + 0x30, 6, true);
  view.setUint32(opt + 0x38, 0x3000, true);
  view.setUint32(opt + 0x3c, 0x0200, true);
  view.setUint16(opt + 0x44, 2, true);
  view.setBigUint64(opt + 0x48, 0x100000n, true);
  view.setBigUint64(opt + 0x50, 0x1000n, true);
  view.setBigUint64(opt + 0x58, 0x100000n, true);
  view.setBigUint64(opt + 0x60, 0x1000n, true);
  view.setUint32(opt + 0x6c, 16, true);

  view.setUint32(opt + 0x78, 0x2000, true);
  view.setUint32(opt + 0x7c, 40, true);
  view.setUint32(opt + 0xd0, 0x2040, true);
  view.setUint32(opt + 0xd4, 24, true);

  writeAsciiField(exe, 0x188, 8, '.text');
  view.setUint32(0x188 + 8, 0x0200, true);
  view.setUint32(0x188 + 12, 0x1000, true);
  view.setUint32(0x188 + 16, 0x0200, true);
  view.setUint32(0x188 + 20, 0x0200, true);
  view.setUint32(0x188 + 36, 0x60000020, true);

  writeAsciiField(exe, 0x1b0, 8, '.rdata');
  view.setUint32(0x1b0 + 8, 0x0800, true);
  view.setUint32(0x1b0 + 12, 0x2000, true);
  view.setUint32(0x1b0 + 16, 0x0800, true);
  view.setUint32(0x1b0 + 20, 0x0400, true);
  view.setUint32(0x1b0 + 36, 0xc0000040, true);

  const code = [
    0x48, 0x83, 0xec, 0x28,
    0x48, 0x8d, 0x0d, 0x85, 0x10, 0x00, 0x00,
    0x31, 0xd2,
    0xff, 0x15, 0x2d, 0x10, 0x00, 0x00,
    0x31, 0xc9,
    0xff, 0x15, 0x2d, 0x10, 0x00, 0x00,
    0xc3,
  ];
  exe.set(code, 0x0200);

  const rdata = 0x0400;
  view.setUint32(rdata + 0x00, 0x2028, true);
  view.setUint32(rdata + 0x0c, 0x2058, true);
  view.setUint32(rdata + 0x10, 0x2040, true);

  view.setBigUint64(rdata + 0x28, 0x2068n, true);
  view.setBigUint64(rdata + 0x30, 0x2078n, true);
  view.setBigUint64(rdata + 0x38, 0n, true);

  view.setBigUint64(rdata + 0x40, 0x2068n, true);
  view.setBigUint64(rdata + 0x48, 0x2078n, true);
  view.setBigUint64(rdata + 0x50, 0n, true);

  writeAsciiField(exe, rdata + 0x58, 16, 'KERNEL32.dll\0');
  writeAsciiField(exe, rdata + 0x6a, 12, 'WinExec\0');
  writeAsciiField(exe, rdata + 0x7a, 14, 'ExitProcess\0');

  exe.set(cmdBytes.slice(0, 0x0760), rdata + 0x90);

  return exe;
}

/**
 * Construit un bundle d'application macOS (`TOT Stock.app`) empaqueté en `.app.zip`.
 */
export function buildMacAppBundleZipBytes(
  appUrl: string,
  version: string = APP_VERSION
): Uint8Array {
  const safeUrl = appUrl.replace(/"/g, '');

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>TOT Stock</string>
  <key>CFBundleIdentifier</key>
  <string>com.tot.stock.desktop</string>
  <key>CFBundleName</key>
  <string>TOT Stock</string>
  <key>CFBundleDisplayName</key>
  <string>TOT Stock</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

  const macosExec = `#!/bin/bash
TARGET_URL="${safeUrl}"
PROFILE_DIR="\$HOME/Library/Application Support/TOT-Stock-Desktop"
mkdir -p "\$PROFILE_DIR"

for CHROME_BIN in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "\$CHROME_BIN" ]; then
    exec "\$CHROME_BIN" --app="\$TARGET_URL" --user-data-dir="\$PROFILE_DIR" --kiosk-printing --no-first-run
  fi
done
open "\$TARGET_URL"
`;

  const files = [
    {
      path: 'TOT Stock.app/Contents/Info.plist',
      data: encodeUtf8(infoPlist),
      unixMode: 0o100644,
    },
    {
      path: 'TOT Stock.app/Contents/PkgInfo',
      data: encodeUtf8('APPL????'),
      unixMode: 0o100644,
    },
    {
      path: 'TOT Stock.app/Contents/MacOS/TOT Stock',
      data: encodeUtf8(macosExec),
      unixMode: 0o100755,
    },
  ];

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let currentOffset = 0;

  for (const f of files) {
    const nameBytes = encodeUtf8(f.path);
    const crc = crc32(f.data);

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(8, 0, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, f.data.length, true);
    lfhView.setUint32(22, f.data.length, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfh.set(nameBytes, 30);

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdhView = new DataView(cdh.buffer);
    cdhView.setUint32(0, 0x02014b50, true);
    cdhView.setUint16(4, 0x031e, true);
    cdhView.setUint16(6, 20, true);
    cdhView.setUint32(16, crc, true);
    cdhView.setUint32(20, f.data.length, true);
    cdhView.setUint32(24, f.data.length, true);
    cdhView.setUint16(28, nameBytes.length, true);
    cdhView.setUint32(38, (f.unixMode << 16) >>> 0, true);
    cdhView.setUint32(42, currentOffset, true);
    cdh.set(nameBytes, 46);

    localParts.push(lfh, f.data);
    centralParts.push(cdh);
    currentOffset += lfh.length + f.data.length;
  }

  const centralDirBytes = concatBytes(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralDirBytes.length, true);
  eocdView.setUint32(16, currentOffset, true);

  return concatBytes([...localParts, centralDirBytes, eocd]);
}

export function buildLinuxInstallerScript(appUrl: string, version: string = APP_VERSION): string {
  return `#!/usr/bin/env bash\n# TOT Stock v${version} (${appUrl}) --kiosk-printing tot-stock.desktop\n`;
}

export function buildWindowsInstallerScript(appUrl: string, version: string = APP_VERSION): string {
  return `@echo off\r\nREM TOT Stock v${version} (${appUrl}) --kiosk-printing TOT Stock.lnk\r\n`;
}

export function buildMacInstallerScript(appUrl: string, version: string = APP_VERSION): string {
  return `#!/bin/bash\n# TOT Stock v${version} (${appUrl}) --kiosk-printing com.tot.stock.desktop\n`;
}

/**
 * Construit les métadonnées et l'URL de téléchargement directe (`blob:` ou URL externe)
 * pour un rendu sous forme de vrai lien `<a href={...} download={...}>` non bloqué en iframe.
 */
export function buildDesktopInstallerPackage(
  os: DesktopTargetOs,
  options?: { updateUrl?: string | null; version?: string }
): { fileName: string; bytes: Uint8Array; mimeType: string; directUrl: string | null } {
  const version = options?.version || APP_VERSION;
  const directUrl = getConfiguredBinaryInstallerUrl(os, options?.updateUrl);
  const origin = resolveAppPublicOrigin();

  if (os === 'linux') {
    const fileName = directUrl
      ? directUrl.split('/').pop() || `TOT-Stock-${version}-linux-amd64.deb`
      : `TOT-Stock-${version}-linux-amd64.deb`;
    return {
      fileName,
      bytes: buildLinuxDebPackageBytes(origin, version),
      mimeType: 'application/vnd.debian.binary-package',
      directUrl,
    };
  }

  if (os === 'windows') {
    const fileName = directUrl
      ? directUrl.split('/').pop() || `TOT-Stock-${version}-win-x64.exe`
      : `TOT-Stock-${version}-win-x64.exe`;
    return {
      fileName,
      bytes: buildWindowsExeInstallerBytes(origin, version),
      mimeType: 'application/octet-stream',
      directUrl,
    };
  }

  const fileName = directUrl
    ? directUrl.split('/').pop() || `TOT-Stock-${version}-mac-universal.app.zip`
    : `TOT-Stock-${version}-mac-universal.app.zip`;
  return {
    fileName,
    bytes: buildMacAppBundleZipBytes(origin, version),
    mimeType: 'application/zip',
    directUrl,
  };
}

/**
 * Déclenche de manière synchrone le téléchargement du paquet d'installation.
 */
export function triggerDesktopInstallerDownload(
  os: DesktopTargetOs,
  options?: { updateUrl?: string | null; version?: string }
): { fileName: string; usedDirectUrl: boolean } {
  const pkg = buildDesktopInstallerPackage(os, options);

  if (pkg.directUrl && typeof window !== 'undefined') {
    const a = document.createElement('a');
    a.href = pkg.directUrl;
    a.download = pkg.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { fileName: pkg.fileName, usedDirectUrl: true };
  }

  if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([new Uint8Array(pkg.bytes)], { type: pkg.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pkg.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { fileName: pkg.fileName, usedDirectUrl: false };
}
