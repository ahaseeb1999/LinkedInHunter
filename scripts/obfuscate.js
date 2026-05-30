#!/usr/bin/env node
/**
 * Obfuscate Electron main-process JS before packaging.
 *
 * Runs after `vite build` and before `electron-builder`. Reads each
 * .js in electron/, applies javascript-obfuscator with a moderate
 * preset, and writes back in place.
 *
 * Why moderate (not extreme):
 *   - Extreme settings (full control-flow flattening) can slow code 5x
 *     and occasionally break Node API calls.
 *   - Our real defense is the server-side license check + per-action
 *     tokens. Obfuscation just raises the cost of casual cracking.
 *
 * Skipped files: scripts/, license/constants.js (built injected later),
 * node_modules/.
 */
const fs = require('fs')
const path = require('path')

// Safety: only run in CI by default. Locally, `npm run package` would
// otherwise mutate your source files — bad. Set LH_FORCE_OBFUSCATE=1 to
// override (mostly useful for testing the script).
if (!process.env.CI && !process.env.LH_FORCE_OBFUSCATE) {
  console.log('Skipping obfuscation (not in CI). Set LH_FORCE_OBFUSCATE=1 to force.')
  process.exit(0)
}

const obfuscator = require('javascript-obfuscator')

const ELECTRON_DIR = path.join(__dirname, '..', 'electron')

// Files we deliberately do NOT obfuscate
const SKIP = new Set([
  // none currently — but listed for future flexibility
])

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const OBF_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,    // CFF is slow & sometimes breaks Electron APIs
  deadCodeInjection: false,         // not worth the size cost for a server-validated app
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.7,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,             // KEEP — renaming globals breaks Node module exports
  transformObjectKeys: false,       // breaks JSON-ish lookups
  splitStrings: true,
  splitStringsChunkLength: 8,
  selfDefending: true,              // resists trivial pretty-printing
  disableConsoleOutput: false,      // we need our [db]/[license] logs
}

let processed = 0
let skipped = 0
for (const file of walk(ELECTRON_DIR)) {
  const rel = path.relative(ELECTRON_DIR, file)
  if (!file.endsWith('.js')) { continue }
  if (SKIP.has(rel)) { skipped++; continue }

  try {
    const src = fs.readFileSync(file, 'utf8')
    // Skip tiny files (likely shims) and stuff that's clearly minified already
    if (src.length < 200) { skipped++; continue }

    const out = obfuscator.obfuscate(src, OBF_OPTIONS).getObfuscatedCode()
    fs.writeFileSync(file, out)
    processed++
    console.log('  ✓', rel)
  } catch (e) {
    console.warn('  ⚠ skipped (failed):', rel, '-', e.message)
    skipped++
  }
}

console.log(`\nObfuscated ${processed} files, skipped ${skipped}.`)
