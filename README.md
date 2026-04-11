# Anthony Smith — Portfolio

**Senior Full Stack Engineer & Solutions Architect**
Lead Systems Engineer at SpartanNash · 6+ years shipping scalable platforms, AI integrations, and React Native apps

**Live site:** [anthonysdigital.net](https://www.anthonysdigital.net)

---

## About

Personal portfolio and technical blog for Anthony Smith. Built as a static site deployed to GitHub Pages, featuring an AI-powered chat hero, animated gradient backgrounds, architecture diagrams for each featured project, and a fully automated weekly blog powered by Claude Sonnet via OpenRouter.

---

## Featured Projects

| Project | Stack | Description |
|---|---|---|
| **NutriLogix AI** | React Native · GPT-4o Vision · Supabase · HealthKit | AI food logging — photo or barcode scan to full macro breakdown |
| **AstroAI X** | React Native · OpenAI · Anthropic · Gemini · Supabase | Multi-provider AI chat app with streaming abstraction layer |
| **VoiceLift** | React Native · Whisper · GPT-4o · Supabase · RevenueCat | Voice-first workout logger — say your set, it's logged instantly |
| **SkyNet VPN** | Node.js · Full-stack | Custom VPN platform |
| **Skybot Automation** | Node.js · Full-stack | Business process automation bot |

---

## Tech Stack

**Languages:** JavaScript / TypeScript · Node.js · HTML · CSS

**Mobile:** React Native · Expo SDK

**AI / LLM:** OpenAI (GPT-4o, Whisper, Structured Outputs) · Anthropic Claude · Google Gemini · OpenRouter

**Backend / Data:** Supabase (Postgres + RLS + Auth) · REST APIs · RevenueCat

**DevOps:** GitHub Actions · GitHub Pages · Google Tag Manager

---

## Repo Structure

```
gh-pages/          ← live site (GitHub Pages serves from this branch)
├── index.html     ← homepage with streaming chat hero
├── about.html
├── works_creative.html
├── contacts_image.html
├── blog/          ← technical blog
│   ├── index.html
│   ├── data/posts.json
│   └── posts/     ← auto-generated HTML post files
├── css/
│   └── hero-theme.css  ← animated gradient mesh + glassmorphic overrides
├── js/
├── images/
│   └── diagrams/  ← SVG architecture diagrams (NutriLogix, AstroAI, VoiceLift)
└── scripts/
    └── generate-blog-post.mjs

master/
└── .github/workflows/weekly-blog.yml  ← automated blog post workflow
```

---

## Automated Blog

A GitHub Actions workflow runs every **Monday at 9:00 AM UTC** to generate a new technical blog post using Claude Sonnet via OpenRouter. Each run:

1. Picks a topic not recently covered from a curated list (React Native, Node.js, AI/LLM, security, architecture, etc.)
2. Generates a full structured post with headings, code examples, and callouts
3. Writes the post HTML to `blog/posts/[slug].html`
4. Updates `blog/data/posts.json` with post metadata
5. Adds the post URL to `sitemap.xml`
6. Commits and pushes to `gh-pages`

**Required secret:** `OPENROUTER_API_KEY` (set in repo Settings → Secrets → Actions)

To trigger manually: Actions tab → Weekly Blog Post → Run workflow

---

## Deployment

The site deploys from the `gh-pages` branch via GitHub Pages to the custom domain `anthonysdigital.net`. All changes to the live site should be pushed to `gh-pages`.

---

## Contact

- **Email:** anthony.smith1760@gmail.com
- **LinkedIn:** [anthony-smith-b1085389](https://www.linkedin.com/in/anthony-smith-b1085389)
- **GitHub:** [anthonys1760](https://github.com/anthonys1760)
- **Codementor:** [@anthonys1760](https://www.codementor.io/@anthonys1760)
