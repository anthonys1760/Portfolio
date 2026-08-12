#!/usr/bin/env node
/**
 * generate-blog-post.mjs
 *
 * Generates one application security methodology post per run via
 * OpenRouter (Claude), rotating through OWASP API security topics.
 *
 * For the post it writes:
 *   - /blog/posts/[slug].html  — full standalone post page
 *   - /blog/data/posts.json    — prepended with new post metadata
 *   - /sitemap.xml             — appended with the post URL
 *
 * Required env var:
 *   OPENROUTER_API_KEY
 *
 * Optional env var:
 *   DRY_RUN=1  — skip the OpenRouter call and use built-in fixtures
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const POSTS_JSON = path.join(ROOT, 'blog/data/posts.json')
const POSTS_DIR = path.join(ROOT, 'blog/posts')

// ── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === '1'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
if (!OPENROUTER_API_KEY && !DRY_RUN) { console.error('[Blog] Missing OPENROUTER_API_KEY'); process.exit(1) }

// ── Application security methodology series ──────────────────────────────────
// One post each run: how I test for or defend against one class of flaw.
// Rotation is keyed on topicKey stored in posts.json, so dedup is exact.

const SECURITY_SERIES = 'appsec-methodology'

const SECURITY_TOPICS = [
  { key: 'bola', label: 'Broken Object Level Authorization (BOLA, also called IDOR)' },
  { key: 'bopla', label: 'Broken Object Property Level Authorization (mass assignment and excessive data exposure)' },
  { key: 'authn-jwt', label: 'Broken authentication and JWT validation flaws' },
  { key: 'bfla', label: 'Broken Function Level Authorization' },
  { key: 'resource-abuse', label: 'Unrestricted resource consumption and rate limiting' },
  { key: 'ssrf', label: 'Server Side Request Forgery' },
  { key: 'misconfig', label: 'Security misconfiguration' },
  { key: 'inventory', label: 'Improper inventory management, meaning shadow and zombie APIs' },
  { key: 'third-party', label: 'Unsafe consumption of third party APIs' },
  { key: 'injection', label: 'Injection flaws across SQL, NoSQL, and command interpreters' },
  { key: 'xss-api', label: 'Cross Site Scripting in API driven frontends' },
  { key: 'deserialization', label: 'Insecure deserialization' },
  { key: 'agent-scoping', label: 'Agent and LLM tool call scoping' },
]

// Curated fallback Unsplash IDs (verified working)
const FALLBACK_IMAGES = [
  'photo-1461749280684-dccba630e2f6',
  'photo-1555066931-4365d14bab8c',
  'photo-1498050108023-c5249f4df085',
  'photo-1504384308090-c894fdcc538d',
  'photo-1517694712202-14dd9538aa97',
  'photo-1531297484001-80022131f5a1',
]

function randomFallback() {
  const id = FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)]
  return `https://images.unsplash.com/${id}?w=1200&q=80`
}

async function verifyImageUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

async function safeImageUrl(url) {
  if (!url || !url.startsWith('http')) return randomFallback()
  const ok = await verifyImageUrl(url)
  return ok ? url : randomFallback()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0]
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

function loadExistingPosts() {
  try {
    return JSON.parse(readFileSync(POSTS_JSON, 'utf8'))
  } catch {
    return []
  }
}

// Security rotation is exact, not fuzzy: it keys on topicKey recorded in
// posts.json rather than guessing from the model-chosen title.
function pickSecurityTopic(existingPosts) {
  const covered = new Map()
  for (const p of securityPosts(existingPosts)) {
    if (!p.topicKey) continue
    const seen = covered.get(p.topicKey)
    if (!seen || p.dateISO > seen) covered.set(p.topicKey, p.dateISO)
  }

  const uncovered = SECURITY_TOPICS.find(t => !covered.has(t.key))
  if (uncovered) return uncovered

  // Everything covered: revisit whichever topic went longest without a post.
  return [...SECURITY_TOPICS].sort(
    (a, b) => (covered.get(a.key) || '').localeCompare(covered.get(b.key) || '')
  )[0]
}

function securityPosts(existingPosts) {
  return existingPosts.filter(p => p.series === SECURITY_SERIES)
}

// ── JSON repair: escape bare newlines/tabs inside string values ───────────────

function repairJson(str) {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString && ch === '\n') { result += '\\n'; continue }
    if (inString && ch === '\r') { result += '\\r'; continue }
    if (inString && ch === '\t') { result += '\\t'; continue }
    result += ch
  }
  return result
}

// ── OpenRouter call ───────────────────────────────────────────────────────────

async function callModel(prompt, fixtureKind) {
  if (DRY_RUN) {
    console.log(`[Blog] DRY_RUN: using ${fixtureKind} fixture instead of OpenRouter`)
    return structuredClone(FIXTURES[fixtureKind])
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://www.anthonysdigital.net',
      'X-Title': 'Anthony Smith Blog Automation',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      temperature: 0.75,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const data = await response.json()
  const raw = data.choices[0].message.content.trim()
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

  try {
    return JSON.parse(repairJson(jsonStr))
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}\nRaw: ${raw.slice(0, 500)}`)
  }
}

// Stamp date + a slug that does not collide with anything already published.
function finalizePost(post, existingPosts, dateISO) {
  post.date = formatDate(dateISO)
  post.dateISO = dateISO
  post.slug = slugify(post.title)

  // Ensure slug uniqueness
  const existingSlugs = existingPosts.map(p => p.slug)
  if (existingSlugs.includes(post.slug)) {
    post.slug = `${post.slug}-${dateISO}`
  }
  return post
}

// ── Application security methodology post ────────────────────────────────────

function buildSecurityPrompt(topic, priorTitles, problems = []) {
  const priorList = priorTitles.length
    ? priorTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(none yet)'

  const retryNote = problems.length
    ? `\n\nYour previous attempt was rejected. Fix every one of these problems:\n${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`
    : ''

  return `You are writing a weekly application security methodology post for Anthony Smith's portfolio site. Anthony is a senior full stack engineer (15 years) specializing in application and API security. These posts are public proof of his security methodology. They are read by hiring managers, AppSec engineers, and referring engineers, so they must be technically correct and never fabricate findings.

## What this post is

A conceptual methodology walkthrough of one application or API security topic: how Anthony thinks about testing for or defending against a specific class of flaw. It is his method, not a report of a specific bug he found. Never claim a real vulnerability was discovered in any named product, company, or live target. The value is the thinking, not a trophy.

The topic for this post is: ${topic.label}

Cover only that topic. Do not repeat any of these already published posts in this series:
${priorList}

## Structure (follow this exactly)

1. Open with the common mistake. State the specific gap in how most APIs or apps handle this, in plain language. Lead with the flaw, not a definition. One to two short paragraphs.
2. Explain why it hides. What makes this hard to notice in normal use or in code review. This is the insight that makes the post worth reading.
3. The method. An ordered, numbered list of how you test for or defend against it. Conceptual steps, not copy-paste payloads. Each step is a sentence or two.
4. One deeper nuance. A single non-obvious point that separates a practitioner from someone who read one blog post (for example: a UUID is not an authorization control, or test every verb, not just reads).
5. Why it stays a problem. One short paragraph on why this class of flaw survives in production despite being well known.
6. A one or two sentence plain-language summary at the end. No grand closer.

Target length: 500 to 800 words of prose. Tighter is better than padded.

## Voice and hard formatting rules

These are strict. Violating them makes the post read as AI generated, which defeats its purpose.

- NO dashes as punctuation. No em dashes, no en dashes, no hyphens joining clauses. Use a comma, a period, or a colon. Rewrite the sentence if needed.
- Avoid hyphenated compounds where a natural word exists: "full stack" not "full-stack", "third party" not "third-party", "low privilege" not "low-privilege".
- Short, direct sentences. Say the thing and stop. No corporate filler, no "in today's fast-paced landscape", no "let's dive in".
- No exclamation points. No emoji.
- Do not open with a dictionary definition. Open with the mistake or the stakes.
- Do not end with an aphorism, a call to action, or "stay tuned". End on the plain summary.
- Use "I" (this is Anthony's method in his voice).
- Use the orderedlist block for the method. Do not use the list block, since dash markers read as machine output.

## Accuracy guardrails

- Never invent a CVE, a bug bounty payout, a company name as a victim, or a specific discovered vulnerability.
- If you reference a real standard (OWASP API Security Top 10, CWE, a spec), get it right. If unsure of a detail, describe the concept without citing a specific number.
- Keep it conceptual. Illustrative request paths like GET /api/invoices/4021 are fine as generic examples. Do not publish working exploit payloads or step-by-step attack tooling.
- Prefer defensive framing. The reader should come away knowing how to prevent the flaw, not just trigger it.

## Output format

Respond ONLY with valid JSON (no markdown fences, no extra text) matching this exact schema:
{
  "title": "How I Test for X",
  "excerpt": "2-sentence excerpt for the blog card listing (max 200 chars, no HTML)",
  "category": "Security",
  "readTime": "X min",
  "keywords": "6-10 comma separated SEO keywords",
  "tags": ["appsec", "api-security", "owasp"],
  "image": "https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=1200&q=80",
  "body": [
    { "type": "paragraph", "text": "..." },
    { "type": "heading", "text": "..." },
    { "type": "orderedlist", "items": ["...", "..."] },
    { "type": "callout", "text": "..." },
    { "type": "code", "lang": "js", "code": "..." }
  ]
}

Output rules:
- The title must be plain, not clickbait, in the form "How I Test for X" or "How I Think About X on REST APIs" or similar. It must start with "How I".
- The title must be clearly distinguishable at a glance from every already published title listed above. If the formal name of this topic is one word away from a prior title, name the topic by its concrete behavior instead (for example "Mass Assignment" rather than a near-identical OWASP category name).
- category must be exactly "Security".
- Map the structure above onto blocks in this order: one or two opening paragraphs with no heading first, then heading plus paragraph for why it hides, then heading plus one orderedlist block of 4 to 7 numbered steps for the method, then heading plus a paragraph or callout for the deeper nuance, then heading plus paragraph for why it stays a problem, then a closing paragraph with the plain summary.
- Include 3 to 5 headings.
- Include exactly one orderedlist block.
- Code blocks are optional: include 0 to 2, and only defensive examples such as an authorization check, a validation schema, or an allowlist. Never an exploit payload, never attack tooling.
- paragraph, callout, and list item text may use <strong>, <em>, and <code> inline tags only.
- code blocks: escape any backslashes in the JSON string.
- For the featured image, provide a direct Unsplash CDN URL using a photo ID you are confident exists (format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=1200&q=80). Choose a photo relevant to security or engineering.${retryNote}`
}

async function generateSecurityPost(existingPosts) {
  const topic = pickSecurityTopic(existingPosts)
  const priorTitles = securityPosts(existingPosts).map(p => p.title)
  const dateISO = today()

  console.log(`[Blog] Generating security methodology post on topic: "${topic.label}"`)

  let post = await callModel(buildSecurityPrompt(topic, priorTitles), 'security')
  let problems = validateSecurityPost(enforceVoice(post))

  if (problems.length) {
    console.warn(`[Blog] Security post failed validation, retrying once: ${problems.join('; ')}`)
    post = await callModel(buildSecurityPrompt(topic, priorTitles, problems), 'security')
    problems = validateSecurityPost(enforceVoice(post))
    // Cosmetic checks only. Publish with warnings rather than silently
    // dropping the week's post.
    if (problems.length) console.warn(`[Blog] Publishing with remaining issues: ${problems.join('; ')}`)
  }

  post.category = 'Security'
  post.series = SECURITY_SERIES
  post.topicKey = topic.key

  finalizePost(post, existingPosts, dateISO)

  console.log(`[Blog] Generated: "${post.title}" → ${post.slug}`)
  return post
}

// ── Voice enforcement (security posts only) ──────────────────────────────────

const COMPOUNDS = [
  [/\bfull-stack\b/gi, 'full stack'],
  [/\bthird-party\b/gi, 'third party'],
  [/\blow-privilege\b/gi, 'low privilege'],
  [/\bserver-side\b/gi, 'server side'],
  [/\bclient-side\b/gi, 'client side'],
  [/\bcross-site\b/gi, 'cross site'],
  [/\brate-limiting\b/gi, 'rate limiting'],
]

function matchCase(replacement, original) {
  return /^[A-Z]/.test(original)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement
}

function cleanProse(str) {
  let out = String(str)

  // Dashes used as punctuation become commas.
  out = out.replace(/\s*[—–]\s*/g, ', ')

  for (const [pattern, replacement] of COMPOUNDS) {
    out = out.replace(pattern, m => matchCase(replacement, m))
  }

  out = out.replace(/!/g, '.')

  // Tidy artifacts the comma substitution can leave behind.
  return out
    .replace(/,\s*([.,;:])/g, '$1')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/,\s*$/, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

