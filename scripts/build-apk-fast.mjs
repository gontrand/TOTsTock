import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { execSync } from 'child_process';

const WORKSPACE = process.cwd();
const KEY_DIR = path.join(WORKSPACE, 'android', 'keystore');
const PRIV_KEY_PEM = path.join(KEY_DIR, 'tot-release-key.pem');
const CERT_PEM = path.join(KEY_DIR, 'tot-release-cert.pem');
const CERT_DER = path.join(KEY_DIR, 'tot-release-cert.der');

// 1. Ensure persistent RSA-2048 key and X.509 v3 certificate exist in android/keystore/
fs.mkdirSync(KEY_DIR, { recursive: true });
if (!fs.existsSync(PRIV_KEY_PEM) || !fs.existsSync(CERT_DER)) {
  console.log('[1/5] Generating persistent RSA-2048 signing key & certificate...');
  execSync(
    `openssl req -new -x509 -nodes -newkey rsa:2048 -keyout "${PRIV_KEY_PEM}" -out "${CERT_PEM}" -days 10000 -subj "/CN=TOT Stock Pro/OU=Mobile/O=TOT/L=Paris/ST=IDF/C=FR"`,
    { stdio: 'inherit' }
  );
  execSync(`openssl x509 -in "${CERT_PEM}" -outform DER -out "${CERT_DER}"`, { stdio: 'inherit' });
}

const privateKeyPem = fs.readFileSync(PRIV_KEY_PEM, 'utf8');
const certDer = fs.readFileSync(CERT_DER);
const pubKeyObj = crypto.createPublicKey(privateKeyPem);
const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' });

// 2. Patch binary AndroidManifest.xml with VIBRATE permission and version 5.4.1 (versionCode 2)
console.log('[2/5] Patching binary AndroidManifest.xml (VIBRATE permission + v5.4.1)...');
const origApkPath = path.join(WORKSPACE, 'public', 'tot-stock.apk');
const rawManifest = execSync(`unzip -p "${origApkPath}" AndroidManifest.xml`, { maxBuffer: 10 * 1024 * 1024 });

