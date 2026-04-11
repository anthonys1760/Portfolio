# Portfolio Project Notes

## Deployment
- **Site deploys from the `gh-pages` branch**, NOT `master`
- GitHub Pages serves from `gh-pages` to www.anthonysdigital.net
- Always push changes to `gh-pages` for them to go live

## Background & Theme
- All four live pages share `css/hero-theme.css` (animated radial-gradient mesh + chat UI + glassmorphic card overrides scoped to `body.hero-themed`).
- **Homepage (`index.html`)**: streamed chat hero with custom vanilla-JS LLM-style streamer (token-chunked, jittered delays, punctuation pauses). No `typewriter-effect` library.
- **Inner pages (`about.html`, `portfolio.html`, `contact.html`)**: same animated gradient background with static chat-style intros. About has a chat-bubble bio, Portfolio is a clean title hero, Contact has a chat intro above a re-skinned form.
- Particle canvas hero has been removed from all inner pages.
- All four pages have been trimmed of Hotjar, Mouseflow, Google Optimize, Chatbase/CustomGPT, ManyChat, and orphan debug scripts. Keep GTM + GA only.
- Accent color is `#4bffa5`.
