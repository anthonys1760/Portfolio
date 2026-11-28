#!/usr/bin/env node
// Run: node --test scripts/drawbridge-attacks.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(readFileSync(path.join(root, 'data', 'drawbridge-attacks.json'), 'utf8'))
const page = readFileSync(path.join(root, 'projects', 'drawbridge', 'index.html'), 'utf8')

test('attack JSON score matches every scenario pass', () => {
  const { score, scenarios } = data
  assert.ok(Array.isArray(scenarios))
  assert.equal(scenarios.length, score.total)
  for (const scenario of scenarios) {
    assert.equal(scenario.pass, true)
    assert.ok(String(scenario.title || '').trim())
    assert.ok(String(scenario.expected || '').trim())
  }
  assert.equal(score.passed, scenarios.filter((s) => s.pass).length)
})

test('product page 8/8 and titles match the JSON', () => {
  const { score, scenarios } = data
  const headline = `${score.passed}/${score.total}`
  assert.match(page, new RegExp(headline.replace('/', '\\/')))
  const start = page.indexOf('<!-- attacks:start -->')
  const end = page.indexOf('<!-- attacks:end -->')
  assert.ok(start >= 0 && end > start, 'attacks markers present')
  const table = page.slice(start, end)
  for (const scenario of scenarios) {
    assert.ok(table.includes(scenario.title), `missing title: ${scenario.title}`)
  }
  if (scenarios.some((s) => !s.pass)) {
    assert.fail('a failed row must not ship, and the page cannot say 8/8')
  }
})