function patchAndroidManifest(buf) {
  const spHeaderSize = buf.readUInt16LE(10);
  const stringCount = buf.readUInt32LE(16);
  const flags = buf.readUInt32LE(24);
  const stringsStart = buf.readUInt32LE(28);
  const strings = [];
  for (let i = 0; i < stringCount; i++) {
    const off = 8 + stringsStart + buf.readUInt32LE(8 + spHeaderSize + i * 4);
    const len = buf.readUInt16LE(off);
    strings.push(buf.subarray(off + 2, off + 2 + len * 2).toString('utf16le'));
  }

  // Update versionName ("1.0" -> "5.4.1")
  const verIdx = strings.findIndex((s) => s === '1.0' || s.startsWith('5.4.'));
  if (verIdx !== -1) strings[verIdx] = '5.4.1';

  const alreadyHasVibrate = strings.includes('android.permission.VIBRATE');
  let vibrateIdx = strings.indexOf('android.permission.VIBRATE');
  if (vibrateIdx === -1) {
    vibrateIdx = strings.length;
    strings.push('android.permission.VIBRATE');
  }

  // Rebuild String Pool chunk (0x0001)
  const newCount = strings.length;
  const newStringsStart = 28 + newCount * 4;
  const strBuffers = [];
  const offsets = [];
  let curOff = 0;
  for (const s of strings) {
    offsets.push(curOff);
    const b = Buffer.alloc(2 + s.length * 2 + 2);
    b.writeUInt16LE(s.length, 0);
    b.write(s, 2, s.length * 2, 'utf16le');
    b.writeUInt16LE(0, 2 + s.length * 2);
    strBuffers.push(b);
    curOff += b.length;
  }
  while ((newStringsStart + curOff) % 4 !== 0) {
    strBuffers.push(Buffer.from([0]));
    curOff += 1;
  }
  const newSpSize = newStringsStart + curOff;
  const spBuf = Buffer.alloc(newSpSize);
  spBuf.writeUInt16LE(0x0001, 0);
  spBuf.writeUInt16LE(28, 2);
  spBuf.writeUInt32LE(newSpSize, 4);
  spBuf.writeUInt32LE(newCount, 8);
  spBuf.writeUInt32LE(0, 12);
  spBuf.writeUInt32LE(flags, 16);
  spBuf.writeUInt32LE(newStringsStart, 20);
  spBuf.writeUInt32LE(0, 24);
  for (let i = 0; i < newCount; i++) {
    spBuf.writeUInt32LE(offsets[i], 28 + i * 4);
  }
  Buffer.concat(strBuffers).copy(spBuf, newStringsStart);

  const oldSpChunkSize = buf.readUInt32LE(12);
  const afterSpOffset = 8 + oldSpChunkSize;

  // Find <manifest> and <uses-permission android:name="android.permission.CAMERA"/>
  let pos = afterSpOffset;
  let cameraEndOffset = -1;
  let cameraChunk = null;
  const modBuf = Buffer.from(buf);

  while (pos < modBuf.length) {
    const type = modBuf.readUInt16LE(pos);
    const chunkSize = modBuf.readUInt32LE(pos + 4);
    if (type === 0x0102) {
      const nameIdx = modBuf.readUInt32LE(pos + 20);
      const attrCount = modBuf.readUInt16LE(pos + 28);
      const elemName = strings[nameIdx];
      if (elemName === 'manifest') {
        for (let a = 0; a < attrCount; a++) {
          const aPos = pos + 36 + a * 20;
          const aName = modBuf.readUInt32LE(aPos + 4);
          if (strings[aName] === 'versionCode') {
            modBuf.writeInt32LE(2, aPos + 16);
          }
        }
      } else if (elemName === 'uses-permission') {
        const aPos = pos + 36;
        const aData = modBuf.readInt32LE(aPos + 16);
        if (strings[aData] === 'android.permission.CAMERA') {
          const endElemPos = pos + chunkSize;
          const endElemSize = modBuf.readUInt32LE(endElemPos + 4);
          cameraChunk = Buffer.from(modBuf.subarray(pos, endElemPos + endElemSize));
          cameraEndOffset = endElemPos + endElemSize;
        }
      }
    }
    pos += chunkSize;
  }

  const chunks = [spBuf, modBuf.subarray(afterSpOffset, cameraEndOffset)];
  if (!alreadyHasVibrate && cameraChunk) {
    const vibrateChunk = Buffer.from(cameraChunk);
    vibrateChunk.writeInt32LE(vibrateIdx, 36 + 8);
    vibrateChunk.writeInt32LE(vibrateIdx, 36 + 16);
    chunks.push(vibrateChunk);
  }
  chunks.push(modBuf.subarray(cameraEndOffset));

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x00080003, 0);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

const patchedManifest = patchAndroidManifest(rawManifest);

// 3. Extract existing APK to temporary folder and replace assets/public/* + AndroidManifest.xml
console.log('[3/5] Updating APK contents with latest build...');
const unpackDir = '/tmp/tot-apk-unpack';
execSync(`rm -rf "${unpackDir}" && mkdir -p "${unpackDir}"`);
execSync(`unzip -q "${origApkPath}" -d "${unpackDir}"`);

// Remove old signature files and old web assets
execSync(`rm -rf "${unpackDir}/META-INF/CERT."* "${unpackDir}/META-INF/MANIFEST.MF" "${unpackDir}/META-INF/"*.SF "${unpackDir}/META-INF/"*.RSA "${unpackDir}/assets/public"`);
fs.writeFileSync(path.join(unpackDir, 'AndroidManifest.xml'), patchedManifest);

