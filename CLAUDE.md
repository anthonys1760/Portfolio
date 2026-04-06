# Portfolio Project Notes

## Deployment
- **Site deploys from the `gh-pages` branch**, NOT `master`
- GitHub Pages serves from `gh-pages` to www.anthonysdigital.net
- Always push changes to `gh-pages` for them to go live

## Background
- The homepage uses a canvas particle wave animation (no YouTube video)
- The particle canvas must have `z-index: 3` to render above `.video-bg-mask` (z-index: 2) and `.video-bg-texture` (z-index: 2)
- The typewriter effect uses the `typewriter-effect` library (loaded from unpkg CDN), NOT the template's built-in `typed.js`
- The typewriter container uses class `typewriter-container` to avoid conflicts with the template's `scripts.js` which targets `.typing-subtitle`
