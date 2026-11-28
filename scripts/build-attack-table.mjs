#!/usr/bin/env node
/**
 * Rewrite the attack-results table between <!-- attacks:start --> and
 * <!-- attacks:end --> in projects/drawbridge/index.html from
 * data/drawbridge-attacks.json. Do not type rows by hand.
 */

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'drawbridge-attacks.json')
const pagePath = path.join(root, 'projects', 'drawbridge', 'index.html')

const data = JSON.parse(await readFile(dataPath, 'utf8'))
const { score, scenarios, sourceCommit } = data

if (!Array.isArray(scenarios) || scenarios.length !== score.total) {
  console.error('scenarios.length must equal score.total')
  process.exit(1)
}
if (scenarios.some((s) => !s.pass) || score.passed !== scenarios.filter((s) => s.pass).length) {
  console.error('A scenario is not a pass; refusing to write 8/8 HTML')
  process.exit(1)
}

const rows = scenarios
  .map(
    (s) =>
      `      <tr role="row"><td role="cell">${escapeHtml(s.title)}</td><td role="cell">${escapeHtml(s.expected)}</td><td role="cell"><span class="pass"><span aria-hidden="true">✓</span> Pass</span></td></tr>`,
  )
  .join('\n')

const block = `<!-- attacks:start -->
    <!-- sourceCommit ${sourceCommit} from data/drawbridge-attacks.json -->
    <table class="atk" role="table">
      <caption class="sr-only">Attack results, ${score.passed} of ${score.total} scenarios pass</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col">Scenario</th>
          <th role="columnheader" scope="col">Expected</th>
          <th role="columnheader" scope="col">Result</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
${rows}
      </tbody>
    </table>
    <!-- attacks:end -->`

const page = await readFile(pagePath, 'utf8')
if (!/<!-- attacks:start -->[\s\S]*?<!-- attacks:end -->/.test(page)) {
  console.error('Could not find <!-- attacks:start --> … <!-- attacks:end --> in the product page')
  process.exit(1)
}
const next = page.replace(/<!-- attacks:start -->[\s\S]*?<!-- attacks:end -->/, block)
if (next !== page) {
  await writeFile(pagePath, next)
  console.log(`Wrote ${scenarios.length} attack rows from ${sourceCommit}`)
} else {
  console.log(`Attack table already current for ${sourceCommit}`)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