// Copy fresh web assets from android/app/src/main/assets/public
const freshPublicDir = path.join(WORKSPACE, 'android', 'app', 'src', 'main', 'assets', 'public');
execSync(`cp -r "${freshPublicDir}" "${unpackDir}/assets/public"`);
execSync(`rm -f "${unpackDir}/assets/public/tot-stock.apk"`);

// 4. Create V1 signature files (META-INF/MANIFEST.MF, META-INF/CERT.SF, META-INF/CERT.RSA)
console.log('[4/5] Generating V1 JAR signature (MANIFEST.MF, CERT.SF, CERT.RSA)...');
function walkFiles(dir, baseDir = dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkFiles(full, baseDir));
    } else {
      results.push(path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

const allFiles = walkFiles(unpackDir);
const manifestLines = ['Manifest-Version: 1.0', 'Created-By: TOT Stock Builder', ''];
const sfEntryBlocks = [];

for (const relPath of allFiles) {
  const data = fs.readFileSync(path.join(unpackDir, relPath));
  const sha256B64 = crypto.createHash('sha256').update(data).digest('base64');
  const section = `Name: ${relPath}\r\nSHA-256-Digest: ${sha256B64}\r\n\r\n`;
  manifestLines.push(`Name: ${relPath}`, `SHA-256-Digest: ${sha256B64}`, '');
  const secDigest = crypto.createHash('sha256').update(Buffer.from(section, 'utf8')).digest('base64');
  sfEntryBlocks.push(`Name: ${relPath}\r\nSHA-256-Digest: ${secDigest}\r\n\r\n`);
}

const manifestContent = Buffer.from(manifestLines.join('\r\n') + '\r\n', 'utf8');
const mainManifestDigest = crypto.createHash('sha256').update(manifestContent).digest('base64');
const sfHeader =
  `Signature-Version: 1.0\r\n` +
  `Created-By: TOT Stock Builder\r\n` +
  `SHA-256-Digest-Manifest: ${mainManifestDigest}\r\n` +
  `X-Android-APK-Signed: 2, 3\r\n\r\n`;
const sfContent = Buffer.from(sfHeader + sfEntryBlocks.join(''), 'utf8');

fs.mkdirSync(path.join(unpackDir, 'META-INF'), { recursive: true });
const mfPath = path.join(unpackDir, 'META-INF', 'MANIFEST.MF');
const sfPath = path.join(unpackDir, 'META-INF', 'CERT.SF');
const rsaPath = path.join(unpackDir, 'META-INF', 'CERT.RSA');
fs.writeFileSync(mfPath, manifestContent);
fs.writeFileSync(sfPath, sfContent);

execSync(
  `openssl cms -sign -binary -noattr -in "${sfPath}" -signer "${CERT_PEM}" -inkey "${PRIV_KEY_PEM}" -outform DER -out "${rsaPath}" -md sha256`,
  { stdio: 'inherit' }
);

// 5. Assemble deterministic 4-byte aligned ZIP + inject APK Signature Scheme v2 & v3 block
console.log('[5/5] Assembling aligned APK and injecting V2 + V3 signature block...');
const finalFiles = walkFiles(unpackDir);

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const localParts = [];
const cdParts = [];
let offset = 0;

for (const relPath of finalFiles) {
  const rawData = fs.readFileSync(path.join(unpackDir, relPath));
  const nameBuf = Buffer.from(relPath, 'utf8');
  const crc = crc32(rawData);

  // Store resources.arsc and .so files uncompressed with 4-byte alignment
  const isStored =
    relPath === 'resources.arsc' ||
    relPath.endsWith('.so') ||
    relPath.endsWith('.png') ||
    relPath.endsWith('.webp');

  const compData = isStored ? rawData : zlib.deflateRawSync(rawData, { level: 6 });
  const method = isStored ? 0 : 8;

  let extraBuf = Buffer.alloc(0);
  if (isStored) {
    const dataOffset = offset + 30 + nameBuf.length;
    const align = relPath.endsWith('.so') ? 4096 : 4;
    const pad = (align - (dataOffset % align)) % align;
    if (pad > 0) extraBuf = Buffer.alloc(pad);
  }

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4); // version needed
  lfh.writeUInt16LE(0, 6); // flags
  lfh.writeUInt16LE(method, 8);
  lfh.writeUInt16LE(0x0021, 10); // mod time
  lfh.writeUInt16LE(0x0221, 12); // mod date
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(compData.length, 18);
  lfh.writeUInt32LE(rawData.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(extraBuf.length, 28);

  const localEntry = Buffer.concat([lfh, nameBuf, extraBuf, compData]);
  localParts.push(localEntry);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4); // version made by
  cdh.writeUInt16LE(20, 6); // version needed
  cdh.writeUInt16LE(0, 8); // flags
  cdh.writeUInt16LE(method, 10);
  cdh.writeUInt16LE(0x0021, 12);
  cdh.writeUInt16LE(0x0221, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(compData.length, 20);
  cdh.writeUInt32LE(rawData.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30); // extra length in CD
  cdh.writeUInt16LE(0, 32); // comment length
  cdh.writeUInt16LE(0, 34); // disk number
  cdh.writeUInt16LE(0, 36); // internal attrs
  cdh.writeUInt32LE(0, 38); // external attrs
  cdh.writeUInt32LE(offset, 42); // relative offset of local header

  cdParts.push(Buffer.concat([cdh, nameBuf]));
  offset += localEntry.length;
}

// Pad Section 1 (local entries) to multiple of 4096 bytes if needed? No, APK Sig Block itself is a multiple of 4096 bytes!
const section1 = Buffer.concat(localParts);
const section2 = Buffer.concat(cdParts);

const eocdForDigest = Buffer.alloc(22);
eocdForDigest.writeUInt32LE(0x06054b50, 0);
eocdForDigest.writeUInt16LE(0, 4);
eocdForDigest.writeUInt16LE(0, 6);
eocdForDigest.writeUInt16LE(finalFiles.length, 8);
eocdForDigest.writeUInt16LE(finalFiles.length, 10);
eocdForDigest.writeUInt32LE(section2.length, 12);
eocdForDigest.writeUInt32LE(section1.length, 16); // points to start of APK Signing Block for digest calculation
eocdForDigest.writeUInt16LE(0, 20);

// Compute APK Signature Scheme v2/v3 top-level SHA-256 merkle digest
const chunkDigests = [];
for (const sec of [section1, section2, eocdForDigest]) {
  for (let i = 0; i < sec.length; i += 1048576) {
    const chunk = sec.subarray(i, Math.min(i + 1048576, sec.length));
    const h = crypto.createHash('sha256');
    const hdr = Buffer.alloc(5);
    hdr[0] = 0xa5;
    hdr.writeUInt32LE(chunk.length, 1);
    h.update(hdr);
    h.update(chunk);
    chunkDigests.push(h.digest());
  }
}
const topH = crypto.createHash('sha256');
const topHdr = Buffer.alloc(5);
topHdr[0] = 0x5a;
topHdr.writeUInt32LE(chunkDigests.length, 1);
topH.update(topHdr);
for (const d of chunkDigests) topH.update(d);
const topLevelDigest = topH.digest();

function lenPrefix(buf) {
  const b = Buffer.alloc(4 + buf.length);
  b.writeUInt32LE(buf.length, 0);
  buf.copy(b, 4);
  return b;
}

function u32(val) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(val >>> 0, 0);
  return b;
}

// Construct V2 block (0x7109871a)
// Algorithm 0x0103 = RSA_PKCS1_V1_5_WITH_SHA256
const digestEntry = lenPrefix(Buffer.concat([u32(0x0103), lenPrefix(topLevelDigest)]));
const digestsSeq = lenPrefix(digestEntry);
const certsSeq = lenPrefix(lenPrefix(certDer));

// V2 additional attributes: stripping protection attr (0xbeef000d -> 3) + 4 zero bytes tail
const v2AddAttrs = Buffer.from('0c000000080000000df0efbe0300000000000000', 'hex');
const v2SignedData = Buffer.concat([digestsSeq, certsSeq, v2AddAttrs]);
const v2SigBytes = crypto.sign('RSA-SHA256', v2SignedData, privateKeyPem);
const v2SigsSeq = lenPrefix(lenPrefix(Buffer.concat([u32(0x0103), lenPrefix(v2SigBytes)])));
const v2Signer = lenPrefix(Buffer.concat([lenPrefix(v2SignedData), v2SigsSeq, lenPrefix(spkiDer)]));
const v2BlockVal = lenPrefix(v2Signer);

// Construct V3 block (0xf05368c0)
const v3Tail = Buffer.from('18000000ffffff7f00000000', 'hex'); // minSdk=24, maxSdk=INT_MAX, empty attrs
const v3SignedData = Buffer.concat([digestsSeq, certsSeq, v3Tail]);
const v3SigBytes = crypto.sign('RSA-SHA256', v3SignedData, privateKeyPem);
const v3SigsSeq = lenPrefix(lenPrefix(Buffer.concat([u32(0x0103), lenPrefix(v3SigBytes)])));
const v3MinMax = Buffer.from('18000000ffffff7f', 'hex');
const v3Signer = lenPrefix(Buffer.concat([lenPrefix(v3SignedData), v3MinMax, v3SigsSeq, lenPrefix(spkiDer)]));
const v3BlockVal = lenPrefix(v3Signer);

function makePair(id, valBuf) {
  const b = Buffer.alloc(12 + valBuf.length);
  b.writeBigUInt64LE(BigInt(4 + valBuf.length), 0);
  b.writeUInt32LE(id >>> 0, 8);
  valBuf.copy(b, 12);
  return b;
}

const pairV2 = makePair(0x7109871a, v2BlockVal);
const pairV3 = makePair(0xf05368c0, v3BlockVal);

// Pad APK Signing Block so (section1.length + apkSigBlock.length) is a multiple of 4096 bytes
const minBlockLen = 8 + pairV2.length + pairV3.length + 12 + 24;
const padValLen = (4096 - ((section1.length + minBlockLen) % 4096)) % 4096;
const pairPad = makePair(0x42726577, Buffer.alloc(padValLen));

const pairsConcat = Buffer.concat([pairV2, pairV3, pairPad]);
const sizeOfBlock = BigInt(pairsConcat.length + 24);
const sigBlockHeader = Buffer.alloc(8);
sigBlockHeader.writeBigUInt64LE(sizeOfBlock, 0);
const sigBlockFooter = Buffer.alloc(24);
sigBlockFooter.writeBigUInt64LE(sizeOfBlock, 0);
Buffer.from('APK Sig Block 42', 'utf8').copy(sigBlockFooter, 8);

const apkSigBlock = Buffer.concat([sigBlockHeader, pairsConcat, sigBlockFooter]);

const finalEocd = Buffer.from(eocdForDigest);
finalEocd.writeUInt32LE(section1.length + apkSigBlock.length, 16);

const finalApk = Buffer.concat([section1, apkSigBlock, section2, finalEocd]);
fs.writeFileSync(path.join(WORKSPACE, 'public', 'tot-stock.apk'), finalApk);
if (fs.existsSync(path.join(WORKSPACE, 'dist'))) {
  fs.writeFileSync(path.join(WORKSPACE, 'dist', 'tot-stock.apk'), finalApk);
}
execSync(`rm -rf "${unpackDir}"`);
console.log(
  `SUCCESS! Updated public/tot-stock.apk (${(finalApk.length / 1024 / 1024).toFixed(2)} MB) with V1+V2+V3 signatures!`
);