// Applied to prose only. Code blocks are left exactly as generated.
function enforceVoice(post) {
  if (post.title) post.title = cleanProse(post.title)
  if (post.excerpt) post.excerpt = cleanProse(post.excerpt)

  for (const block of post.body || []) {
    if (block.type === 'code') continue
    if (typeof block.text === 'string') block.text = cleanProse(block.text)
    if (Array.isArray(block.items)) block.items = block.items.map(cleanProse)
  }
  return post
}

// ── Structural validation (security posts only) ──────────────────────────────

function countWords(post) {
  const prose = (post.body || [])
    .filter(b => b.type !== 'code')
    .flatMap(b => (typeof b.text === 'string' ? [b.text] : b.items || []))
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
  return prose.split(/\s+/).filter(Boolean).length
}

function validateSecurityPost(post) {
  const problems = []
  const body = post.body || []

  if (!/^How I\b/.test(post.title || '')) {
    problems.push('The title must start with "How I", for example "How I Test for Broken Object Level Authorization".')
  }
  if (post.category !== 'Security') {
    problems.push('category must be exactly "Security".')
  }

  const words = countWords(post)
  if (words < 450 || words > 900) {
    problems.push(`Prose is ${words} words. Target 500 to 800 words.`)
  }

  const orderedLists = body.filter(b => b.type === 'orderedlist').length
  if (orderedLists !== 1) {
    problems.push(`Include exactly one orderedlist block for the method, found ${orderedLists}.`)
  }

  const codeBlocks = body.filter(b => b.type === 'code').length
  if (codeBlocks > 2) {
    problems.push(`Include at most 2 code blocks, found ${codeBlocks}.`)
  }

  const headings = body.filter(b => b.type === 'heading').length
  if (headings < 3) {
    problems.push(`Include 3 to 5 headings, found ${headings}.`)
  }

  if (body[0]?.type !== 'paragraph') {
    problems.push('The post must open with a paragraph, not a heading.')
  }

  const proseWithDash = body
    .filter(b => b.type !== 'code')
    .flatMap(b => (typeof b.text === 'string' ? [b.text] : b.items || []))
    .concat([post.title || '', post.excerpt || ''])
    .some(t => /[—–]/.test(t))
  if (proseWithDash) {
    problems.push('Remove every em dash and en dash. Use a comma, a period, or a colon.')
  }

  return problems
}

