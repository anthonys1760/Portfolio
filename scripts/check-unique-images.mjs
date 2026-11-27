#!/usr/bin/env node
/**
 * Exit 1 when two posts in blog/data/posts.json share an image.
 * A stored unsplashId, an Unsplash photo id in a URL, or a local file path
 * are each an identity. Also checks that each post HTML file uses that same
 * image in the hero, Open Graph, Twitter, and JSON-LD tags, with the
 * recorded width and height on the hero.
 *
 * In-body figures (posts.json "inlineImages") are part of the same check:
 * each file's sha256 and any Unsplash id must be unique across every cover
 * and every figure, the file must match its recorded hash, the post must show
 * it in a <figure> with the recorded alt text, and an SVG must not contain
 * script, event handlers, foreignObject, or external references.
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
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

function unescapeAttr(value) {
  return String(value)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function addKey(key, label) {
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(label)
}

let figureCount = 0
for (const post of posts) {
  if (post.inlineImages === undefined) continue
  if (!Array.isArray(post.inlineImages)) {
    problems.push(`${post.slug}: inlineImages must be an array`)
    continue
  }
  let html = ''
  try {
    html = readFileSync(path.join(postsDir, `${post.slug}.html`), 'utf8')
  } catch {
    continue
  }
  post.inlineImages.forEach((item, index) => {
    figureCount++
    const label = `${post.slug} figure ${index + 1}`
    const src = String(item?.src || '')
    if (!/^\/blog\/images\/[a-z0-9-]+-fig\d+\.(svg|webp)$/.test(src)) {
      problems.push(`${label}: unexpected src ${src || '(missing)'}`)
      return
    }
    const file = path.join(root, src.slice(1))
    if (!existsSync(file)) {
      problems.push(`${label}: missing ${src}`)
      return
    }
    const bytes = readFileSync(file)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (item.sha256 !== hash) problems.push(`${label}: sha256 in posts.json does not match ${src}`)
    addKey(`sha256:${hash}`, label)
    addKey(src, label)
    if (item.unsplashId) addKey(`unsplash:${item.unsplashId}`, label)
    if (src.endsWith('.svg')) {
      const text = bytes.toString('utf8')
      if (/<script|\son[a-z]+\s*=|<foreignObject|(?:xlink:)?href\s*=\s*["'](?!#)|url\((?!#)/i.test(text)) {
        problems.push(`${label}: SVG contains script, an event handler, foreignObject, or an external reference`)
      }
    }
    const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const tag = html.match(new RegExp(`<figure class="post-figure">(?:(?!</figure>)[\\s\\S])*?<img src="${escapedSrc}" alt="([^"]*)"[^>]*>(?:(?!</figure>)[\\s\\S])*?<figcaption>([^<]+)</figcaption>`))
    if (!tag) problems.push(`${label}: ${src} is not shown in a <figure class="post-figure"> with an img and figcaption`)
    else if (unescapeAttr(tag[1]) !== String(item.alt || '')) problems.push(`${label}: alt text in the page does not match posts.json`)
    else if (!unescapeAttr(tag[1]).trim()) problems.push(`${label}: alt text is empty`)
  })
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

console.log(`Unique images: ${posts.length} posts, ${figureCount} in-body figures, ${groups.size} distinct image keys`)
