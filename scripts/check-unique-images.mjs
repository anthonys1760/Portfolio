#!/usr/bin/env node
/**
 * Exit 1 when two posts in blog/data/posts.json share an image.
 * Photo ids are the identity, so query-string variants of the same Unsplash
 * photo count as one image. Also checks that each post HTML file uses that
 * same image in the hero, Open Graph, Twitter, and JSON-LD tags.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const postsPath = path.join(root, 'blog/data/posts.json')
const postsDir = path.join(root, 'blog/posts')
const posts = JSON.parse(readFileSync(postsPath, 'utf8'))

function imageKey(url) {
  const match = String(url || '').match(/photo-([A-Za-z0-9_-]+)/)
  if (match) return match[1]
  return String(url || '').split('?')[0]
}

const problems = []
const groups = new Map()

for (const post of posts) {
  const key = imageKey(post.image)
  if (!key) {
    problems.push(`${post.slug}: missing image`)
    continue
  }
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(post.slug)

  const htmlPath = path.join(postsDir, `${post.slug}.html`)
  let html
  try {
    html = readFileSync(htmlPath, 'utf8')
  } catch {
    problems.push(`${post.slug}: missing ${path.relative(root, htmlPath)}`)
    continue
  }

  const og = html.match(/<meta property="og:image" content="([^"]*)"/)
  const twitter = html.match(/<meta name="twitter:image" content="([^"]*)"/)
  const jsonLd = html.match(/"url": "(https:\/\/images\.unsplash\.com\/[^"]+)"/)
  const hero = html.match(/<img class="post-hero-img" src="([^"]*)" alt="([^"]*)"/)
  const places = [
    ['og:image', og?.[1]],
    ['twitter:image', twitter?.[1]],
    ['JSON-LD image', jsonLd?.[1]],
    ['hero img', hero?.[1]],
  ]
  for (const [label, value] of places) {
    if (imageKey(value) !== key) {
      problems.push(`${post.slug}: ${label} is ${value || '(missing)'}, posts.json has ${post.image}`)
    }
  }

  const expectedAlt = post.imageAlt || post.title
  if (hero && hero[2] !== expectedAlt) {
    problems.push(`${post.slug}: hero alt is "${hero[2]}", expected "${expectedAlt}"`)
  }
}

for (const [key, slugs] of groups) {
  if (slugs.length > 1) {
    problems.push(`shared image ${key}: ${slugs.join(', ')}`)
  }
}

if (problems.length) {
  console.error(`Image check failed (${problems.length}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}

console.log(`Unique images: ${posts.length} posts, ${groups.size} distinct images`)