// ── Render body block to HTML ─────────────────────────────────────────────────

function renderBlock(block) {
  switch (block.type) {
    case 'heading':
      return `<h2>${escapeHtml(block.text)}</h2>`
    case 'paragraph':
      return `<p>${block.text}</p>`
    case 'callout':
      return `<div class="post-callout">${block.text}</div>`
    case 'list':
      return `<ul>${(block.items || []).map(i => `<li>${i}</li>`).join('')}</ul>`
    case 'orderedlist':
      return `<ol>${(block.items || []).map(i => `<li>${i}</li>`).join('')}</ol>`
    case 'code':
      return `<pre><code class="lang-${block.lang || 'text'}">${escapeCode(block.code || '')}</code></pre>`
    default:
      return ''
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeCode(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Build post HTML page ──────────────────────────────────────────────────────

function buildPostHtml(post) {
  const bodyHtml = (post.body || []).map(renderBlock).join('\n\n')

  return `<!doctype html>
<html lang="en-US">
<head>
  <!-- Google Tag Manager -->
  <script>
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-52FVS76');
  </script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=UA-105675198-1"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','UA-105675198-1');</script>

  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="description" content="${escapeHtml(post.excerpt)}">
  <meta name="keywords" content="${escapeHtml(post.keywords || '')}">
  <meta name="author" content="Anthony Smith">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://www.anthonysdigital.net/blog/posts/${post.slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.anthonysdigital.net/blog/posts/${post.slug}.html">
  <meta property="og:title" content="${escapeHtml(post.title)} — Anthony Smith">
  <meta property="og:description" content="${escapeHtml(post.excerpt)}">
  <meta property="og:image" content="${post.image}">
  <meta property="og:site_name" content="Anthony Smith — Full Stack Engineer">
  <meta property="article:published_time" content="${post.dateISO}">
  <meta property="article:author" content="Anthony Smith">
  <meta property="article:section" content="${escapeHtml(post.category)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@anthonys1760">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.excerpt)}">
  <meta name="twitter:image" content="${post.image}">

  <title>${escapeHtml(post.title)} — Anthony Smith</title>

  <link href="https://fonts.googleapis.com/css?family=Roboto:100,300,400,500,700,900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/basic.css">
  <link rel="stylesheet" href="/css/layout.css">
  <link rel="stylesheet" href="/css/animate.css">
  <link rel="stylesheet" href="/css/fontawesome.css">
  <link rel="stylesheet" href="/css/brands.css">
  <link rel="stylesheet" href="/css/solid.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/3.7.2/animate.min.css">
  <link rel="stylesheet" href="/css/hero-theme.css">
  <link rel="shortcut icon" href="/favicon.ico" type="image/x-icon">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#4bffa5">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": "https://www.anthonysdigital.net/blog/posts/${post.slug}.html"
    },
    "headline": "${escapeHtml(post.title)}",
    "description": "${escapeHtml(post.excerpt)}",
    "keywords": "${escapeHtml(post.keywords || '')}",
    "articleSection": "${escapeHtml(post.category)}",
    "image": {
      "@type": "ImageObject",
      "url": "${post.image}"
    },
    "datePublished": "${post.dateISO}",
    "dateModified": "${post.dateISO}",
    "author": {
      "@type": "Person",
      "name": "Anthony Smith",
      "url": "https://www.anthonysdigital.net",
      "jobTitle": "Senior Full Stack Engineer & Solutions Architect"
    },
    "publisher": {
      "@type": "Person",
      "name": "Anthony Smith",
      "url": "https://www.anthonysdigital.net"
    },
    "url": "https://www.anthonysdigital.net/blog/posts/${post.slug}.html",
    "isPartOf": {
      "@type": "Blog",
      "name": "Anthony Smith — Technical Blog",
      "url": "https://www.anthonysdigital.net/blog/"
    }
  }
  </script>

  <style>
    .post-wrap {
      position: relative;
      z-index: 2;
      max-width: 760px;
      margin: 0 auto;
      padding: 150px 24px 100px;
    }
    .post-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: rgba(255,255,255,0.4);
      text-decoration: none;
      margin-bottom: 40px;
      transition: color 0.2s;
    }
    .post-back:hover { color: #4bffa5; }
    .post-header { margin-bottom: 40px; }
    .post-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .post-category {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #4bffa5;
      background: rgba(75,255,165,0.1);
      border: 1px solid rgba(75,255,165,0.25);
      border-radius: 20px;
      padding: 3px 10px;
    }
    .post-read, .post-date {
      font-size: 0.8rem;
      color: rgba(255,255,255,0.35);
    }
    .post-title {
      font-size: 1.6rem !important;
      font-weight: 700;
      color: #fff;
      line-height: 1.3;
      margin: 0 0 20px;
    }
    .post-hero-img {
      width: 100%;
      border-radius: 12px;
      margin-bottom: 48px;
      max-height: 420px;
      object-fit: cover;
    }
    .post-body h2 {
      font-size: 1.45rem;
      font-weight: 600;
      color: #fff;
      margin: 40px 0 14px;
    }
    .post-body p {
      color: rgba(255,255,255,0.75);
      line-height: 1.8;
      font-size: 1rem;
      margin-bottom: 18px;
    }
    .post-body ul, .post-body ol {
      color: rgba(255,255,255,0.7);
      line-height: 1.8;
      padding-left: 20px;
      margin-bottom: 18px;
    }
    .post-body li { margin-bottom: 6px; }
    .post-body ol li { padding-left: 4px; }
    .post-body ol li::marker { color: #4bffa5; font-weight: 600; }
    .post-body pre {
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 20px 22px;
      overflow-x: auto;
      margin: 24px 0;
    }
    .post-body code {
      font-family: 'Roboto Mono', 'Courier New', monospace;
      font-size: 0.875rem;
      color: #4bffa5;
    }
    .post-body p code, .post-body li code {
      background: rgba(75,255,165,0.08);
      border: 1px solid rgba(75,255,165,0.15);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.875em;
    }
    .post-callout {
      background: rgba(75,255,165,0.07);
      border-left: 3px solid #4bffa5;
      border-radius: 0 8px 8px 0;
      padding: 16px 20px;
      margin: 24px 0;
      color: rgba(255,255,255,0.8);
      font-size: 0.95rem;
      line-height: 1.7;
    }
    .post-footer-nav {
      margin-top: 64px;
      padding-top: 32px;
      border-top: 1px solid rgba(255,255,255,0.08);
      text-align: center;
    }
    .post-footer-nav a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #4bffa5;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.9rem;
      transition: opacity 0.2s;
    }
    .post-footer-nav a:hover { opacity: 0.75; }
    @media (max-width: 600px) {
      .post-title { font-size: 1.35rem !important; }
      .post-wrap { padding: 130px 18px 80px; }
    }
  </style>
</head>

<body class="hero-themed">
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-52FVS76" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <!-- Preloader -->
  <div class="preloader">
    <div class="centrize full-width">
      <div class="vertical-center">
        <div class="spinner">
          <div class="double-bounce1"></div>
          <div class="double-bounce2"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Full-page background (outside container to avoid clipping) -->
  <div style="position:fixed;inset:0;z-index:0;pointer-events:none;">
    <div class="hero-gradient-bg"></div>
  </div>

  <div class="container" style="position:relative;z-index:1;min-height:100vh;background:transparent;">
    <div class="cursor-follower"></div>

    <!-- Header -->
    <header class="header">
      <div class="head-top">
        <a href="#" class="menu-btn"><span></span></a>
        <div class="logo hover-masks-logo">
          <a href="/index.html">
            <span class="mask-lnk">Anthony <strong>Smith</strong></span>
          </a>
        </div>
        <div class="top-menu hover-masks">
          <div class="top-menu-nav">
            <div class="menu-topmenu-container">
              <ul class="menu">
                <li class="menu-item menu-item-has-children"><a href="/index.html">Home</a></li>
                <li class="menu-item menu-item-has-children"><a href="/about.html">About</a></li>
                <li class="menu-item menu-item-has-children"><a href="/portfolio.html">Portfolio</a></li>
                <li class="menu-item menu-item-has-children current-menu-item"><a href="/blog/">Technical Blog</a></li>
                <li class="menu-item menu-item-has-children"><a href="/contact.html">Contact</a></li>
              </ul>
            </div>
            <div class="top-menu-social" aria-label="Social links">
              <a class="top-menu-social-link" href="https://github.com/anthonys1760?tab=repositories" target="_blank" rel="noopener" aria-label="GitHub">
                <span class="icon fab fa-github"></span><span class="label">GitHub</span>
              </a>
              <a class="top-menu-social-link" href="mailto:anthony.smith1760@gmail.com" aria-label="Email">
                <span class="icon fas fa-envelope"></span><span class="label">Email</span>
              </a>
              <a class="top-menu-social-link" href="https://www.codementor.io/@anthonys1760" target="_blank" rel="noopener" aria-label="Codementor">
                <span class="icon fas fa-graduation-cap"></span><span class="label">Codementor</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="wrapper">

      <!-- Post Content -->
      <article class="post-wrap">

        <a href="/blog/" class="post-back">&larr; All posts</a>

        <header class="post-header">
          <div class="post-meta">
            <span class="post-category">${escapeHtml(post.category)}</span>
            <span class="post-read">${escapeHtml(post.readTime)} read</span>
            <span class="post-date">${escapeHtml(post.date)}</span>
          </div>
          <h1 class="post-title">${escapeHtml(post.title)}</h1>
        </header>

        <img class="post-hero-img" src="${post.image}" alt="${escapeHtml(post.title)}" onerror="this.style.display='none'">

        <div class="post-body">
          ${bodyHtml}
        </div>

        <nav class="post-footer-nav">
          <a href="/blog/">&larr; Back to all posts</a>
        </nav>

      </article>

      <!-- Footer -->
      <footer class="footer" style="position:relative;z-index:2;">
        <div class="copy"></div>
        <div class="soc-box">
          <div class="follow-label">Follow Me</div>
          <div class="soc">
            <a target="_blank" rel="noopener" href="https://github.com/anthonys1760?tab=repositories" aria-label="GitHub">
              <span class="icon fab fa-github"></span>
            </a>
          </div>
        </div>
        <div class="clear"></div>
      </footer>

      <div class="lines">
        <div class="line-col"></div><div class="line-col"></div><div class="line-col"></div>
        <div class="line-col"></div><div class="line-col"></div>
      </div>
    </div>
  </div>

  <script src="/js/jquery.min.js"></script>
  <script src="/js/scripts.js"></script>
  <script src="/js/enhancements.js"></script>
</body>
</html>`
}

// ── Update posts.json ─────────────────────────────────────────────────────────

function toMeta(post) {
  // Strip body from listing JSON — only need metadata for the card.
  // series/topicKey/tags are extra keys used by the security rotation;
  // blog/index.html ignores keys it does not read.
  const meta = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    readTime: post.readTime,
    date: post.date,
    dateISO: post.dateISO,
    image: post.image,
  }
  if (post.series) meta.series = post.series
  if (post.topicKey) meta.topicKey = post.topicKey
  if (Array.isArray(post.tags) && post.tags.length) meta.tags = post.tags
  return meta
}

function savePosts(posts) {
  writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2) + '\n', 'utf8')
  console.log(`[Blog] Updated posts.json (${posts.length} total)`)
}

