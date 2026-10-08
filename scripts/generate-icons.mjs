// Regenerates the PWA icons in public/ from the SVG sources below.
// Usage: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(out + 'icons', { recursive: true });

const PETROL = '#0E6E63';
const PETROL_D = '#0A4A43';
const GOLD = '#F2C218';

// Mark drawn on a 100x100 grid: three rising bars (dashboard) and a gold trend dot.
// `inset` shrinks the mark towards the centre, leaving the maskable safe zone.
function mark(inset) {
  const s = 1 - inset * 2;
  return `<g transform="translate(${50 - 50 * s} ${50 - 50 * s}) scale(${s})">
    <rect x="22" y="52" width="14" height="26" rx="3" fill="#EAF4F2"/>
    <rect x="43" y="38" width="14" height="40" rx="3" fill="#EAF4F2"/>
    <rect x="64" y="22" width="14" height="56" rx="3" fill="#EAF4F2"/>
    <circle cx="71" cy="14" r="5" fill="${GOLD}"/>
  </g>`;
}

const svg = (inset, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${PETROL}"/><stop offset="1" stop-color="${PETROL_D}"/>
  </linearGradient></defs>
  <rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="url(#g)"/>
  ${mark(inset)}
</svg>`;

const jobs = [
  ['icons/icon-192.png', svg(0, true), 192],
  ['icons/icon-512.png', svg(0, true), 512],
  // Maskable: full-bleed background, content inside the central 80% (10% safe zone per side).
  ['icons/icon-maskable-512.png', svg(0.1, false), 512],
  // iOS applies its own mask and dislikes transparency: full-bleed square.
  ['apple-touch-icon.png', svg(0.04, false), 180],
  ['icons/favicon-32.png', svg(0, true), 32],
];

writeFileSync(out + 'icon.svg', svg(0, true));
for (const [file, source, size] of jobs) {
  await sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(out + file);
  console.log('wrote public/' + file);
}
