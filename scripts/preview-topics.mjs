#!/usr/bin/env node
/**
 * Print the next N topics the weekly writer would pick, in order, with the
 * format and opening each would get. Uses the same selection functions as
 * generate-blog-post.mjs. It does not call the model or write files.
 *
 * Each simulated pick is added as a placeholder post (topicKey, format, date)
 * so the next pick sees it, the same way a merged draft would. Open blog pull
 * requests are included when `gh` can list them.
 *
 *   node scripts/preview-topics.mjs [count]
 */

import {
  loadExistingPosts,
  loadOpenBlogSignals,
  loadRetiredStubs,
  pickFormat,
  pickOpening,
  pickTopic,
} from './generate-blog-post.mjs'

const count = Number(process.argv[2]) || 6
const posts = loadExistingPosts()
const stubs = loadRetiredStubs()
const openPrs = await loadOpenBlogSignals()

// Mon/Thu schedule, starting after today.
function nextRunDates(n) {
  const dates = []
  const day = new Date()
  day.setUTCHours(0, 0, 0, 0)
  while (dates.length < n) {
    day.setUTCDate(day.getUTCDate() + 1)
    if ([1, 4].includes(day.getUTCDay())) dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

const rows = []
for (const dateISO of nextRunDates(count)) {
  const { topic } = pickTopic(posts, stubs, openPrs)
  if (!topic) {
    rows.push({ dateISO, topicKey: '(topics exhausted)' })
    break
  }
  const { format } = pickFormat(posts, openPrs)
  const opening = pickOpening(posts, openPrs)
  rows.push({ dateISO, topicKey: topic.key, short: topic.short, label: topic.label, format: format.key, opening: opening.key, summary: topic.summary })
  posts.unshift({ slug: `preview-${topic.key}`, topicKey: topic.key, format: format.key, dateISO })
}

for (const [index, row] of rows.entries()) {
  console.log(`${index + 1}. ${row.dateISO}  ${row.topicKey}${row.format ? `  [${row.format}, opening: ${row.opening}]` : ''}`)
  if (row.label) {
    console.log(`   ${row.label}`)
    console.log(`   ${row.summary}`)
  }
}
