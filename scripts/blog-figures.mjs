/**
 * In-body figures for blog posts.
 *
 * Diagrams are rendered here from a small structured spec (sequence, flow, or
 * filter). The model never writes SVG: it emits labels, and this file lays
 * them out in the site's house style (dark background, mint #4bffa5 accents).
 * The same spec always renders to the same bytes, so a sha256 of the file is
 * a stable identity for the duplicate check.
 *
 * Photos come from INLINE_PHOTO_POOL, a separate set of verified Unsplash
 * photos (Unsplash License, no faces, no logos). None of them is in the cover
 * pool.
 */

import { createHash } from 'crypto'

export const FIGURE_WIDTH = 1000

const C = {
  bg: '#14111f',
  panel: '#1d1a2b',
  stroke: '#3b3652',
  mint: '#4bffa5',
  mintFill: 'rgba(75,255,165,0.12)',
  coral: '#ff7a90',
  coralFill: 'rgba(255,122,144,0.12)',
  text: '#ffffff',
  soft: '#d9d6e6',
  muted: '#9a96b0',
}
const FONT = "Roboto, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace"

// Verified Unsplash photos for in-body use (HTTP 200, "Free to use under the
// Unsplash License" on each photo page). Cropped to 1200x800 on download.
// The script writes the alt text and caption, because the model never sees
// the photo.
export const INLINE_PHOTO_POOL = [
  { id: '1603057190473-f3b6422b6320', topics: ['ai', 'security'], alt: 'A worn rubber stamp lying on a dark green desk mat', caption: 'A stamp means something only when it lands on one specific document.' },
  { id: '1774891937673-9186e930a18e', topics: ['ai', 'security'], alt: 'White envelopes closed with red wax seals on a wooden table', caption: 'Sealed before it leaves: the check happens before anything is sent.' },
  { id: '1761936648980-31bc4180bf19', topics: ['ai', 'security'], alt: 'An open padlock hanging from a latch on a teal painted wall', caption: 'An open lock is not a control. Closed has to be the default.' },
  { id: '1774128542316-c74faefb14dd', topics: ['ai', 'engineering'], alt: 'An old industrial control panel with gauges, dials, and labeled buttons', caption: 'Every switch on the panel has a label and a job. Agent tools should too.' },
  { id: '1629477841535-5c009b5004d8', topics: ['ai', 'security'], alt: 'A red illuminated CLOSED sign hanging in a dim corridor', caption: 'Closed is a valid answer for a request the application did not expect.' },
  { id: '1640682841767-cdfce3aea6e0', topics: ['engineering', 'backend'], alt: 'A drawer packed with wrenches, sockets, and screwdrivers', caption: 'A full drawer of tools is not the set one task needs.' },
]

export const FIGURE_CSS = `    .post-figure {
      margin: 32px 0;
    }
    .post-figure a { display: block; }
    .post-figure img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: ${C.bg};
    }
    .post-figure figcaption {
      margin-top: 10px;
      font-size: 0.85rem;
      line-height: 1.6;
      color: rgba(255,255,255,0.62);
      text-align: center;
    }`

