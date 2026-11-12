#!/usr/bin/env node
/**
 * One-time (and re-runnable) pass for posts already on gh-pages.
 * Downloads each hero, writes a local WebP plus dimensions, and patches the
 * post HTML with the byline, TL;DR, author box, preload, and deferred GTM.
 * Also refreshes the static Field Notes index.
 */

import { execFile } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import {
  authorBoxHtml,
  bylineHtml,
  deferGtmInHtml,
  imageId,
  materializeHero,
  publicImageUrl,
  tldrHtml,
  trimBlogFonts,
  updateBlogIndex,
} from './generate-blog-post.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const postsPath = path.join(root, 'blog/data/posts.json')
const postsDir = path.join(root, 'blog/posts')

function walkHtml(dir, found = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'assets' && dir.endsWith('Hover-master')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'Hover-master') continue
      walkHtml(full, found)
    } else if (name.endsWith('.html')) found.push(full)
  }
  return found
}

function commentRanges(html) {
  const ranges = []
  const re = /<!--[\s\S]*?-->/g
  let match
  while ((match = re.exec(html))) ranges.push([match.index, match.index + match[0].length])
  return ranges
}

function inComment(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end)
}

async function probe(file) {
  const result = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    file,
  ], { timeout: 10000 })
  const [width, height] = result.stdout.trim().split('x').map(value => Number(value))
  return { width, height }
}

