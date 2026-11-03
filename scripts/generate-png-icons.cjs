const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, isMaskable = false) {
  // Create raw RGBA image data
  // Each scanline begins with a filter byte (0 = None) followed by width * 4 bytes RGBA
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * (isMaskable ? 0.48 : 0.42);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter byte: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background
      let r = 30;  // #1e293b
      let g = 41;
      let b = 59;
      let a = 255;

      // Rounded background boundary if not maskable
      if (!isMaskable && dist > radius) {
        // Transparent outside rounded icon
        const edge = dist - radius;
        if (edge > 2) {
          a = 0;
        } else {
          a = Math.floor(255 * (1 - edge / 2));
        }
      }

      if (a > 0) {
        // Target viewfinder or central orange box
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const maxCoord = Math.max(absX, absY);
        const boxSize = width * 0.28;

        // Viewfinder corners
        const cornerOuter = width * 0.35;
        const cornerInner = width * 0.25;
        const isCorner = (absX > cornerInner && absX < cornerOuter && absY > cornerInner && absY < cornerOuter);

        // Center cube or scan laser
        const isLaser = Math.abs(dy) < (width * 0.015) && absX < (width * 0.32);

        // Box in center
        const isCenterBox = absX < (width * 0.16) && absY < (width * 0.16);

        if (isLaser) {
          r = 244; g = 63; b = 94; // rose-500 laser
        } else if (isCenterBox) {
          r = 234; g = 88; b = 12; // orange-600
        } else if (isCorner) {
          r = 249; g = 115; b = 22; // orange-500
        } else if (maxCoord < width * 0.45 && maxCoord > width * 0.43) {
          // Subtle border
          r = 234; g = 88; b = 12;
          a = Math.floor(a * 0.4);
        }
      }

      raw[pixelOffset] = r;
      raw[pixelOffset + 1] = g;
      raw[pixelOffset + 2] = b;
      raw[pixelOffset + 3] = a;
    }
  }

  // Compress IDAT
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcVal = zlib.crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.resolve(__dirname, '../public');

// 192x192
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPng(192, 192, false));
console.log('Created pwa-192x192.png');

// 512x512
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPng(512, 512, false));
console.log('Created pwa-512x512.png');

// 512x512 maskable
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPng(512, 512, true));
console.log('Created pwa-maskable-512x512.png');

// 180x180 apple-touch-icon
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPng(180, 180, false));
console.log('Created apple-touch-icon.png');
