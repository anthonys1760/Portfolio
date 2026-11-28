#!/usr/bin/env node
/**
 * Vendor Drawbridge replay + fonts + attack-results.json at a pinned SHA.
 * Run by hand. GitHub Pages must not fetch Drawbridge at deploy time.
 *
 *   node scripts/sync-drawbridge.mjs [sha] [sourceDir]
 */

import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DEFAULT_SHA = '8ef15ffc4a4dcfbf31414dcb6480016f1701b3e8'
const REPO_URL = 'https://github.com/anthonys1760/drawbridge'
const sha = process.argv[2] || process.env.DRAWBRIDGE_SHA || DEFAULT_SHA
const sourceDir = process.argv[3] || process.env.DRAWBRIDGE_SRC
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!sourceDir) {
  console.error('Pass a local Drawbridge checkout: node scripts/sync-drawbridge.mjs <sha> <sourceDir>')
  process.exit(1)
}

const replaySrc = path.join(sourceDir, 'site', 'replay')
const fontsSrc = path.join(sourceDir, 'site', 'fonts')
const attacksSrc = path.join(sourceDir, 'docs', 'attack-results.json')

for (const p of [replaySrc, fontsSrc, attacksSrc]) {
  if (!existsSync(p)) {
    console.error(`Missing ${p}`)
    process.exit(1)
  }
}

const replayDest = path.join(root, 'drawbridge', 'replay')
const fontsDest = path.join(root, 'drawbridge', 'fonts')
const sourceTxt = path.join(root, 'drawbridge', 'SOURCE.txt')
const attacksDest = path.join(root, 'data', 'drawbridge-attacks.json')

await rm(replayDest, { recursive: true, force: true })
await rm(fontsDest, { recursive: true, force: true })
await mkdir(replayDest, { recursive: true })
await mkdir(fontsDest, { recursive: true })
await mkdir(path.dirname(attacksDest), { recursive: true })

await cp(replaySrc, replayDest, { recursive: true })
await cp(fontsSrc, fontsDest, { recursive: true })

const indexPath = path.join(replayDest, 'index.html')
let html = await readFile(indexPath, 'utf8')
if (!/name="robots"/.test(html)) {
  html = html.replace(
    /<meta name="viewport"[^>]*>/,
    `$&\n    <meta name="robots" content="noindex">`,
  )
  await writeFile(indexPath, html)
}

const fetchedAt = new Date().toISOString().slice(0, 10)
const sourceNote = [
  `repo: ${REPO_URL}`,
  `sha: ${sha}`,
  `url: ${REPO_URL}/tree/${sha}`,
  `date: ${fetchedAt}`,
  `copied: site/replay/** → /drawbridge/replay/`,
  `copied: site/fonts/** → /drawbridge/fonts/`,
  `edit: robots noindex meta was applied to drawbridge/replay/index.html after copy`,
  `note: relative asset paths (./ and ../fonts/) are preserved; do not iframe github.io`,
].join('\n') + '\n'
await writeFile(sourceTxt, sourceNote)

const attacks = JSON.parse(await readFile(attacksSrc, 'utf8'))
attacks.sourceCommit = sha
attacks.sourceUrl = `${REPO_URL}/blob/${sha}/docs/attack-results.json`
attacks.fetchedAt = fetchedAt
await writeFile(attacksDest, JSON.stringify(attacks, null, 2) + '\n')

console.log(`Vendored Drawbridge ${sha}`)
console.log(`  ${path.relative(root, replayDest)}`)
console.log(`  ${path.relative(root, fontsDest)}`)
console.log(`  ${path.relative(root, attacksDest)}`)
console.log(`  ${path.relative(root, sourceTxt)}`)
