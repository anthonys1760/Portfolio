# Portfolio Project Notes

## Deployment
- **Site deploys from the `gh-pages` branch**, NOT `master`
- GitHub Pages serves from `gh-pages` to www.anthonysdigital.net
- Always push changes to `gh-pages` for them to go live

## Background
- **Homepage (`index.html`)**: uses an animated CSS radial-gradient mesh background (`.hero-gradient-bg`) — no canvas, no particle effect
- **Inner pages (`about.html`, `works_creative.html`, `contacts_image.html`)**: use the canvas particle wave animation
- The particle canvas must have `z-index: 1` (below `.centrize` content at `z-index: 2`)
- Homepage hero uses a custom vanilla-JS chat-stream simulator (token-chunked, jittered delays, punctuation pauses) — no `typewriter-effect` library
- The homepage has been trimmed of Hotjar, Mouseflow, Google Optimize, Chatbase, ManyChat, and orphaned debug scripts. Keep GTM + GA only.