const LIMITS = {
  title: 60,
  actor: 18,
  stepLabel: 46,
  note: 40,
  stageLabel: 26,
  stageDetail: 44,
  item: 28,
  boxLabel: 26,
  alt: 400,
  caption: 200,
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function esc(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Greedy word wrap by character budget. Returns at most maxLines lines.
function wrap(text, maxChars, maxLines = 2) {
  const words = clean(text).split(' ').filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= maxChars || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    // Validation keeps labels short enough that this is rare. Cut by
    // characters so a single long word never collapses to an ellipsis.
    const kept = lines.slice(0, maxLines)
    const rest = lines.slice(maxLines - 1).join(' ')
    kept[maxLines - 1] = rest.length > maxChars ? `${rest.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : rest
    return kept
  }
  return lines
}

function textLines(lines, x, y, { size = 22, weight = 400, fill = C.soft, anchor = 'middle', family = FONT, lineHeight = 1.3 } = {}) {
  const first = y - ((lines.length - 1) * size * lineHeight) / 2
  return lines.map((line, index) =>
    `<text x="${x}" y="${(first + index * size * lineHeight).toFixed(1)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle">${esc(line)}</text>`,
  ).join('')
}

function arrowDefs() {
  return `<defs><marker id="am" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.mint}"/></marker><marker id="ac" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.coral}"/></marker></defs>`
}

function frame(width, height, title, desc, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`
    + `<title>${esc(title)}</title><desc>${esc(desc)}</desc>${arrowDefs()}`
    + `<rect width="${width}" height="${height}" rx="24" fill="${C.bg}"/>`
    + `<rect x="48" y="40" width="40" height="5" rx="2.5" fill="${C.mint}"/>`
    + `<text x="48" y="78" font-family="${FONT}" font-size="28" font-weight="700" fill="${C.text}">${esc(clean(title))}</text>`
    + inner
    + `</svg>\n`
}

function renderSequence(spec) {
  const W = FIGURE_WIDTH
  const actors = spec.actors.map(clean)
  const n = actors.length
  const colW = (W - 96) / n
  const xs = actors.map((_, i) => 48 + colW * i + colW / 2)
  const boxW = Math.min(210, colW - 20)
  const top = 110
  const stepGap = 74
  const firstStep = top + 56 + 56
  const height = firstStep + spec.steps.length * stepGap + 24
  let inner = ''
  actors.forEach((actor, i) => {
    inner += `<line x1="${xs[i]}" y1="${top + 56}" x2="${xs[i]}" y2="${height - 30}" stroke="${C.stroke}" stroke-width="2" stroke-dasharray="6 8"/>`
    inner += `<rect x="${xs[i] - boxW / 2}" y="${top}" width="${boxW}" height="56" rx="12" fill="${C.panel}" stroke="${C.stroke}" stroke-width="2"/>`
    inner += textLines(wrap(actor, 16, 1), xs[i], top + 28, { size: 22, weight: 600, fill: C.text })
  })
  spec.steps.forEach((step, k) => {
    const y = firstStep + k * stepGap
    if (step.note !== undefined) {
      const x = xs[actors.indexOf(clean(step.actor))]
      const w = Math.min(W - 96, Math.max(220, clean(step.note).length * 10.5 + 48))
      const bx = Math.min(Math.max(48, x - w / 2), W - 48 - w)
      inner += `<rect x="${bx.toFixed(1)}" y="${y - 24}" width="${w.toFixed(1)}" height="48" rx="10" fill="${step.refused ? C.coralFill : C.mintFill}" stroke="${step.refused ? C.coral : C.mint}" stroke-width="2"/>`
      const nx = Math.min(Math.max(48 + w / 2, x), W - 48 - w / 2)
      inner += textLines(wrap(step.note, LIMITS.note, 1), nx, y, { size: 19, fill: C.text })
      return
    }
    const x1 = xs[actors.indexOf(clean(step.from))]
    const x2 = xs[actors.indexOf(clean(step.to))]
    const dir = x2 > x1 ? 1 : -1
    const color = step.refused ? C.coral : C.mint
    inner += `<line x1="${x1 + dir * 6}" y1="${y + 12}" x2="${x2 - dir * 8}" y2="${y + 12}" stroke="${color}" stroke-width="3"${step.refused ? ' stroke-dasharray="10 8"' : ''} marker-end="url(#${step.refused ? 'ac' : 'am'})"/>`
    const span = Math.abs(x2 - x1)
    const lines = wrap(step.label, Math.max(30, Math.floor(span / 10)), 2)
    inner += textLines(lines, (x1 + x2) / 2, y - (lines.length > 1 ? 18 : 10), { size: 19, fill: C.soft })
  })
  return { width: W, height, inner }
}

function renderFlow(spec) {
  const W = FIGURE_WIDTH
  const stages = spec.stages
  const n = stages.length
  const gap = 40
  const boxW = (W - 96 - gap * (n - 1)) / n
  const top = 128
  const boxH = 170
  const gate = Number.isInteger(spec.gate) ? spec.gate : -1
  const hasRefuse = gate >= 0 && clean(spec.refuse)
  const height = top + boxH + (hasRefuse ? 150 : 0) + 48
  const chars = Math.max(9, Math.floor(boxW / 11.5))
  let inner = ''
  stages.forEach((stage, i) => {
    const x = 48 + i * (boxW + gap)
    const isGate = i === gate
    inner += `<rect x="${x.toFixed(1)}" y="${top}" width="${boxW.toFixed(1)}" height="${boxH}" rx="14" fill="${isGate ? C.mintFill : C.panel}" stroke="${isGate ? C.mint : C.stroke}" stroke-width="${isGate ? 3 : 2}"/>`
    if (isGate) inner += `<text x="${(x + 14).toFixed(1)}" y="${top - 12}" font-family="${FONT}" font-size="15" font-weight="700" letter-spacing="2" fill="${C.mint}">CHECK</text>`
    inner += textLines(wrap(stage.label, chars, 2), x + boxW / 2, top + 48, { size: 21, weight: 600, fill: C.text })
    if (clean(stage.detail)) inner += textLines(wrap(stage.detail, Math.floor(boxW / 9), 3), x + boxW / 2, top + 116, { size: 16, fill: C.muted })
    if (i < n - 1) inner += `<line x1="${(x + boxW + 4).toFixed(1)}" y1="${top + boxH / 2}" x2="${(x + boxW + gap - 6).toFixed(1)}" y2="${top + boxH / 2}" stroke="${C.mint}" stroke-width="3" marker-end="url(#am)"/>`
  })
  if (hasRefuse) {
    const gx = 48 + gate * (boxW + gap) + boxW / 2
    const rw = Math.min(W - 96, Math.max(300, clean(spec.refuse).length * 10.5 + 60))
    const rx = Math.min(Math.max(48, gx - rw / 2), W - 48 - rw)
    inner += `<line x1="${gx.toFixed(1)}" y1="${top + boxH + 4}" x2="${gx.toFixed(1)}" y2="${top + boxH + 66}" stroke="${C.coral}" stroke-width="3" stroke-dasharray="10 8" marker-end="url(#ac)"/>`
    inner += `<rect x="${rx.toFixed(1)}" y="${top + boxH + 72}" width="${rw}" height="56" rx="12" fill="${C.coralFill}" stroke="${C.coral}" stroke-width="2"/>`
    inner += textLines(wrap(spec.refuse, LIMITS.note, 1), rx + rw / 2, top + boxH + 100, { size: 19, fill: C.text })
  }
  return { width: W, height, inner }
}

function renderFilter(spec) {
  const W = FIGURE_WIDTH
  const items = spec.items
  const rowH = 64
  const top = 150
  const height = top + items.length * rowH + 40
  const leftX = 48
  const leftW = 300
  const gateX = 430
  const gateW = 170
  const targetX = W - 48 - 240
  const targetW = 240
  let inner = ''
  inner += `<text x="${leftX}" y="${top - 26}" font-family="${FONT}" font-size="17" font-weight="700" letter-spacing="1.5" fill="${C.muted}">${esc(clean(spec.source).toUpperCase())}</text>`
  inner += `<rect x="${gateX}" y="${top - 6}" width="${gateW}" height="${items.length * rowH - 4}" rx="16" fill="${C.mintFill}" stroke="${C.mint}" stroke-width="3"/>`
  inner += textLines(wrap(spec.gate, 13, 3), gateX + gateW / 2, top - 6 + (items.length * rowH - 4) / 2, { size: 21, weight: 700, fill: C.text })
  const allowed = items.map((item, i) => ({ item, i })).filter(({ item }) => item.allowed)
  const tTop = top - 6
  const tH = items.length * rowH - 4
  inner += `<rect x="${targetX}" y="${tTop}" width="${targetW}" height="${tH}" rx="16" fill="${C.panel}" stroke="${C.stroke}" stroke-width="2"/>`
  inner += textLines(wrap(spec.target, 16, 3), targetX + targetW / 2, tTop + tH / 2, { size: 21, weight: 600, fill: C.text })
  items.forEach((item, i) => {
    const y = top + i * rowH + rowH / 2 - 4
    const ok = Boolean(item.allowed)
    inner += `<rect x="${leftX}" y="${y - 22}" width="${leftW}" height="44" rx="22" fill="${C.panel}" stroke="${ok ? C.mint : C.stroke}" stroke-width="2"/>`
    inner += textLines(wrap(item.label, 26, 1), leftX + 20, y, { size: 18, fill: ok ? C.text : C.muted, anchor: 'start', family: MONO })
    inner += `<line x1="${leftX + leftW + 6}" y1="${y}" x2="${gateX - 8}" y2="${y}" stroke="${ok ? C.mint : C.coral}" stroke-width="3"${ok ? '' : ' stroke-dasharray="10 8"'} marker-end="url(#${ok ? 'am' : 'ac'})"/>`
    if (ok) {
      inner += `<line x1="${gateX + gateW + 6}" y1="${y}" x2="${targetX - 8}" y2="${y}" stroke="${C.mint}" stroke-width="3" marker-end="url(#am)"/>`
    } else {
      const cx = gateX + gateW + 34
      inner += `<path d="M${cx - 9} ${y - 9}L${cx + 9} ${y + 9}M${cx + 9} ${y - 9}L${cx - 9} ${y + 9}" stroke="${C.coral}" stroke-width="3.5" stroke-linecap="round"/>`
      inner += `<text x="${cx + 20}" y="${y}" font-family="${FONT}" font-size="17" fill="${C.coral}" dominant-baseline="middle">refused</text>`
    }
  })
  if (!allowed.length) inner += ''
  return { width: W, height, inner }
}

// Returns a list of problems. An empty list means the spec can be rendered.
export function figureSpecProblems(spec, index = 0) {
  const p = []
  const label = `Figure ${index + 1}`
  const str = (value, max, name) => {
    const v = clean(value)
    if (!v) p.push(`${label}: ${name} is missing.`)
    else if (v.length > max) p.push(`${label}: ${name} "${v}" is longer than ${max} characters.`)
    else if (/https?:\/\/|<|>/.test(v)) p.push(`${label}: ${name} must be plain text with no URL or markup.`)
  }
  if (!spec || typeof spec !== 'object') return [`${label} is not an object.`]
  // A photo's alt text and caption come from INLINE_PHOTO_POOL, not the model.
  if (spec.kind === 'photo') return p
  str(spec.title, LIMITS.title, 'title')
  str(spec.alt, LIMITS.alt, 'alt')
  str(spec.caption, LIMITS.caption, 'caption')
  if (spec.kind === 'sequence') {
    const actors = Array.isArray(spec.actors) ? spec.actors.map(clean) : []
    if (actors.length < 2 || actors.length > 5) p.push(`${label}: a sequence needs 2 to 5 actors.`)
    if (new Set(actors).size !== actors.length) p.push(`${label}: actor names must be unique.`)
    actors.forEach(actor => str(actor, LIMITS.actor, 'actor'))
    const steps = Array.isArray(spec.steps) ? spec.steps : []
    if (steps.length < 3 || steps.length > 8) p.push(`${label}: a sequence needs 3 to 8 steps.`)
    for (const step of steps) {
      if (step && step.note !== undefined) {
        str(step.note, LIMITS.note, 'note')
        if (!actors.includes(clean(step.actor))) p.push(`${label}: note actor "${clean(step.actor)}" is not in actors.`)
      } else if (step) {
        str(step.label, LIMITS.stepLabel, 'step label')
        if (!actors.includes(clean(step.from)) || !actors.includes(clean(step.to))) p.push(`${label}: step "${clean(step.label)}" uses an actor that is not listed.`)
        else if (clean(step.from) === clean(step.to)) p.push(`${label}: use a note, not a step, when from and to are the same actor.`)
      } else p.push(`${label}: empty step.`)
    }
  } else if (spec.kind === 'flow') {
    const stages = Array.isArray(spec.stages) ? spec.stages : []
    if (stages.length < 3 || stages.length > 5) p.push(`${label}: a flow needs 3 to 5 stages.`)
    for (const stage of stages) {
      str(stage?.label, LIMITS.stageLabel, 'stage label')
      if (clean(stage?.detail)) str(stage.detail, LIMITS.stageDetail, 'stage detail')
    }
    if (spec.gate !== undefined && !(Number.isInteger(spec.gate) && spec.gate >= 0 && spec.gate < stages.length)) p.push(`${label}: gate must be the index of a stage.`)
    if (clean(spec.refuse)) str(spec.refuse, LIMITS.note, 'refuse')
  } else if (spec.kind === 'filter') {
    str(spec.source, LIMITS.boxLabel, 'source')
    str(spec.gate, LIMITS.boxLabel, 'gate')
    str(spec.target, LIMITS.boxLabel, 'target')
    const items = Array.isArray(spec.items) ? spec.items : []
    if (items.length < 3 || items.length > 6) p.push(`${label}: a filter needs 3 to 6 items.`)
    items.forEach(item => str(item?.label, LIMITS.item, 'item label'))
    if (!items.some(item => item?.allowed) || !items.some(item => !item?.allowed)) p.push(`${label}: a filter needs at least one allowed and one refused item.`)
  } else {
    p.push(`${label}: kind must be "sequence", "flow", "filter", or "photo".`)
  }
  return p
}

export function renderDiagramSvg(spec) {
  const problems = figureSpecProblems(spec)
  if (problems.length) throw new Error(problems.join(' '))
  const body = spec.kind === 'sequence' ? renderSequence(spec)
    : spec.kind === 'flow' ? renderFlow(spec)
      : renderFilter(spec)
  const svg = frame(body.width, body.height, spec.title, clean(spec.alt), body.inner)
  return { svg, width: body.width, height: body.height }
}

export function figureHtml(figure) {
  const dims = figure.width && figure.height ? ` width="${Number(figure.width)}" height="${Number(figure.height)}"` : ''
  return `<figure class="post-figure"><a href="${esc(figure.src)}"><img src="${esc(figure.src)}" alt="${esc(figure.alt)}"${dims} loading="lazy" decoding="async"></a><figcaption>${esc(figure.caption)}</figcaption></figure>`
}