// ── Sitemap update ────────────────────────────────────────────────────────────

function updateSitemap(slug, dateISO) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml')
  let xml = readFileSync(sitemapPath, 'utf8')

  const postUrl = `https://www.anthonysdigital.net/blog/posts/${slug}.html`

  // Skip if already in sitemap
  if (xml.includes(postUrl)) {
    console.log('[Blog] Sitemap already contains this post, skipping')
    return
  }

  const entry = `\t<url>\n\t\t<loc>${postUrl}</loc>\n\t\t<lastmod>${dateISO}</lastmod>\n\t\t<changefreq>never</changefreq>\n\t\t<priority>0.7</priority>\n\t</url>`
  xml = xml.replace('</urlset>', `${entry}\n</urlset>`)

  writeFileSync(sitemapPath, xml, 'utf8')
  console.log(`[Blog] Updated sitemap.xml with ${postUrl}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── DRY_RUN fixtures ─────────────────────────────────────────────────────────
// Used only when DRY_RUN=1, so the render, voice, validation and write paths
// can be exercised without spending API credits. The security fixture
// deliberately contains an em dash, a hyphenated compound and an exclamation
// point so enforceVoice is proven to strip them.

const FIXTURES = {
  security: {
    title: 'How I Test for Broken Object Level Authorization',
    excerpt: 'Most APIs authenticate the caller and then trust the ID in the URL. Here is how I probe that gap and how I close it.',
    category: 'Security',
    readTime: '4 min',
    keywords: 'BOLA, IDOR, API security, authorization, OWASP API Security Top 10, access control',
    tags: ['appsec', 'api-security', 'owasp'],
    image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&q=80',
    body: [
      {
        type: 'paragraph',
        text: 'The most common authorization bug I find is also the least exotic. An endpoint checks that you are logged in, reads an object ID out of the path, and hands back the record. Nobody ever asks whether <em>this</em> caller is allowed to see <em>that</em> object. Authentication answers who you are. It says nothing about what you own.',
      },
      {
        type: 'paragraph',
        text: 'So a request to GET /api/invoices/4021 succeeds for any valid session, not just the session belonging to the account that owns invoice 4021. The endpoint is not missing a check. It is missing the <strong>second</strong> check, and the first one passing is exactly what makes the gap invisible.',
      },
      { type: 'heading', text: 'Why it hides' },
      {
        type: 'paragraph',
        text: 'It hides because the application never exercises it. The frontend only ever renders links to objects the user already owns, so in normal use every ID that reaches the server is a legitimate one. Test suites inherit the same blind spot: they assert that the owner can read their own invoice, which passes whether or not the ownership check exists. In review the handler reads as correct, because the authorization it is missing is not visible in the diff. There is no wrong line to point at, only an absent one.',
      },
      { type: 'heading', text: 'The method' },
      {
        type: 'orderedlist',
        items: [
          'I enumerate every route that accepts an object identifier, from the spec if there is one and from the router table if there is not. Anything taking an ID in a path, a query string, a body field or a header is in scope.',
          'I create two accounts in the same tenant and one in a different tenant, then capture a legitimate request from each. Two accounts at the same privilege level is the case teams forget, because their fixtures usually only cover admin versus user.',
          'I replay account A\'s request using account B\'s session, changing nothing but the credential. A 200 response is the finding. A 404 is worth reading closely, since some frameworks return one for both "does not exist" and "not yours".',
          'I repeat that replay across every verb the route accepts, not just the read. Ownership checks are frequently applied on GET and forgotten on PATCH and DELETE, where the impact is far worse.',
          'I test the object graph, not just the object. Nested and expanded resources, batch endpoints, export jobs and webhook payloads all reach the same records through code paths that rarely inherit the parent route\'s check.',
          'On the defensive side I push the check down to the data access layer, so ownership is a property of the query rather than something each handler remembers to do.',
        ],
      },
      { type: 'heading', text: 'The nuance that matters' },
      {
        type: 'callout',
        text: 'A UUID is not an authorization control. Teams migrate from sequential IDs to UUIDs and treat the problem as solved, but that only raises the cost of guessing an identifier. Identifiers leak constantly through shared links, logs, exports, referrer headers and support tickets. Once an attacker holds a valid ID, an unguessable one behaves exactly like a sequential one.',
      },
      {
        type: 'paragraph',
        text: 'Here is the shape I want, with the ownership predicate bound to the query rather than left to the handler:',
      },
      {
        type: 'code',
        lang: 'js',
        code: 'async function getInvoice(id, actor) {\n  // Scope is part of the query, not an afterthought in the handler.\n  const invoice = await db.invoice.findFirst({\n    where: { id, accountId: actor.accountId },\n  })\n  if (!invoice) throw new NotFoundError()\n  return invoice\n}',
      },
      { type: 'heading', text: 'Why it stays a problem' },
      {
        type: 'paragraph',
        text: 'It survives because it scales with surface area rather than with difficulty. Every new endpoint is a fresh opportunity to forget, and no single mistake is ever hard to fix. Scanners struggle with it too, since deciding whether a 200 was authorized requires knowing who should own the record, which is application knowledge a tool does not have. So it stays a manual review problem on a codebase that grows every sprint, and it is a full-stack concern rather than a backend one — the frontend that only ever links to your own records is what convinces everyone the check is already there!',
      },
      {
        type: 'paragraph',
        text: 'Broken object level authorization is a missing second check, not a broken first one. I test it by replaying real requests across accounts and verbs, and I prevent it by making ownership part of the query instead of a step each handler has to remember.',
      },
    ],
  },
}

async function main() {
  mkdirSync(POSTS_DIR, { recursive: true })
  mkdirSync(path.dirname(POSTS_JSON), { recursive: true })

  const posts = loadExistingPosts()
  console.log(`[Blog] ${posts.length} existing posts`)

  const post = await generateSecurityPost(posts)

  // Verify featured image
  post.image = await safeImageUrl(post.image)

  // Write HTML post file
  const htmlPath = path.join(POSTS_DIR, `${post.slug}.html`)
  writeFileSync(htmlPath, buildPostHtml(post), 'utf8')
  console.log(`[Blog] Wrote ${htmlPath}`)

  // Update listing JSON (newest first)
  posts.unshift(toMeta(post))
  savePosts(posts)

  // Update sitemap
  updateSitemap(post.slug, post.dateISO)

  console.log(`[Blog] Done! → https://www.anthonysdigital.net/blog/posts/${post.slug}.html`)
}

main()