function resolveImage(htmlFile, src) {
  if (!src || src.startsWith('data:') || /^https?:\/\//i.test(src)) return ''
  const clean = src.split('?')[0].split('#')[0]
  if (clean.startsWith('/')) return path.join(root, clean.slice(1))
  return path.resolve(path.dirname(htmlFile), clean)
}

async function addMissingDimensions(html, htmlFile) {
  const ranges = commentRanges(html)
  const re = /<img\b[^>]*>/gi
  let match
  const edits = []
  while ((match = re.exec(html))) {
    if (inComment(ranges, match.index)) continue
    const tag = match[0]
    if (/\swidth\s*=/.test(tag)) continue
    const src = (tag.match(/\ssrc\s*=\s*"([^"]+)"/i) || [])[1]
    if (!src || !/\.(?:jpe?g|png|webp)$/i.test(src.split('?')[0])) continue
    const file = resolveImage(htmlFile, src)
    if (!file || !existsSync(file)) continue
    const { width, height } = await probe(file)
    if (!width || !height || width < 200) continue
    const updated = tag.replace(/\s*\/?>$/, ` width="${width}" height="${height}">`)
    edits.push({ start: match.index, end: match.index + tag.length, updated })
  }
  let out = html
  for (const edit of edits.reverse()) {
    out = `${out.slice(0, edit.start)}${edit.updated}${out.slice(edit.end)}`
  }
  return { html: out, added: edits.length }
}

function patchPostHtml(html, post, previousUrl) {
  let out = deferGtmInHtml(trimBlogFonts(html))
  const absolute = publicImageUrl(post.image)
  if (previousUrl && previousUrl !== post.image) {
    out = out.split(previousUrl).join(absolute)
  }
  if (post.unsplashId) {
    const remote = new RegExp(`https://images\\.unsplash\\.com/photo-${post.unsplashId}[^"'\\s]*`, 'g')
    out = out.replace(remote, absolute)
  }
  out = out.split(`src="${absolute}"`).join(`src="${post.image}"`)
  out = out.replace(/<img class="post-hero-img" src="[^"]*" alt="([^"]*)"[^>]*>/, (_match, alt) => {
    return `<img class="post-hero-img" src="${post.image}" alt="${alt}" width="${post.imageWidth}" height="${post.imageHeight}" fetchpriority="high">`
  })
  const preload = `<link rel="preload" as="image" href="${post.image}" fetchpriority="high">`
  if (out.includes('rel="preload" as="image"')) {
    out = out.replace(/<link rel="preload" as="image" href="[^"]*" fetchpriority="high">/, preload)
  } else {
    out = out.replace(
      /(<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">)/,
      `$1\n  ${preload}`,
    )
  }
  const tldr = tldrHtml(post).trim()
  if (out.includes('class="post-tldr"')) {
    out = out.replace(/<p class="post-tldr">[\s\S]*?<\/p>/, tldr)
  }
  if (!out.includes('class="post-byline"')) {
    out = out.replace(/<span class="post-date">[^<]*<\/span>\s*/g, '')
    const summary = `          ${bylineHtml(post)}\n          ${tldr}`
    out = out.replace(/(<h1 class="post-title">[\s\S]*?<\/h1>)/, `$1\n${summary}`)
  }
  if (!out.includes('class="post-author"')) {
    out = out.replace('<nav class="post-footer-nav">', `${authorBoxHtml()}\n\n        <nav class="post-footer-nav">`)
  }
  out = out.replace(
    /\.post-hero-img \{\s*width: 100%;\s*border-radius: 12px;/,
    `.post-hero-img {\n      width: 100%;\n      height: auto;\n      background: #111;\n      border-radius: 12px;`,
  )
  return out
}

function ensureHomeLcp(html) {
  let out = html
  const preload = '<link rel="preload" as="image" href="images/projects/castlog-devices.webp" fetchpriority="high">'
  if (!out.includes('href="images/projects/castlog-devices.webp" fetchpriority="high"') && !out.includes(preload)) {
    out = out.replace(
      /(<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>)/,
      `$1\n\t${preload}`,
    )
  }
  out = out.replace(
    /<img src="images\/projects\/castlog-devices\.webp" width="1600" height="1000" alt="([^"]*)">/,
    '<img src="images/projects/castlog-devices.webp" width="1600" height="1000" alt="$1" fetchpriority="high">',
  )
  return out
}

async function main() {
  const posts = JSON.parse(readFileSync(postsPath, 'utf8'))
  for (const post of posts) {
    const previous = post.image
    const id = post.unsplashId || imageId(previous)
    const localPath = path.join(root, 'blog/images', `${post.slug}.webp`)
    if (!(previous.startsWith('/blog/images/') && existsSync(localPath))) {
      const remote = previous.startsWith('http')
        ? previous
        : `https://images.unsplash.com/photo-${id}?w=1200&q=80`
      const saved = await materializeHero(remote, post.slug)
      post.image = saved.image
      post.imageWidth = saved.imageWidth
      post.imageHeight = saved.imageHeight
    } else if (!post.imageWidth || !post.imageHeight) {
      const size = await probe(localPath)
      post.imageWidth = size.width
      post.imageHeight = size.height
    }
    if (id) post.unsplashId = id
    const htmlPath = path.join(postsDir, `${post.slug}.html`)
    const html = readFileSync(htmlPath, 'utf8')
    writeFileSync(htmlPath, patchPostHtml(html, post, previous))
    console.log(`[sync] ${post.slug}: ${tldrHtml(post).replace(/<[^>]+>/g, '')}`)
  }
  writeFileSync(postsPath, JSON.stringify(posts, null, 2) + '\n')

  for (const file of walkHtml(root)) {
    let html = readFileSync(file, 'utf8')
    const next = trimBlogFonts(deferGtmInHtml(html))
    if (next !== html) {
      html = next
      writeFileSync(file, html)
      console.log(`[sync] fonts/gtm ${path.relative(root, file)}`)
    }
  }

  updateBlogIndex(posts)

  const homePath = path.join(root, 'index.html')
  const home = ensureHomeLcp(readFileSync(homePath, 'utf8'))
  writeFileSync(homePath, home)

  let sized = 0
  for (const file of walkHtml(root)) {
    const html = readFileSync(file, 'utf8')
    const result = await addMissingDimensions(html, file)
    if (result.added) {
      writeFileSync(file, result.html)
      sized += result.added
      console.log(`[sync] dimensions +${result.added} ${path.relative(root, file)}`)
    }
  }
  console.log(`[sync] added dimensions to ${sized} images`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
