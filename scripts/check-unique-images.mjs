#!/usr/bin/env node
/**
 * Exit 1 when two posts in blog/data/posts.json share an image.
 * A stored unsplashId, an Unsplash photo id in a URL, or a local file path
 * are each an identity. Also checks that each post HTML file uses that same
 * image in the hero, Open Graph, Twitter, and JSON-LD tags, with the
 * recorded width and height on the hero.
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
  if (match) return `unsplash:${match[1]}`
  return String(url || '').replace(/^https:\/\/anthonysdigital\.net/, '').split('?')[0]
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
  if (post.unsplashId) {
    const sourceKey = `unsplash:${post.unsplashId}`
    if (!groups.has(sourceKey)) groups.set(sourceKey, [])
    if (!groups.get(sourceKey).includes(post.slug)) groups.get(sourceKey).push(post.slug)
  }

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
  const jsonLd = html.match(/"@type": "ImageObject"[\s\S]*?"url": "([^"]+)"/)
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
  if (post.imageWidth && !html.includes(`width="${post.imageWidth}"`)) {
    problems.push(`${post.slug}: hero is missing width="${post.imageWidth}"`)
  }
  if (post.imageHeight && !html.includes(`height="${post.imageHeight}"`)) {
    problems.push(`${post.slug}: hero is missing height="${post.imageHeight}"`)
  }
  const heroTag = html.match(/<img class="post-hero-img"[^>]*>/)
  if (heroTag && /loading="lazy"/.test(heroTag[0])) {
    problems.push(`${post.slug}: hero image is lazy-loaded`)
  }
  if (heroTag && !/fetchpriority="high"/.test(heroTag[0])) {
    problems.push(`${post.slug}: hero image is missing fetchpriority="high"`)
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
