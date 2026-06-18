// Generates the extension PNG icons (no dependencies) — a white sparkle mark on
// the indigo brand gradient inside a rounded square, matching the side-panel
// header logo. Rendered at 4× and box-downsampled for smooth anti-aliasing.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const G1 = [99, 102, 241]; // #6366f1 (gradient start, top-left)
const G2 = [79, 70, 229]; // #4f46e5 (gradient end, bottom-right)
const WHITE = [255, 255, 255];
const ACCENT = [199, 210, 254]; // #c7d2fe (secondary sparkle)

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// A 4-point sparkle (astroid-style concave star): point in [-1,1]² is inside
// when |x|^0.5 + |y|^0.5 <= 1.
function inSparkle(nx, ny) {
  if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return false;
  return Math.sqrt(Math.abs(nx)) + Math.sqrt(Math.abs(ny)) <= 1;
}

// Colour (RGBA) for a point in pixel space [0,size].
function sampleColor(x, y, size) {
  // Rounded-square mask → transparent outside the corner radius.
  const r = size * 0.22;
  const dx = Math.max(r - x, x - (size - r), 0);
  const dy = Math.max(r - y, y - (size - r), 0);
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];

  const half = size / 2;

  // Main sparkle, centred.
  const R = size * 0.4;
  if (inSparkle((x - half) / R, (y - half) / R)) return [...WHITE, 255];

  // Small accent sparkle, upper-right (skip on the tiny 16px icon).
  if (size >= 48) {
    const R2 = size * 0.12;
    if (inSparkle((x - size * 0.73) / R2, (y - size * 0.27) / R2)) return [...ACCENT, 255];
  }

  // Diagonal brand gradient.
  const t = (x + y) / (2 * size);
  return [
    Math.round(G1[0] + (G2[0] - G1[0]) * t),
    Math.round(G1[1] + (G2[1] - G1[1]) * t),
    Math.round(G1[2] + (G2[2] - G1[2]) * t),
    255,
  ];
}

function makePng(size) {
  const SS = 4; // supersample factor
  const pixels = Buffer.alloc(size * size * 4);
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sampleColor((ox * SS + sx + 0.5) / SS, (oy * SS + sy + 0.5) / SS, size);
          const af = c[3] / 255;
          r += c[0] * af;
          g += c[1] * af;
          b += c[2] * af;
          a += c[3];
        }
      }
      const n = SS * SS;
      const aOut = a / n;
      const idx = (oy * size + ox) * 4;
      if (aOut <= 0) {
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = pixels[idx + 3] = 0;
      } else {
        const af = aOut / 255; // un-premultiply
        pixels[idx] = Math.round(r / n / af);
        pixels[idx + 1] = Math.round(g / n / af);
        pixels[idx + 2] = Math.round(b / n / af);
        pixels[idx + 3] = Math.round(aOut);
      }
    }
  }

  // Each scanline is prefixed with filter byte 0.
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0]), pixels.subarray(y * size * 4, (y + 1) * size * 4));
  }
  const idat = deflateSync(Buffer.concat(rows));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`public/icons/icon${size}.png`, makePng(size));
  console.log(`wrote public/icons/icon${size}.png`);
}
