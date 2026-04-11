#!/usr/bin/env node
/**
 * generate-blog-post.mjs
 *
 * Generates a new technical blog post via OpenRouter (Claude) and writes:
 *   - /blog/posts/[slug].html  — full standalone post page
 *   - /blog/data/posts.json    — prepended with new post metadata
 *
 * Required env var:
 *   OPENROUTER_API_KEY
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const POSTS_JSON = path.join(ROOT, 'blog/data/posts.json')
const POSTS_DIR = path.join(ROOT, 'blog/posts')

// ── Config ───────────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
if (!OPENROUTER_API_KEY) { console.error('[Blog] Missing OPENROUTER_API_KEY'); process.exit(1) }

// Topics rotate across the full stack
const TOPICS = [
  'React Native mobile architecture',
  'Node.js backend patterns and performance',
  'AI/LLM integrations in production apps',
  'Application security and OWASP best practices',
  'Full-stack architecture decision records',
  'PostgreSQL and Supabase for production apps',
  'CI/CD and GitHub Actions automation',
  'TypeScript patterns for large codebases',
  'REST and GraphQL API design',
  'React performance optimization',
  'Mobile app state management',
  'Edge functions and serverless patterns',
  'Software engineering career and craft',
  'Code review and team engineering culture',
]

const CATEGORIES = [
  'Architecture', 'React Native', 'Node.js', 'AI & ML',
  'Security', 'DevOps', 'TypeScript', 'API Design',
  'Performance', 'Career',
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

// ── Pick a topic not recently covered ────────────────────────────────────────

function pickTopic(existingTitles) {
  // Prefer topics not already covered
  const usedTopics = TOPICS.filter(t =>
    existingTitles.some(title => title.toLowerCase().includes(t.split(' ')[0].toLowerCase()))
  )
  const available = TOPICS.filter(t => !usedTopics.includes(t))
  const pool = available.length ? available : TOPICS
  return pool[Math.floor(Math.random() * pool.length)]
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

async function generatePost(existingPosts) {
  const existingTitles = existingPosts.map(p => p.title)
  const topic = pickTopic(existingTitles)
  const dateISO = today()

  const prompt = `You are a senior full-stack engineer writing a technical blog for your personal portfolio at anthonysdigital.net.

Write a NEW technical blog post on the topic: **${topic}**

The post should be practical, opinionated, and reflect real-world engineering experience. Include code examples where relevant. Avoid fluff — write for engineers.

Do NOT overlap with these existing posts:
${existingTitles.length ? existingTitles.map(t => `- ${t}`).join('\n') : '(none yet)'}

For the featured image, provide a direct Unsplash CDN URL using a photo ID you are confident exists (format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=1200&q=80). Choose a photo relevant to tech/code/engineering.

Respond ONLY with valid JSON (no markdown fences, no extra text) matching this exact schema:
{
  "title": "Post title",
  "excerpt": "2-sentence excerpt for the blog card listing (max 200 chars, no HTML)",
  "category": "One of: Architecture | React Native | Node.js | AI & ML | Security | DevOps | TypeScript | API Design | Performance | Career",
  "readTime": "X min",
  "image": "https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=1200&q=80",
  "body": [
    { "type": "paragraph", "text": "..." },
    { "type": "heading", "text": "..." },
    { "type": "code", "lang": "js", "code": "..." },
    { "type": "callout", "text": "..." },
    { "type": "list", "items": ["...", "..."] }
  ]
}

Body rules:
- 8-14 body blocks total
- Start with a paragraph hook (no heading first)
- Include 3-5 headings that structure the post
- Include 1-3 code blocks with real, runnable code snippets (use backtick-free plain strings)
- Include 1-2 callout blocks with key insights or warnings (may use <strong> and <em> inline)
- Include 1 list block
- paragraph and callout text may use <strong>, <em>, and <code> inline tags only
- code blocks: escape any backslashes in the JSON string`

  console.log(`[Blog] Generating post on topic: "${topic}"`)

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

  let post
  try {
    post = JSON.parse(repairJson(jsonStr))
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}\nRaw: ${raw.slice(0, 500)}`)
  }

  post.date = formatDate(dateISO)
  post.dateISO = dateISO
  post.slug = slugify(post.title)

  // Ensure slug uniqueness
  const existingSlugs = existingPosts.map(p => p.slug)
  if (existingSlugs.includes(post.slug)) {
    post.slug = `${post.slug}-${dateISO}`
  }

  console.log(`[Blog] Generated: "${post.title}" → ${post.slug}`)
  return post
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
    .post-body ul {
      color: rgba(255,255,255,0.7);
      line-height: 1.8;
      padding-left: 20px;
      margin-bottom: 18px;
    }
    .post-body li { margin-bottom: 6px; }
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

function savePost(post, existingPosts) {
  // Strip body from listing JSON — only need metadata for the card
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
  const updated = [meta, ...existingPosts]
  writeFileSync(POSTS_JSON, JSON.stringify(updated, null, 2) + '\n', 'utf8')
  console.log(`[Blog] Updated posts.json (${updated.length} total)`)
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

async function main() {
  try {
    mkdirSync(POSTS_DIR, { recursive: true })
    mkdirSync(path.dirname(POSTS_JSON), { recursive: true })

    const existingPosts = loadExistingPosts()
    console.log(`[Blog] ${existingPosts.length} existing posts`)

    const post = await generatePost(existingPosts)

    // Verify featured image
    post.image = await safeImageUrl(post.image)

    // Write HTML post file
    const htmlPath = path.join(POSTS_DIR, `${post.slug}.html`)
    writeFileSync(htmlPath, buildPostHtml(post), 'utf8')
    console.log(`[Blog] Wrote ${htmlPath}`)

    // Update listing JSON
    savePost(post, existingPosts)

    // Update sitemap
    updateSitemap(post.slug, post.dateISO)

    console.log(`[Blog] Done! → https://www.anthonysdigital.net/blog/posts/${post.slug}.html`)
  } catch (err) {
    console.error('[Blog] ERROR:', err.message)
    process.exit(1)
  }
}

main()
