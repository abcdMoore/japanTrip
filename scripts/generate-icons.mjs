/**
 * generate-icons.mjs
 * Converts public/icons/icon.svg → PNG icons for PWA manifest + apple-touch-icon.
 * Requires: npm install -D sharp
 * Usage:    node scripts/generate-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root  = join(__dir, '..')

let sharp
try { sharp = (await import('sharp')).default }
catch { console.error('Install sharp first:  npm install -D sharp'); process.exit(1) }

const svg = readFileSync(join(root, 'public/icons/icon.svg'))

const sizes = [
  { name: 'icon-192.png',        size: 192 },
  { name: 'icon-512.png',        size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]

for (const { name, size } of sizes) {
  const out = join(root, 'public/icons', name)
  await sharp(svg).resize(size, size).png().toFile(out)
  console.log(`✓ ${name} (${size}×${size})`)
}
console.log('Icons generated in public/icons/')
