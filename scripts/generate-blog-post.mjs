#!/usr/bin/env node
/**
 * generate-blog-post.mjs
 *
 * Drafts one weekly post for https://anthonysdigital.net by calling xAI's
 * OpenAI-compatible API. The GitHub Actions workflow opens a pull request
 * against gh-pages. This script does not push.
 *
 * Required env (unless --dry-run):
 *   XAI_API_KEY
 *
 * Optional env:
 *   BLOG_MODEL   model id, default grok-4.7
 *   DRY_RUN=1    same as --dry-run
 *
 * A missing key, an unparseable model response, an exhausted topic list,
 * or an exhausted image pool fails the process. When GITHUB_STEP_SUMMARY
 * is set, the failure is also written there for the Actions job summary.
 *
 * Featured images come from IMAGE_POOL. The script assigns a photo that is
 * not already used in posts.json or in an open draft pull request into
 * gh-pages, downloads it, and saves a WebP at most
 * 1600px wide under blog/images/ with width and height. It does not reuse a
 * photo when the pool is empty. New posts are also written into the static
 * list in blog/index.html.
 *
 * Topics are picked in TOPICS order. AI agent security topics come first,
 * with a shipped-work case study inserted every fourth remaining slot.
 * `node scripts/preview-topics.mjs` prints the next picks without calling
 * the model or writing files. The page template appends a short hire-me
 * call to action that links to /contact.html#contact-form.
 */

import { execFile } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { FIGURE_CSS, INLINE_PHOTO_POOL, figureHtml, figureSpecProblems, renderDiagramSvg, sha256 } from './blog-figures.mjs'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const POSTS_JSON = path.join(ROOT, 'blog/data/posts.json')
const POSTS_DIR = path.join(ROOT, 'blog/posts')
const RUN_JSON = '/tmp/blog-run.json'
const REPO = process.env.GITHUB_REPOSITORY || 'anthonys1760/Portfolio'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1'
const MODEL = process.env.BLOG_MODEL || 'grok-4.7'
const XAI_URL = 'https://api.x.ai/v1/chat/completions'

class BlogError extends Error {
  constructor(message, summary) {
    super(message)
    this.name = 'BlogError'
    this.summary = summary || ''
  }
}

function requireApiKey() {
  if (DRY_RUN || process.env.XAI_API_KEY) return
  const message = '[Blog] Missing XAI_API_KEY. The run cannot call the xAI API.'
  console.error(message)
  writeSummary(`## Weekly blog draft failed\n\n${message}\n`)
  process.exit(1)
}

// ── Formats ──────────────────────────────────────────────────────────────────
// Pick the least recently used format that is not among the last four posts.
// Six formats and a window of four means at least two are always eligible.

const FORMATS = [
  {
    key: 'checklist',
    label: 'Checklist',
    instruction: 'Write a checklist a reviewer can run against one feature. After the opening, use a heading and a bullet list (type "list") of concrete checks. A second short list is fine when the checks split cleanly, for example client and server. Do not turn the post into one numbered procedure. Close with what "done" means for the list.',
  },
  {
    key: 'mistakes',
    label: 'Mistakes to avoid',
    instruction: 'Name three or four distinct mistakes in the defense. Each mistake gets its own heading and a short paragraph on the fix. The mistakes are ways the control gets skipped or pointed at the wrong boundary. They are not a guide to attacking a system, and they are not one ordered method.',
  },
  {
    key: 'explainer',
    label: 'Explainer',
    instruction: 'Explain the mechanism and the control. Invent headings that fit this topic. Do not use the section titles "Why it hides", "The method", "The nuance that matters", or "Why it stays a problem".',
  },
  {
    key: 'review',
    label: 'Defensive review',
    instruction: 'Walk one labeled illustration of a feature (a route, a job, a screen, or a tool call) from the outside in. At each boundary, name the defensive check. Do not describe how to attack the feature.',
  },
  {
    key: 'walkthrough',
    label: 'Tool or technique walkthrough',
    instruction: 'Walk through one defensive technique. Include one short code block that shows the control the application owns (a separate field, an allowlist, or a schema check). Narrate what that code refuses. Do not include a payload, a bypass, or attack tooling.',
  },
  {
    key: 'essay',
    label: 'Opinion / engineering-practice essay',
    instruction: 'Make an engineering-practice argument about this topic. Take a position, support it from the mechanism, and say what a design review should look for. No personal anecdote, no career history, and no statistics.',
  },
]

const OPENINGS = [
  {
    key: 'concrete-object',
    instruction: 'Open on one concrete object in the system (a route, a field, a token, a tool, a column, or a job). Name it in the first sentence. Do not open with a definition.',
  },
  {
    key: 'question',
    instruction: 'Open with one specific question a reviewer can ask of a single code path. The next sentence starts answering it. Do not open with a definition.',
  },
  {
    key: 'contrast',
    instruction: 'Open by separating two checks that get treated as the same thing. Name both in the first two sentences. Do not use the banned openers.',
  },
  {
    key: 'safe-shape',
    instruction: 'Open with the shape of the control that should exist, in one or two sentences, before any history or background.',
  },
  {
    key: 'labeled-illustration',
    instruction: 'Open with a labeled illustration of a request, record, or tool call. The first sentence must say it is an illustration. Then say what the defensive check is.',
  },
]

// Formats of posts that predate the format field. Taken from the title or
// from the post's own description of itself (explainer, checklist, defensive
// walkthrough). Used only so rotation does not repeat a recent shape.
const KNOWN_FORMATS = {
  'how-i-test-for-unsafe-consumption-of-third-party-apis': 'explainer',
  'how-i-test-for-shadow-and-zombie-apis': 'explainer',
  'how-i-test-for-security-misconfiguration': 'checklist',
  'how-i-test-for-server-side-request-forgery': 'review',
  'how-i-test-for-unrestricted-resource-consumption': 'checklist',
  'how-i-test-for-broken-function-level-authorization': 'explainer',
  'how-i-test-for-jwt-validation-flaws': 'mistakes',
  'how-i-test-for-mass-assignment-and-excessive-data-exposure': 'checklist',
  'how-i-test-for-broken-object-level-authorization': 'explainer',
}

// ── Topics ───────────────────────────────────────────────────────────────────
// One post per topic. A topic already present as a topicKey, a slug, a
// similar title, a retired redirect stub, or an open blog PR is skipped.
// Nothing in this list is revisited automatically. When every entry is
// blocked, the run fails and says so in the job summary.

const TOPICS = [
  {
    key: 'prompt-injection',
    area: 'agent-security',
    category: 'AI',
    short: 'Prompt Injection',
    label: 'Prompt injection against application features',
    summary: 'Untrusted text has to stay data. It must not become the instruction, and it must not choose which tools run.',
    illustration: 'one customer note the model is asked to summarize',
    phrases: ['prompt injection', 'indirect prompt injection'],
    citations: ['https://genai.owasp.org/llmrisk/llm01-prompt-injection/'],
    tags: ['llm', 'appsec'],
    keywords: 'prompt injection, untrusted text, tool allowlist, LLM security, OWASP LLM, agent tools',
    points: [
      'The instruction is a fixed template the application owns. The customer note, the retrieved paragraph, or the ticket body is a separate field. Joining them into one string makes the model treat the note as part of the instruction. Keep them apart, and mark which field is data.',
      'The tool list is built in the application from the feature that started the call. A summarizer is given the read it needs, not a refund, send, or delete tool named in the note. Arguments still have to match a schema the application owns: types, enums, and ids loaded for this caller.',
      'If the model output is missing a field, has the wrong type, or names a tool that was not offered, the application stops. It does not repair the result from the untrusted text. A write or an outbound message waits for a person even when the parse succeeds.',
    ],
    code: [
      'function buildModelCall({ instruction, untrustedText, allowedTools }) {',
      '  if (typeof instruction !== \'string\' || typeof untrustedText !== \'string\') {',
      '    throw new Error(\'instruction and untrusted text must be separate strings\')',
      '  }',
      '  // Tools come from the feature, not from the untrusted text.',
      '  return { instruction, data: untrustedText, tools: allowedTools.slice() }',
      '}',
    ].join('\n'),
  },
  {
    key: 'agent-tool-scoping',
    area: 'agent-security',
    category: 'AI',
    short: 'Agent Tool Scope',
    label: 'Scoping the tools an agent is allowed to call',
    summary: 'The application decides which tools exist for a call, which arguments they accept, and which of those tools can write. The model does not widen that list.',
    illustration: 'one order-status assistant that can read an order and nothing else',
    phrases: ['tool scoping', 'tool scope', 'excessive agency'],
    citations: ['https://genai.owasp.org/llmrisk/llm062025-excessive-agency/'],
    tags: ['llm', 'appsec'],
    keywords: 'tool scoping, excessive agency, least privilege, LLM tools, allowlist, agent security',
  },
  {
    key: 'human-approval-gates',
    area: 'agent-security',
    category: 'AI',
    short: 'Human Approval Gates',
    label: 'Requiring a person before an agent writes or sends',
    summary: 'A state-changing tool call waits for a person. The model can propose the action. It cannot confirm it.',
    illustration: 'one proposed refund that is queued for a person to confirm',
    phrases: ['human approval', 'confirmation gate', 'human in the loop'],
    citations: ['https://genai.owasp.org/llmrisk/llm062025-excessive-agency/'],
    tags: ['llm', 'appsec'],
    keywords: 'human approval, tool confirmation, excessive agency, agent security, write actions',
  },
  // ── AI agent security focus, with occasional shipped-work case studies ──
  // Agent security posts come first. A case-study topic is inserted after
  // every three remaining agent-security topics (every fourth slot). Keep
  // this interleave if you add more agent topics. Every citation was checked
  // to load (HTTP 200) and to cover the topic.
  {
    key: 'tool-result-injection',
    area: 'agent-security',
    category: 'AI',
    short: 'Untrusted Tool Results',
    label: 'Treating tool results and retrieved documents as data',
    summary: 'A web page, a search hit, an email body, or a file an agent reads is data from whoever wrote it. It does not get to add instructions, pick the next tool, or widen what the agent may do.',
    illustration: 'one support agent that reads a customer email while a send-reply tool is available',
    phrases: ['tool result', 'retrieved content', 'indirect injection', 'retrieval augmented'],
    citations: [
      'https://genai.owasp.org/llmrisk/llm01-prompt-injection/',
      'https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html',
      'https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/',
    ],
    tags: ['llm', 'agents', 'appsec'],
    keywords: 'indirect prompt injection, tool results, retrieved content, RAG security, agent security, untrusted data',
    image: '1569784210445-990e7e44ccfe',
  },
  {
    key: 'agent-credential-handling',
    area: 'agent-security',
    category: 'AI',
    short: 'Agent Credentials',
    label: 'Keeping credentials out of the model context',
    summary: 'An API key or OAuth token belongs to the tool runtime, not to the prompt. The model asks for an action by name, and the server attaches the credential for the signed-in caller after the call is approved.',
    illustration: 'one calendar tool that needs the signed-in user\'s OAuth token to create an event',
    phrases: ['agent credential', 'credential handling', 'secrets in the prompt', 'model context'],
    citations: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html',
      'https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/',
      'https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/',
    ],
    tags: ['llm', 'agents', 'secrets'],
    keywords: 'agent credentials, secrets management, API keys, OAuth tokens, system prompt leakage, agent security',
    image: '1550527882-b71dea5f8089',
  },
  {
    key: 'mcp-server-trust',
    area: 'agent-security',
    category: 'AI',
    short: 'MCP Server Trust',
    label: 'Treating MCP servers and connectors as outside code',
    summary: 'An MCP server or connector is code and data from someone else. Pin what you install, scope what each server can reach, and never pass a user token through to a server it was not issued for.',
    illustration: 'one assistant with a third-party MCP server added for project management',
    phrases: ['mcp server', 'model context protocol', 'connector security', 'token passthrough'],
    citations: [
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices',
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization',
    ],
    tags: ['llm', 'agents', 'mcp'],
    keywords: 'MCP security, Model Context Protocol, connectors, token passthrough, scope minimization, agent security',
    image: '1771065999830-8b6762df3354',
  },
  {
    key: 'castlog-offline-voice-logging',
    area: 'case-study',
    category: 'Engineering',
    short: 'CastLog Voice Logging',
    label: 'Building CastLog voice logging that works offline',
    summary: 'CastLog is a voice-first fishing journal that can log a catch by voice or in 3 taps, including when there is no signal. Voice captures save locally and sync when the phone is back in range.',
    illustration: 'one voice capture saved on the phone at a lake with no cell signal, then synced later',
    phrases: ['castlog voice', 'offline voice logging', 'voice-first fishing journal'],
    citations: [
      'https://castlogapp.com/',
      'https://castlogapp.com/privacy',
      'https://anthonysdigital.net/portfolio.html#castlog',
    ],
    tags: ['mobile', 'castlog', 'offline'],
    keywords: 'CastLog, voice logging, offline-first, React Native, fishing journal, shipped app',
    facts: [
      'Anthony built CastLog as a solo founder and engineer. It is a voice-first, offline, private-first fishing journal.',
      'CastLog is live on the iOS App Store, and an Android test is open.',
      'The public site says you can log a catch in 3 taps or by voice, including with no signal, and that the app is built for wet hands.',
      'The logging flow on the site is: say the species, CastLog attaches lake, weather, and moon phase, then the angler confirms and logs. The site uses "Largemouth bass" as a species example. Do not name a real lake.',
      'Voice captures save locally and sync when the phone is back in range.',
      'The portfolio lists the stack as React Native, Expo, TypeScript, and Supabase, and describes the app as offline-first.',
      'The CastLog privacy policy (updated July 10, 2026) says that when Voice Log is used, the audio is sent to OpenAI (Whisper) for transcription, then the transcript is sent to Anthropic (Claude) via OpenRouter to fill in catch details. Do not claim that transcription always runs on the device.',
      'AI features send data to those providers only when the person actively uses the feature, not continuously in the background.',
      'The core journal, voice logging, and export are free. Angler Pro is optional.',
      'The product site is https://castlogapp.com/. The portfolio write-up is at https://anthonysdigital.net/portfolio.html#castlog.',
    ],
    points: [
      'The product problem is a catch log that has to work with wet hands and no signal, not a form that assumes a dry phone and a network.',
      'A voice capture is saved on the device and synced when the phone is back in range, so the log can be finished without waiting for a signal.',
      'When Voice Log later uses a network, the privacy policy says the audio goes to OpenAI Whisper and the transcript goes to Anthropic via OpenRouter. Do not describe an on-device transcription path that the public sources do not state.',
    ],
  },
  {
    key: 'agent-audit-logging',
    area: 'agent-security',
    category: 'AI',
    short: 'Agent Audit Logs',
    label: 'Audit logging for agent tool calls',
    summary: 'Every tool call an agent makes needs a record a person can read later: who asked, which tool, which arguments, who approved it, and what came back. The log must not become a second copy of the secrets.',
    illustration: 'one refund tool call that a support lead asks about a week later',
    phrases: ['audit log', 'audit trail', 'agent logging'],
    citations: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html',
      'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html',
    ],
    tags: ['llm', 'agents', 'logging'],
    keywords: 'audit logging, agent tool calls, audit trail, observability, approvals, agent security',
    image: '1496368077930-c1e31b4e5b44',
  },
  {
    key: 'agent-output-exfiltration',
    area: 'agent-security',
    category: 'AI',
    short: 'Output Exfiltration',
    label: 'Stopping agent output from leaking data through links',
    summary: 'Model output that renders as a link, an image, or a fetch can carry data to a host the user never chose. Render output against an allowlist of hosts and encode it for the place it lands.',
    illustration: 'one chat reply rendered as Markdown that includes an image URL',
    phrases: ['exfiltration', 'markdown image', 'output handling'],
    citations: [
      'https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/',
      'https://genai.owasp.org/llmrisk/llm01-prompt-injection/',
    ],
    tags: ['llm', 'agents', 'appsec'],
    keywords: 'data exfiltration, improper output handling, Markdown rendering, URL allowlist, LLM output, agent security',
    image: '1768720407298-1b24a0f6749d',
  },
  {
    key: 'scoped-agent-tokens',
    area: 'agent-security',
    category: 'AI',
    short: 'Scoped Agent Tokens',
    label: 'Short-lived, narrowly scoped tokens for agents',
    summary: 'An agent should act with a token issued for this user, this resource, and this task, that expires soon. A long-lived key shared by every run turns one bad tool call into access to everything that key can reach.',
    illustration: 'one nightly agent run that files tickets in a single project',
    phrases: ['scoped token', 'token exchange', 'resource indicator', 'audience restriction'],
    citations: [
      'https://www.rfc-editor.org/rfc/rfc8707',
      'https://www.rfc-editor.org/rfc/rfc8693',
      'https://www.rfc-editor.org/rfc/rfc9700',
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization',
    ],
    tags: ['llm', 'agents', 'oauth'],
    keywords: 'OAuth scopes, token exchange, RFC 8693, resource indicators, RFC 8707, short-lived tokens, agent security',
    image: '1685886069739-c1b96bba7953',
  },
  {
    key: 'castlog-private-first-design',
    area: 'case-study',
    category: 'Engineering',
    short: 'CastLog Private by Default',
    label: 'Building CastLog so fishing spots stay private',
    summary: 'CastLog keeps spots private by default: there is no public social feed, data is not sold, and the angler can export or delete their journal. Location is attached only when they choose to include it.',
    illustration: 'one saved fishing spot that stays on the angler account and is not shown on a public map',
    phrases: ['castlog private', 'private-first fishing', 'spots stay private'],
    citations: [
      'https://castlogapp.com/',
      'https://castlogapp.com/privacy',
      'https://anthonysdigital.net/portfolio.html#castlog',
    ],
    tags: ['mobile', 'castlog', 'privacy'],
    keywords: 'CastLog, private by default, fishing spots, data export, privacy policy, shipped app',
    facts: [
      'Anthony built CastLog as a solo founder and engineer. It is a fishing journal that is private by default.',
      'CastLog is live on the iOS App Store, and an Android test is open.',
      'The site and privacy policy say there is no public social feed. Spots and locations the angler saves are private to their account by default and are not shared with other users or shown publicly.',
      'CastLog does not sell personal data and does not run a third-party advertising network in the app.',
      'Location is stored when the angler chooses to attach it to a catch or a spot. The angler controls that choice and the device location permission. Do not include real coordinates or real lake names.',
      'Account and fishing data are stored on cloud infrastructure and synced to the angler\'s devices. Do not claim that all journal data lives only on the device.',
      'CSV and JSON export are part of the product. The core journal and export are free. The angler can request deletion of the account and associated data.',
      'The privacy policy says AI features, including Fish ID, Bite Coach, and Voice Log, send the listed inputs to third-party AI providers only when the person actively uses that feature.',
      'The portfolio lists the stack as React Native, Expo, TypeScript, and Supabase.',
      'The product site is https://castlogapp.com/. The privacy policy is at https://castlogapp.com/privacy. The portfolio write-up is at https://anthonysdigital.net/portfolio.html#castlog.',
    ],
    points: [
      'Spots are private by default: CastLog has no public social feed, and saved locations are not shared with other users.',
      'The product does not sell personal data and does not run a third-party advertising network in the app. Export and account deletion are available.',
      'Journal data is stored on cloud infrastructure and synced to the angler\'s devices. Location is attached only when the angler chooses to include it.',
    ],
  },
  {
    key: 'confused-deputy-agents',
    area: 'agent-security',
    category: 'AI',
    short: 'Confused Deputy Agents',
    label: 'Agents acting as confused deputies',
    summary: 'An agent that holds broader access than the person it works for can be steered into using that access for them. Authorize each tool call as the requesting user, not as the agent.',
    illustration: 'one shared workspace assistant whose service account can read every team\'s documents',
    phrases: ['confused deputy'],
    citations: [
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices',
      'https://genai.owasp.org/llmrisk/llm062025-excessive-agency/',
    ],
    tags: ['llm', 'agents', 'authorization'],
    keywords: 'confused deputy, agent authorization, service accounts, per-user authorization, excessive agency, agent security',
    image: '1793217391692-af68e574e1b8',
  },
  {
    key: 'agent-code-sandbox',
    area: 'agent-security',
    category: 'AI',
    short: 'Sandboxing Agent Code',
    label: 'Sandboxing code an agent writes and runs',
    summary: 'Code an agent generates is untrusted code. Run it with no ambient credentials, a throwaway filesystem, no network by default, and hard limits on time and memory.',
    illustration: 'one data-analysis agent that writes and runs a script against an uploaded CSV',
    phrases: ['sandbox', 'code execution', 'code interpreter'],
    citations: [
      'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html',
      'https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/',
    ],
    tags: ['llm', 'agents', 'sandboxing'],
    keywords: 'sandboxing, code execution, agent-generated code, isolation, least privilege, agent security',
    image: '1634224147987-95d2b7679fb0',
  },
  {
    key: 'agent-kill-switch',
    area: 'agent-security',
    category: 'AI',
    short: 'Agent Budgets and Kill Switches',
    label: 'Budgets, step caps, and a kill switch for agents',
    summary: 'An agent loop needs limits the model cannot change: a step cap, a spend cap, per-tool call limits, and a switch an operator can flip to stop every run.',
    illustration: 'one research agent that keeps calling a paid search tool in a loop',
    phrases: ['kill switch', 'step cap', 'spend cap', 'unbounded consumption'],
    citations: [
      'https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/',
      'https://genai.owasp.org/llmrisk/llm062025-excessive-agency/',
    ],
    tags: ['llm', 'agents', 'operations'],
    keywords: 'agent budgets, kill switch, step limits, unbounded consumption, cost controls, agent security',
    image: '1758873263914-230f8ff60569',
  },
  {
    key: 'nutrilogix-ai-food-logging',
    area: 'case-study',
    category: 'Engineering',
    short: 'Nutrilogix Meal Logging',
    label: 'Building Nutrilogix meal logging from a photo or voice',
    summary: 'Nutrilogix lets a person log a meal from a photo or by voice, then edit the estimate before saving. The iOS app is in TestFlight. Photo estimates are presented as estimates, not lab results.',
    illustration: 'one plate photo that becomes an editable calorie and macro estimate before the meal is saved',
    phrases: ['nutrilogix meal', 'photo meal logging', 'ai food logging'],
    citations: [
      'https://nutrilogix-ai.com/',
      'https://nutrilogix-ai.com/privacy',
      'https://anthonysdigital.net/portfolio.html#nutrilogix',
    ],
    tags: ['mobile', 'nutrilogix', 'ai'],
    keywords: 'Nutrilogix, AI food logging, photo meal log, voice logging, TestFlight, shipped app',
    facts: [
      'Spell the product name Nutrilogix. Anthony built it solo, including the product, the app, and the back end.',
      'Nutrilogix is an AI nutrition app. A person can log a meal from a photo or by voice, look up a barcode, and sync workouts with Apple Health.',
      'The app is in an iOS TestFlight beta. The public site describes Android as coming soon.',
      'The public site says photo estimates can be edited before they are saved, and that they are estimates, not a lab result.',
      'Other public features include scanning a fridge or pantry to generate recipes and a shopping list, and connecting Apple Health and Google Fit for calories burned, with the user\'s permission.',
      'The portfolio lists the stack as React Native, Expo, TypeScript, and Supabase.',
      'The Nutrilogix privacy policy (updated February 2, 2026) says health and fitness data from Apple HealthKit and Google Fit is accessed only with explicit permission and is never sold to third parties.',
      'The privacy policy says images are processed to identify ingredients and estimate portions. It also says images may be stored anonymously to improve AI models, and that the user can opt out in settings.',
      'The product site is https://nutrilogix-ai.com/. The portfolio write-up is at https://anthonysdigital.net/portfolio.html#nutrilogix.',
    ],
    points: [
      'The product problem is meal logging that people abandon when every ingredient has to be typed.',
      'A photo or a voice clip becomes an editable estimate. The site is explicit that the result is an estimate, not a lab result, and that the person can adjust it before save.',
      'Health data from Apple Health or Google Fit is used only with permission, and the privacy policy says it is never sold to third parties.',
    ],
  },
  {
    key: 'agent-memory-poisoning',
    area: 'agent-security',
    category: 'AI',
    short: 'Agent Memory Poisoning',
    label: 'Keeping long-term agent memory from being poisoned',
    summary: 'Whatever an agent saves to memory comes back as context in a later session. Decide what may be written, record where it came from, keep it per user, and let people see and delete it.',
    illustration: 'one assistant that saves a "preference" it read inside a shared document',
    phrases: ['memory poisoning', 'agent memory', 'long-term memory'],
    citations: [
      'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html',
      'https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/',
    ],
    tags: ['llm', 'agents', 'appsec'],
    keywords: 'memory poisoning, agent memory, persistent context, provenance, per-user isolation, agent security',
  },
  {
    key: 'multi-agent-trust',
    area: 'agent-security',
    category: 'AI',
    short: 'Multi-Agent Trust Boundaries',
    label: 'Trust boundaries between cooperating agents',
    summary: 'A message from another agent is input, not authority. Each agent keeps its own tool scope and approval rules, and a subagent cannot grant itself the orchestrator\'s permissions.',
    illustration: 'one orchestrator that hands a browsing task to a subagent and acts on its summary',
    phrases: ['multi agent', 'subagent', 'orchestrator agent', 'agent to agent'],
    citations: [
      'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html',
    ],
    tags: ['llm', 'agents', 'architecture'],
    keywords: 'multi-agent security, trust boundaries, subagents, orchestration, privilege escalation, agent security',
    image: '1764195287345-2086f504cb0b',
  },
  {
    key: 'agent-security-evals',
    area: 'agent-security',
    category: 'AI',
    short: 'Agent Security Evals',
    label: 'Regression tests for agent security controls',
    summary: 'Agent defenses need tests that run on every change: a fixed set of hostile documents and tool results, with assertions on which tools the agent was allowed to call. A demo that behaved once is not a test.',
    illustration: 'one pull request that changes the system prompt of a support agent',
    phrases: ['security eval', 'adversarial test', 'red team'],
    citations: [
      'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html',
      'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf',
    ],
    tags: ['llm', 'agents', 'testing'],
    keywords: 'agent security testing, evals, adversarial testing, regression tests, CI, agent security',
  },
  {
    key: 'portfolio-blog-writer-pipeline',
    area: 'case-study',
    category: 'Engineering',
    short: 'Portfolio Blog Writer',
    label: 'How the Portfolio blog writer drafts posts for review',
    summary: 'The Portfolio blog is drafted by a scheduled script that opens a pull request for review. The script does not publish. A post goes live only after that pull request is merged.',
    illustration: 'one Monday morning run that opens a Blog draft pull request and waits for a review',
    phrases: ['blog writer pipeline', 'blog draft pull request', 'scheduled blog writer'],
    citations: [
      'https://anthonysdigital.net/blog/',
      'https://anthonysdigital.net/scripts/generate-blog-post.mjs',
      'https://anthonysdigital.net/scripts/blog-figures.mjs',
    ],
    tags: ['engineering', 'automation', 'blog'],
    keywords: 'blog pipeline, draft pull request, GitHub Actions, scheduled writing, anthonysdigital.net',
    facts: [
      'Anthony\'s public portfolio and blog live at https://anthonysdigital.net/.',
      'The weekly writer is the public script at https://anthonysdigital.net/scripts/generate-blog-post.mjs. In-body diagrams are drawn by https://anthonysdigital.net/scripts/blog-figures.mjs.',
      'A GitHub Actions workflow on the default branch runs Monday and Thursday, checks out the gh-pages branch, runs that script, and opens a "Blog draft" pull request into gh-pages. The script itself does not push or publish.',
      'A draft is reviewed in the pull request. The post is published when that pull request is merged.',
      'Topics are picked in a fixed order from a list in the script. A topic already used in a published post, a retired stub, or an open blog pull request is skipped.',
      'Each draft gets a featured photo from a curated pool of unused Unsplash photos, and one or two in-body figures. The script draws diagrams from a spec and does not reuse a photo that is already used.',
      'The topic list focuses on AI agent security, with occasional posts about shipped products interleaved.',
      'Do not invent traffic, engagement, open rates, or other unpublished metrics. Do not mention a number of years of experience.',
    ],
    points: [
      'The writer opens a draft pull request. It does not publish the post on its own.',
      'Topics are taken in a fixed order, and a topic already used in a published post or an open draft is skipped.',
      'Covers and in-body figures are assigned from unused photos and generated diagrams, so two posts do not share an image.',
    ],
  },
  // ── General application security (fallback once agent topics are used) ──
  {
    key: 'sensitive-business-flows',
    area: 'appsec',
    category: 'Security',
    short: 'Sensitive Business Flows',
    label: 'Unrestricted access to sensitive business flows',
    summary: 'Checkout, redemption, invites, and password reset need limits on the business action itself. A valid session is not that limit.',
    illustration: 'one coupon redemption route that is open to every signed-in caller',
    phrases: ['sensitive business flow', 'business flow'],
    citations: ['https://api-security.owasp.org/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/'],
    tags: ['appsec', 'api-security', 'owasp'],
    keywords: 'OWASP API6, sensitive business flows, checkout limits, redemption, API security',
  },
  {
    key: 'webhook-signatures',
    area: 'appsec',
    category: 'Security',
    short: 'Webhook Signatures',
    label: 'Verifying webhook signatures and replay windows',
    summary: 'A webhook is untrusted until the signature matches and the timestamp is inside a short window. The JSON body is not authenticated by HTTPS alone.',
    illustration: 'one billing callback that arrives with a timestamp and a signature header',
    phrases: ['webhook signature', 'signing secret', 'replay window'],
    citations: ['https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries'],
    tags: ['appsec', 'api-security'],
    keywords: 'webhook signature, HMAC, replay window, signing secret, callbacks',
  },
  {
    key: 'oauth-pkce',
    area: 'appsec',
    category: 'Security',
    short: 'OAuth for Public Clients',
    label: 'OAuth for public clients, PKCE, and redirect allowlists',
    summary: 'A mobile or single-page client cannot keep a client secret. PKCE and an exact redirect allowlist are the controls that belong on that client.',
    illustration: 'one React Native login that returns through a custom scheme',
    phrases: ['pkce', 'public client', 'redirect uri', 'authorization code'],
    citations: [
      'https://datatracker.ietf.org/doc/html/rfc7636',
      'https://datatracker.ietf.org/doc/html/rfc6749',
      'https://datatracker.ietf.org/doc/html/rfc9700',
    ],
    tags: ['appsec', 'api-security', 'oauth'],
    keywords: 'OAuth, PKCE, public client, redirect URI, RFC 7636, mobile login',
  },
  {
    key: 'refresh-token-reuse',
    area: 'appsec',
    category: 'Security',
    short: 'Refresh Token Reuse',
    label: 'Detecting refresh token reuse',
    summary: 'A refresh token is single use. Presenting one that was already exchanged is a reason to revoke the whole grant, not to mint another access token.',
    illustration: 'one stored refresh token that is presented twice',
    phrases: ['refresh token', 'token reuse', 'reuse detection'],
    citations: [
      'https://datatracker.ietf.org/doc/html/rfc9700',
      'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html',
    ],
    tags: ['appsec', 'api-security', 'oauth'],
    keywords: 'refresh token, reuse detection, token rotation, OAuth, RFC 9700',
  },
  {
    key: 'graphql-query-limits',
    area: 'appsec',
    category: 'Security',
    short: 'GraphQL Query Limits',
    label: 'GraphQL query cost and depth limits',
    summary: 'A GraphQL endpoint needs a cost limit and a depth limit before it runs the query. Authentication does not bound how wide a selection set can be.',
    illustration: 'one query that nests the same connection many levels deep',
    phrases: ['query depth', 'query cost', 'graphql limit'],
    citations: ['https://graphql.org/learn/security/'],
    tags: ['appsec', 'api-security', 'graphql'],
    keywords: 'GraphQL, query cost, query depth, complexity limit, API security',
  },
  {
    key: 'upload-allowlists',
    area: 'appsec',
    category: 'Security',
    short: 'Upload Allowlists',
    label: 'Allowlists for file uploads',
    summary: 'An upload is accepted only when the type, the size, and the destination are on a list the application owns. The filename the client sends is not that list.',
    illustration: 'one avatar upload with a client-supplied filename',
    phrases: ['file upload', 'upload allowlist', 'content type allowlist'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'file upload, allowlist, content type, avatar upload, OWASP upload cheat sheet',
  },
  {
    key: 'cached-auth-responses',
    area: 'appsec',
    category: 'Security',
    short: 'Caching Authenticated Responses',
    label: 'Caching responses that belong to one caller',
    summary: 'A response that depends on who is logged in must not be stored by a shared cache. Cache-Control is part of the authorization boundary.',
    illustration: 'one account profile response sitting behind a shared cache',
    phrases: ['authenticated response', 'shared cache', 'cache-control'],
    citations: [
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control',
      'https://datatracker.ietf.org/doc/html/rfc9110',
    ],
    tags: ['appsec', 'api-security'],
    keywords: 'Cache-Control, authenticated cache, private response, CDN, RFC 9110',
  },
  {
    key: 'worker-authorization',
    area: 'appsec',
    category: 'Security',
    short: 'Authorization in Background Jobs',
    label: 'Re-checking authorization inside workers and queues',
    summary: 'A background job has to carry the actor and re-check the action. The request that enqueued it is gone, and the worker must not assume that check still applies.',
    illustration: 'one export job that runs minutes after the click that queued it',
    phrases: ['background job', 'queue worker', 'worker authorization'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security', 'authorization'],
    keywords: 'background job, queue, authorization, worker, export job',
  },
  {
    key: 'query-parameterization',
    area: 'appsec',
    category: 'Security',
    short: 'Query Parameterization',
    label: 'Parameterized queries instead of concatenated input',
    summary: 'Values from the request belong in parameters. The query text is a constant the application owns. Concatenation is the bug, including in filters and sorts.',
    illustration: 'one search box whose text is copied into a query',
    phrases: ['parameterized query', 'sql injection', 'query parameterization'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'parameterized queries, SQL injection prevention, prepared statements, OWASP',
  },
  {
    key: 'output-encoding',
    area: 'appsec',
    category: 'Security',
    short: 'Output Encoding',
    label: 'Encoding untrusted text for the context that renders it',
    summary: 'Text is encoded for the context it is about to enter: HTML, an attribute, a URL, or a script. Escaping it for a different context does not carry over.',
    illustration: 'one profile name rendered into an HTML page',
    phrases: ['output encoding', 'cross-site scripting', 'cross site scripting'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'output encoding, XSS prevention, contextual encoding, OWASP cheat sheet',
  },
  {
    key: 'deserialization-boundaries',
    area: 'appsec',
    category: 'Security',
    short: 'Deserialization Boundaries',
    label: 'Refusing to deserialize untrusted object graphs',
    summary: 'Untrusted bytes should become a known data shape, not a graph of objects the runtime rebuilds. If a parser can name a type from the payload, it is the wrong parser.',
    illustration: 'one cached session blob written by an older version of the service',
    phrases: ['deserialization', 'deserialize', 'object graph'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'deserialization, untrusted data, parser, object graph, OWASP cheat sheet',
  },
  {
    key: 'cookie-flags',
    area: 'appsec',
    category: 'Security',
    short: 'Cookie Flags',
    label: 'Cookie flags on session cookies',
    summary: 'A session cookie needs Secure, HttpOnly, and an explicit SameSite. A missing flag is a missing control, not a browser default you can leave unnamed.',
    illustration: 'one session cookie set by the login response',
    phrases: ['cookie flag', 'httponly', 'samesite'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'session cookie, HttpOnly, Secure, SameSite, session management',
  },
  {
    key: 'account-recovery',
    area: 'appsec',
    category: 'Security',
    short: 'Account Recovery Tokens',
    label: 'Scope and lifetime of account recovery tokens',
    summary: 'A password reset token is single use, short lived, and bound to the account that requested it. The email link is not a session.',
    illustration: 'one reset link generated for a single account',
    phrases: ['password reset', 'account recovery', 'reset token'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'password reset, account recovery, reset token, single use, OWASP',
  },
  {
    key: 'service-to-service-auth',
    area: 'appsec',
    category: 'Security',
    short: 'Service to Service Authentication',
    label: 'Authentication between services',
    summary: 'A call from one service to another needs its own credential and its own audience. A user session forwarded downstream is not a service identity.',
    illustration: 'one internal request from the API to a billing service',
    phrases: ['service to service', 'service-to-service', 'workload identity'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'service authentication, workload identity, audience, microservices, internal API',
  },
  {
    key: 'log-redaction',
    area: 'appsec',
    category: 'Security',
    short: 'Redacting Secrets in Logs',
    label: 'Keeping secrets and tokens out of logs',
    summary: 'Logs can keep a request id, a route, and a result. They do not keep access tokens, refresh tokens, session cookies, or raw authorization headers.',
    illustration: 'one error log line written when a request fails authentication',
    phrases: ['log redaction', 'secrets in logs', 'authorization header'],
    citations: ['https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html'],
    tags: ['appsec', 'api-security'],
    keywords: 'log redaction, secrets in logs, authorization header, tokens, OWASP logging',
  },
  {
    key: 'mobile-secret-storage',
    area: 'engineering',
    category: 'Mobile',
    short: 'Secrets on Device',
    label: 'Keeping tokens off the React Native bundle and out of plain storage',
    summary: 'A secret compiled into the app binary is available to anyone with the binary. Tokens that have to live on device belong in the platform secure store, not in a plain async store.',
    illustration: 'one API token the app needs after a restart',
    phrases: ['secure storage', 'async storage', 'secret in the binary', 'securestore'],
    citations: [
      'https://reactnative.dev/docs/security',
      'https://docs.expo.dev/versions/latest/sdk/securestore/',
    ],
    tags: ['react-native', 'appsec'],
    keywords: 'React Native, secure store, async storage, token storage, mobile secrets',
  },
  {
    key: 'deep-link-allowlists',
    area: 'engineering',
    category: 'Mobile',
    short: 'Deep Link Allowlists',
    label: 'Allowlisting deep links and OAuth return URLs',
    summary: 'A link that opens the app is an input. The host, the path, and the return URL have to match a list the app owns before any token in that link is stored.',
    illustration: 'one login return URL that opens the installed app',
    phrases: ['deep link', 'universal link', 'app link'],
    citations: [
      'https://developer.android.com/training/app-links',
      'https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app',
    ],
    tags: ['react-native', 'appsec'],
    keywords: 'deep link, universal link, app link, OAuth return, React Native',
  },
  {
    key: 'supabase-service-role',
    area: 'engineering',
    category: 'Backend',
    short: 'The Supabase Service Role Key',
    label: 'Keeping the Supabase service role key on the server',
    summary: 'The service role key bypasses row level security. It stays on a server you control. A browser, a mobile binary, and a logged error are the wrong places for it.',
    illustration: 'one server handler that needs to write a row the user cannot write',
    phrases: ['service role', 'service_role'],
    citations: ['https://supabase.com/docs/guides/getting-started/api-keys'],
    tags: ['supabase', 'appsec'],
    keywords: 'Supabase, service role key, row level security, API keys, server only',
  },
  {
    key: 'expand-contract-migrations',
    area: 'engineering',
    category: 'Backend',
    short: 'Expand and Contract Migrations',
    label: 'Expand and contract database migrations',
    summary: 'A schema change that has to ship while old and new code both run is two steps: add the new shape, move readers and writers, then remove the old shape. One migration that does all three breaks the deploy that is still on the previous release.',
    illustration: 'one column rename that old and new servers will both see',
    phrases: ['expand and contract', 'parallel change', 'expand/contract'],
    citations: ['https://martinfowler.com/bliki/ParallelChange.html'],
    tags: ['postgres', 'nodejs'],
    keywords: 'expand and contract, parallel change, database migration, zero downtime, schema',
  },
  {
    key: 'idempotency-keys',
    area: 'engineering',
    category: 'Backend',
    short: 'Idempotency Keys',
    label: 'Idempotency keys on unsafe requests',
    summary: 'A retried POST is a second request unless the client and the server share an idempotency key. The key is stored with the outcome, and a retry returns that outcome instead of doing the work again.',
    illustration: 'one payment request that the client sends again after a timeout',
    phrases: ['idempotency', 'idempotency key'],
    citations: ['https://docs.stripe.com/api/idempotent_requests'],
    tags: ['api-security', 'nodejs'],
    keywords: 'idempotency key, retry, unsafe request, POST, Stripe idempotent requests',
  },
  {
    key: 'api-error-contracts',
    area: 'engineering',
    category: 'Backend',
    short: 'API Error Contracts',
    label: 'A stable error contract for API clients',
    summary: 'Clients need a stable error shape: a code they can branch on, and a message safe to show. A stack trace, a SQL string, or a new shape per endpoint is not that contract.',
    illustration: 'one failed create call that the mobile client has to explain',
    phrases: ['error contract', 'problem details'],
    citations: ['https://www.rfc-editor.org/rfc/rfc9457'],
    tags: ['api-security', 'typescript'],
    keywords: 'API errors, RFC 9457, problem details, error contract, client errors',
  },
]

// Verified Unsplash photos (HTTP 200, image/jpeg at ?w=1200&q=80).
// Each entry is a real photograph, not a render, and none is a near-duplicate
// of another entry or of a photo already on a post. Add ids here when the
// pool runs low. Do not add an id that posts.json already uses.
const IMAGE_POOL = [
  { id: '1485827404703-89b55fcc595e', topics: ['ai'], alt: 'A white robot with a round face and illuminated eyes, photographed indoors' },
  { id: '1758873263914-230f8ff60569', topics: ['ai'], alt: 'A yellow selector switch with a key beside an amber warning light on a machine control panel' },
  { id: '1771065999830-8b6762df3354', topics: ['ai'], alt: 'A row of metal toggle switches, each with its own label, on a brushed steel plate' },
  { id: '1496368077930-c1e31b4e5b44', topics: ['ai', 'security'], alt: 'Two bullet surveillance cameras mounted on a gray concrete wall' },
  { id: '1550527882-b71dea5f8089', topics: ['ai', 'security'], alt: 'A ring of old black skeleton keys hanging on a wooden wall' },
  { id: '1569784210445-990e7e44ccfe', topics: ['ai', 'security'], alt: 'A row of electronic ticket gates with status lights in a station hall' },
  { id: '1634224147987-95d2b7679fb0', topics: ['ai', 'security'], alt: 'A vault room lined with numbered steel safe deposit drawers, a few left open' },
  { id: '1685886069739-c1b96bba7953', topics: ['ai', 'security'], alt: 'A key in a cylinder lock with other keys hanging from the same ring' },
  { id: '1764195287345-2086f504cb0b', topics: ['ai', 'engineering'], alt: 'An empty control room with consoles, phones, and rows of indicator lights' },
  { id: '1768720407298-1b24a0f6749d', topics: ['ai', 'security'], alt: 'A closed blue steel door with a heavy lock and latch' },
  { id: '1793217391692-af68e574e1b8', topics: ['ai', 'security'], alt: 'Stainless steel turnstiles with green and red status lights at a building entrance' },
  { id: '1597852074816-d933c7d2b988', topics: ['backend', 'security'], alt: 'An open hard drive with the platter and read arm exposed' },
  { id: '1501139083538-0139583c060f', topics: ['security'], alt: 'An hourglass with blue sand standing on a bed of small stones' },
  { id: '1450101499163-c8848c66ca85', topics: ['security', 'engineering'], alt: 'A person signing a printed document with a pen' },
  { id: '1563013544-824ae1b704d3', topics: ['security', 'backend'], alt: 'Hands holding a credit card above a laptop keyboard' },
  { id: '1529699211952-734e80c4d42b', topics: ['engineering'], alt: 'Wooden chess pieces lined up on a board, with one dark pawn in front' },
  { id: '1587654780291-39c9404d746b', topics: ['engineering'], alt: 'A pile of loose colorful interlocking building bricks' },
  { id: '1581091226825-a6a2a5aee158', topics: ['backend', 'engineering'], alt: 'A person working on a laptop beside factory machinery and cable trays' },
  { id: '1551434678-e076c223a692', topics: ['engineering'], alt: 'Two people working at separate laptops in a bright office' },
  { id: '1600880292203-757bb62b4baf', topics: ['engineering'], alt: 'Two coworkers high-fiving across a desk covered with papers and a laptop' },
  { id: '1481627834876-b7833e8f5570', topics: ['engineering'], alt: 'Library shelves packed with books under a row of hanging light bulbs' },
  { id: '1434030216411-0b793f4b4173', topics: ['engineering'], alt: 'A hand writing notes on paper beside a closed laptop and a mug' },
  { id: '1454165804606-c3d57bc86b40', topics: ['engineering'], alt: 'Two people marking up a printed page between open laptops' },
  { id: '1554224155-6726b3ff858f', topics: ['backend', 'security'], alt: 'Tax forms, a calculator phone, and a pen spread across a wood floor' },
  { id: '1542744173-8e7e53415bb0', topics: ['engineering'], alt: 'A person presenting to colleagues seated around a conference table with laptops' },
  { id: '1552664730-d307ca884978', topics: ['engineering'], alt: 'A person pointing at a wall of colorful sticky notes while others sit with laptops' },
  { id: '1423666639041-f56000c27a9a', topics: ['mobile', 'security'], alt: 'Hands holding a phone above a laptop, with a small USB drive on the table' },
  { id: '1504384308090-c894fdcc538d', topics: ['engineering'], alt: 'A large open office with rows of people working at laptops' },
  { id: '1581092160562-40aa08e78837', topics: ['engineering', 'backend'], alt: 'Technical drawings, a cutting mat, and a toolbox laid out on a workbench' },
  { id: '1503387762-592deb58ef4e', topics: ['engineering'], alt: 'A person drafting a floor plan with a ruler and a rolled sheet of paper' },
  { id: '1434494878577-86c23bcb06b9', topics: ['mobile'], alt: 'A person tapping a smartwatch on their wrist' },
  { id: '1517048676732-d65bc937f952', topics: ['engineering'], alt: 'People seated along a wooden table, writing in notebooks' },
  { id: '1600880292089-90a7e086ee0c', topics: ['engineering'], alt: 'Several hands stacked together over a table of papers' },
  { id: '1531403009284-440f080d1e12', topics: ['backend', 'engineering'], alt: 'A hand pinning a card on a wall of wireframes and flow diagrams' },
  { id: '1456513080510-7bf3a84b82f8', topics: ['engineering'], alt: 'Open books and a handwritten notebook on a table, with shelves behind them' },
]

const STOPWORDS = new Set((
  'a an the and or of to for in on with from by at as is are was were be been being ' +
  'this that these those it its into over under than then not no nor but if so such ' +
  'about across after before between during without within your you we they their ' +
  'them our how what when where which who why per via using use used just more most ' +
  'any each other another same different new old out up down off all also only can ' +
  'may should must does did done get got let put set one two both lessons guide ' +
  'practices best start here need know matters matter beyond actual actually real ' +
  'while because again further once there make makes making have has had will apps ' +
  'app application applications system systems post blog user users data code some ' +
  'than still ship ships shipping'
).split(/\s+/))

const BANNED_OPENERS = [
  [/^most\s+apis\b/i, 'Do not open with "Most APIs".'],
  [/^most\s+apps\b/i, 'Do not open with "Most apps".'],
  [/^most\s+applications\b/i, 'Do not open with "Most applications".'],
  [/^most\s+organizations\b/i, 'Do not open with "Most organizations".'],
  [/^the most common mistake i see\b/i, 'Do not open with "The most common mistake I see".'],
]

const BANNED_PROSE = [
  [/case study/i, 'Remove the phrase "case study".'],
  [/\bi've seen\b/i, 'Remove "I\'ve seen". Do not invent a first-person anecdote.'],
  [/\bi have seen\b/i, 'Remove "I have seen". Do not invent a first-person anecdote.'],
  [/\bin my \d+\s+years\b/i, 'Remove career-year claims. Do not invent numbers about Anthony.'],
  [/\b\d+\s+years of experience\b/i, 'Remove career-year claims. Do not invent numbers about Anthony.'],
  [/\b15\+?\s+years\b/i, 'Remove "15 years" and "15+ years". Do not mention a number of years of experience.'],
  [/\bfifteen\s+years\b/i, 'Remove career-year claims. Do not mention a number of years of experience.'],
  [/\bscott lake\b/i, 'Do not use real lake names. Use a labeled illustration such as "Example Lake".'],
  [/\bover my career\b/i, 'Remove career anecdotes.'],
  [/\bmy clients\b/i, 'Do not invent clients or engagements.'],
  [/\bi once\b/i, 'Do not invent a first-person anecdote.'],
]

const DEFAULT_CODE = [
  'function keepAllowlisted(input, allowedKeys) {',
  '  const out = {}',
  '  for (const key of allowedKeys) {',
  '    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key]',
  '  }',
  '  return out',
  '}',
].join('\n')

// ── Small helpers ────────────────────────────────────────────────────────────

function writeSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) return
  appendFileSync(file, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8')
}

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

function visible(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function loadExistingPosts() {
  try {
    return JSON.parse(readFileSync(POSTS_JSON, 'utf8'))
  } catch {
    return []
  }
}

function imageId(url) {
  const match = String(url || '').match(/photo-([A-Za-z0-9_-]+)/)
  return match ? match[1] : ''
}

function imageUrl(id) {
  return `https://images.unsplash.com/photo-${id}?w=1200&q=80`
}

const HERO_DIR = path.join(ROOT, 'blog/images')
const BLOG_INDEX = path.join(ROOT, 'blog/index.html')
const SITE_ORIGIN = 'https://anthonysdigital.net'

function publicImageUrl(src) {
  const value = String(src || '')
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${SITE_ORIGIN}${value.startsWith('/') ? '' : '/'}${value}`
}

function unsplashDownloadUrl(url) {
  const id = imageId(url)
  if (!id) return url
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=max&w=1600&q=70&fm=webp`
}

function tldrSentence(text) {
  const plain = visible(text).replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  // Split on sentence punctuation only when the next sentence starts. A period
  // inside "Node.js" or "e.g." is not a boundary.
  const parts = []
  let start = 0
  const boundary = /[.!?](?=\s+[A-Z"“])/g
  let match
  while ((match = boundary.exec(plain))) {
    parts.push(plain.slice(start, match.index + 1).trim())
    start = match.index + 1
  }
  const tail = plain.slice(start).trim()
  if (tail) parts.push(tail)
  const cleaned = parts.filter(Boolean)
  return cleaned.find(sentence => sentence.length >= 40) || cleaned[0] || plain
}

function gtmBootstrap() {
  return `<!-- Google Tag Manager -->
  <script>
    window.dataLayer = window.dataLayer || [];
    function loadGoogleTagManager() {
      if (window.__gtmLoaded) return;
      window.__gtmLoaded = true;
      (function (w, d, s, l, i) {
        w[l] = w[l] || [];
        w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
        var f = d.getElementsByTagName(s)[0], j = d.createElement(s), dl = l != 'dataLayer' ? '&l=' + l : '';
        j.async = true;
        j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
        f.parentNode.insertBefore(j, f);
      })(window, document, 'script', 'dataLayer', 'GTM-52FVS76');
    }
    window.addEventListener('load', loadGoogleTagManager, { once: true });
  </script>
  <!-- End Google Tag Manager -->
`
}

function blogFontLinks() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">`
}

const HIRE_CTA_HREF = '/contact.html#contact-form'

function hireCtaHtml() {
  return `<aside class="post-cta" aria-label="Get in touch">
          <p><strong>Want to work together?</strong> I am open to full-time roles and to contract or freelance work. <a href="${HIRE_CTA_HREF}">Get in touch</a> about a role or a project.</p>
        </aside>`
}

function authorBoxHtml() {
  return hireCtaHtml()
}

function bylineHtml(post) {
  return `<p class="post-byline">By Anthony Smith · <time datetime="${escapeHtml(post.dateISO)}">${escapeHtml(post.date)}</time></p>`
}

function tldrHtml(post) {
  const sentence = tldrSentence(post.excerpt || post.tldr)
  if (!sentence) return ''
  return `<p class="post-tldr"><strong>TL;DR:</strong> ${escapeHtml(sentence)}</p>`
}

function deferGtmInHtml(html) {
  if (html.includes('function loadGoogleTagManager')) return html
  const marked = /<!-- Google Tag Manager -->\s*<script>[\s\S]*?googletagmanager\.com\/gtm\.js[\s\S]*?<\/script>\s*(<!-- End Google Tag Manager -->)?/
  if (marked.test(html)) return html.replace(marked, gtmBootstrap())
  const bare = /<script>\s*\(function\s*\(\s*w\s*,\s*d\s*,\s*s\s*,\s*l\s*,\s*i\s*\)[\s\S]*?googletagmanager\.com\/gtm\.js[\s\S]*?<\/script>/
  if (bare.test(html)) return html.replace(bare, gtmBootstrap())
  return html
}

function trimBlogFonts(html) {
  const oldLink = /[ \t]*<link href="https:\/\/fonts\.googleapis\.com\/css\?family=Roboto:100,300,400,500,700,900&(?:amp;)?display=swap" rel="stylesheet">\n?/g
  return html.replace(oldLink, `${blogFontLinks()}\n`)
}

async function materializeHero(remoteUrl, slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new BlogError(`Refusing to save a hero with an unexpected slug: ${slug}`)
  }
  mkdirSync(HERO_DIR, { recursive: true })
  const dest = path.join(HERO_DIR, `${slug}.webp`)
  const tmp = path.join(HERO_DIR, `.${slug}.download`)
  const source = unsplashDownloadUrl(remoteUrl)
  const response = await fetch(source, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) {
    throw new BlogError(`Hero download failed (${response.status}) for ${source}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 32) throw new BlogError(`Hero download was empty for ${source}`)
  writeFileSync(tmp, bytes)
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', tmp,
      '-vf', "scale='min(1600,iw)':-2",
      '-c:v', 'libwebp',
      '-quality', '68',
      '-compression_level', '6',
      dest,
    ], { timeout: 30000 })
  } catch (err) {
    throw new BlogError(`Could not convert the hero to WebP (${err.message}). ffmpeg is required.`)
  } finally {
    try { unlinkSync(tmp) } catch { /* already removed */ }
  }
  const probe = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    dest,
  ], { timeout: 10000 })
  const [width, height] = probe.stdout.trim().split('x').map(value => Number(value))
  if (!width || !height || width > 1600) {
    throw new BlogError(`Hero ${slug} has unexpected dimensions (${probe.stdout.trim()}).`)
  }
  const size = statSync(dest).size
  console.log(`[Blog] saved hero ${slug}.webp ${width}x${height} (${size} bytes)`)
  return {
    image: `/blog/images/${slug}.webp`,
    imageWidth: width,
    imageHeight: height,
  }
}

function topicGroup(topic) {
  const category = String(topic?.category || '').toLowerCase()
  const area = String(topic?.area || '')
  if (area === 'agent-security' || category === 'ai') return 'ai'
  if (area === 'appsec' || category === 'security') return 'security'
  if (category === 'mobile') return 'mobile'
  if (category === 'backend') return 'backend'
  return 'engineering'
}

function inlineImageKeys(post) {
  return (Array.isArray(post?.inlineImages) ? post.inlineImages : [])
    .flatMap(item => [item.unsplashId, item.sha256 ? `sha256:${item.sha256}` : ''])
}

// Cover ids, in-body photo ids, and in-body file hashes ("sha256:<hex>") for
// every published post and every open draft. Covers and figures share it.
function usedImageIds(posts, pendingIds = []) {
  return new Set([
    ...posts.flatMap(post => [post.unsplashId, imageId(post.image), ...inlineImageKeys(post)]),
    ...pendingIds,
  ].filter(Boolean))
}

// Draft posts wait in open pull requests until Anthony merges them, so a new
// run cannot see their images in this checkout's posts.json. Read posts.json
// on every open pull request into gh-pages and treat those photos as used.
// Without this, two drafts opened before either merges get the same photo.
async function pendingDraftImageIds() {
  const inActions = process.env.GITHUB_ACTIONS === 'true'
  let prs
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'list', '--repo', REPO, '--base', 'gh-pages', '--state', 'open',
      '--limit', '100', '--json', 'number,headRefName,isCrossRepository',
    ], { timeout: 30000 })
    prs = JSON.parse(stdout)
  } catch (err) {
    if (inActions) {
      throw new BlogError(`Could not list open draft pull requests to avoid reusing their images (${err.message}).`)
    }
    console.warn(`[Blog] Skipping the open pull request image check outside Actions (${err.message})`)
    return []
  }
  const ids = []
  for (const pr of prs) {
    if (pr.isCrossRepository) continue
    let stdout
    try {
      ;({ stdout } = await execFileAsync('gh', [
        'api', '-H', 'Accept: application/vnd.github.raw',
        `repos/${REPO}/contents/blog/data/posts.json?ref=${encodeURIComponent(pr.headRefName)}`,
      ], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }))
    } catch (err) {
      console.warn(`[Blog] PR #${pr.number}: could not read blog/data/posts.json (${err.message})`)
      continue
    }
    try {
      for (const post of JSON.parse(stdout)) ids.push(post.unsplashId, imageId(post.image), ...inlineImageKeys(post))
    } catch {
      console.warn(`[Blog] PR #${pr.number}: blog/data/posts.json is not valid JSON`)
    }
  }
  const found = unique(ids)
  console.log(`[Blog] ${prs.length} open pull request(s) into gh-pages checked for images`)
  return found
}

async function verifyImageUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    const type = (res.headers.get('content-type') || '').toLowerCase()
    return res.status === 200 && type.startsWith('image/')
  } catch {
    return false
  }
}

function failImagePool(message) {
  const summary = [
    '## Weekly blog draft did not run',
    '',
    message,
    '',
    'Add new verified Unsplash URLs to `IMAGE_POOL` in `scripts/generate-blog-post.mjs`, then run the workflow again.',
    'Each URL must return HTTP 200 with an image content-type, and its photo id must not already appear in `blog/data/posts.json`.',
    '',
  ].join('\n')
  throw new BlogError(summary, summary)
}

// Photos on open draft pull requests count as used (see pendingDraftImageIds).
// A topic's `image` (a pool id) is tried first when it is still unused.
// Prefer an unused pool photo in the topic group. If that group is used up,
// take any other unused pool photo. If none remain, fail instead of reusing.
async function assignImage(posts, topic, pendingIds = []) {
  const used = usedImageIds(posts, pendingIds)
  const group = topicGroup(topic)
  const unused = IMAGE_POOL.filter(item => !used.has(item.id))
  // A topic may name a preferred pool photo. It is used only while unused.
  const preferred = unused.filter(item => item.id === topic?.image)
  const primary = unused.filter(item => item.topics[0] === group && item.id !== topic?.image)
  const secondary = unused.filter(item => item.topics[0] !== group && item.topics.includes(group))
  const rest = unused.filter(item => !item.topics.includes(group))
  // Photos another topic prefers go to the back, so they stay free for it.
  const reserved = new Set(TOPICS.filter(item => item.image && item.key !== topic?.key).map(item => item.image))
  const ordered = [...primary, ...secondary, ...rest]
  const candidates = [
    ...preferred,
    ...ordered.filter(item => !reserved.has(item.id)),
    ...ordered.filter(item => reserved.has(item.id)),
  ]

  if (!candidates.length) {
    failImagePool(
      'No unused image is left in the curated pool. This run will not reuse a photo that is already on a post.',
    )
  }

  const failed = []
  for (const item of candidates) {
    const url = imageUrl(item.id)
    if (await verifyImageUrl(url)) return { image: url, imageAlt: item.alt }
    failed.push(item.id)
  }

  failImagePool(
    `Every unused pool image failed verification (HTTP 200 and an image content-type). Failed ids: ${failed.join(', ')}.`,
  )
}

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

function cleanProse(str) {
  let out = String(str)
  out = out.replace(/\s*[—–]\s*/g, ', ')
  out = out.replace(/!+/g, '.')
  out = out.replace(/\.{2,}/g, '.')
  return out
    .replace(/,\s*([.,;:])/g, '$1')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/,\s*$/, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

// Editor notes that leaked into a published excerpt. Body examples are allowed
// to say "illustration"; the excerpt and meta description are not.
const EXCERPT_META_NOTE = /illustration|labeled as|\bplaceholder\b|\bnote\s*:|\bTODO\b|editor(?:'s)?\s+note|\bas an AI\b|\[[^\]]*(?:\bnote\b|\bTODO\b|\beditor\b|\binstruction\b)[^\]]*\]/i

function excerptHasMetaNote(text) {
  return EXCERPT_META_NOTE.test(String(text || ''))
}

function stripMetaNotes(text) {
  let out = String(text || '')
  out = out.replace(/\[[^\]]*(?:\bnote\b|\bTODO\b|\beditor\b|\binstruction\b)[^\]]*\]/gi, '')
  const sentences = out.split(/(?<=[.!?])\s+/)
  out = sentences.filter(sentence => sentence.trim() && !excerptHasMetaNote(sentence)).join(' ')
  return out.replace(/\s+/g, ' ').trim()
}

function enforceVoice(post) {
  if (post.title) post.title = cleanProse(post.title)
  if (post.excerpt) post.excerpt = stripMetaNotes(cleanProse(post.excerpt))
  for (const block of post.body || []) {
    if (block.type === 'code') continue
    if (typeof block.text === 'string') block.text = cleanProse(block.text)
    if (Array.isArray(block.items)) block.items = block.items.map(cleanProse)
  }
  return post
}

function tokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 3 && !STOPWORDS.has(word)),
  )
}

function similarTitle(title, others) {
  const mine = tokens(title)
  if (mine.size < 2) return null
  for (const other of others) {
    const theirs = tokens(other)
    if (theirs.size < 2) continue
    let shared = 0
    for (const word of mine) if (theirs.has(word)) shared++
    const denom = Math.min(mine.size, theirs.size)
    if (shared >= 2 && shared / denom >= 0.6) return other
  }
  return null
}

function normalizeHay(value) {
  return String(value || '').toLowerCase().replace(/[-_/]+/g, ' ')
}

function haystackHasPhrase(haystack, phrase) {
  const escaped = phrase
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '[\\s-]+')
  if (!escaped) return false
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(haystack)
}

function phrasesFor(topic) {
  return unique([
    topic.key.replace(/-/g, ' '),
    topic.short,
    topic.label,
    ...(topic.phrases || []),
  ].map(phrase => phrase.toLowerCase().trim()).filter(phrase => phrase.length >= 4))
}

function postFormat(post) {
  if (post.format && FORMATS.some(format => format.key === post.format)) return post.format
  if (KNOWN_FORMATS[post.slug]) return KNOWN_FORMATS[post.slug]
  return inferFormatFromTitle(post.title || '')
}

function inferFormatFromTitle(title) {
  const text = title.toLowerCase()
  if (/\bchecklist\b|\bsweep\b/.test(text)) return 'checklist'
  if (/\bmistake/.test(text)) return 'mistakes'
  if (/\binspect\b|\breview/.test(text)) return 'review'
  if (/\bwalkthrough\b|\bstep by step\b/.test(text)) return 'walkthrough'
  return null
}

function loadRetiredStubs() {
  let files = []
  try {
    files = readdirSync(POSTS_DIR)
  } catch {
    return []
  }
  const stubs = []
  for (const file of files) {
    if (!file.endsWith('.html')) continue
    const slug = file.replace(/\.html$/, '')
    const html = readFileSync(path.join(POSTS_DIR, file), 'utf8')
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1] || ''
    const self = `https://anthonysdigital.net/blog/posts/${slug}.html`
    const moved = /this article has moved/i.test(html) || /http-equiv="refresh"/i.test(html)
    if (!moved && (!canonical || canonical === self)) continue
    const og = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || ''
    const title = og.replace(/\s+[—–-]\s+Anthony Smith\s*$/i, '').trim()
    stubs.push({ slug, title, canonical })
  }
  return stubs
}

async function loadOpenBlogSignals() {
  let stdout = ''
  try {
    const result = await execFileAsync('gh', [
      'pr', 'list',
      '--repo', REPO,
      '--base', 'gh-pages',
      '--state', 'open',
      '--limit', '50',
      '--json', 'number,title,body,headRefName,files',
    ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 })
    stdout = result.stdout
  } catch (err) {
    const detail = (err.stderr || err.message || '').trim()
    const message = `Could not list open pull requests against gh-pages (${detail}).`
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new BlogError(
        message,
        `## Weekly blog draft failed\n\n${message}\n\nThe generator will not guess whether a topic is already in an open pull request.\n`,
      )
    }
    console.warn(`[Blog] ${message}`)
    console.warn('[Blog] This local run cannot see open blog pull requests.')
    return []
  }

  let prs
  try {
    prs = JSON.parse(stdout || '[]')
  } catch (err) {
    throw new BlogError(`Unparseable response from gh pr list: ${err.message}`)
  }

  const signals = []
  for (const pr of prs) {
    const files = pr.files || []
    const blogFiles = files.filter(file => String(file.path || '').startsWith('blog/'))
    const isBlog = String(pr.headRefName || '').startsWith('blog/')
      || blogFiles.length > 0
      || /topicKey/i.test(pr.body || '')
    if (!isBlog) continue

    const signal = {
      number: pr.number,
      title: String(pr.title || '').replace(/^Blog draft:\s*/i, '').trim(),
      slugs: [],
      topicKeys: [],
      formats: [],
      titles: [],
    }
    if (signal.title) signal.titles.push(signal.title)
    for (const file of blogFiles) {
      const match = String(file.path || '').match(/^blog\/posts\/([^/]+)\.html$/)
      if (match) signal.slugs.push(match[1])
    }
    absorbMarkers(pr.body || '', signal)

    try {
      const diff = await execFileAsync('gh', [
        'pr', 'diff', String(pr.number),
        '--repo', REPO,
      ], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 })
      for (const line of diff.stdout.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue
        const topicKey = line.match(/"topicKey"\s*:\s*"([^"]+)"/)
        if (topicKey) signal.topicKeys.push(topicKey[1])
        const slug = line.match(/"slug"\s*:\s*"([^"]+)"/)
        if (slug) signal.slugs.push(slug[1])
        const title = line.match(/"title"\s*:\s*"([^"]+)"/)
        if (title) signal.titles.push(title[1])
        const format = line.match(/"format"\s*:\s*"([^"]+)"/)
        if (format) signal.formats.push(format[1])
      }
    } catch (err) {
      const detail = (err.stderr || err.message || '').trim()
      const message = `Could not read the diff for pull request #${pr.number} (${detail}).`
      if (process.env.GITHUB_ACTIONS === 'true') throw new BlogError(message, `## Weekly blog draft failed\n\n${message}\n`)
      console.warn(`[Blog] ${message}`)
    }

    signal.slugs = unique(signal.slugs)
    signal.topicKeys = unique(signal.topicKeys)
    signal.formats = unique(signal.formats)
    signal.titles = unique(signal.titles)
    signals.push(signal)
  }
  return signals
}

function absorbMarkers(body, signal) {
  const topicKey = body.match(/topicKey:\s*([a-z0-9-]+)/i)
  if (topicKey) signal.topicKeys.push(topicKey[1])
  for (const match of body.matchAll(/format:\s*([a-z0-9-]+)/gi)) {
    const key = match[1].toLowerCase()
    if (FORMATS.some(format => format.key === key)) signal.formats.push(key)
  }
  const slug = body.match(/slug:\s*([a-z0-9-]+)/i)
  if (slug) signal.slugs.push(slug[1])
  const title = body.match(/title:\s*(.+)/i)
  if (title) {
    const cleaned = title[1].trim().replace(/^["']|["']$/g, '')
    if (cleaned) signal.titles.push(cleaned)
  }
}

function topicBlockedBy(topic, corpus) {
  const phrases = phrasesFor(topic)
  if (corpus.topicKeys.has(topic.key)) {
    return `topicKey "${topic.key}" is already used`
  }
  for (const phrase of phrases) {
    for (const hay of corpus.haystacks) {
      if (haystackHasPhrase(hay.text, phrase)) {
        return `"${phrase}" matches ${hay.label}`
      }
    }
  }
  return ''
}

function buildCorpus(posts, stubs, openPrs) {
  const topicKeys = new Set()
  const slugs = new Set()
  const titles = []
  const haystacks = []

  const add = (text, label) => {
    if (!text) return
    haystacks.push({ text: normalizeHay(text), label })
  }

  for (const post of posts) {
    if (post.topicKey) topicKeys.add(post.topicKey)
    if (post.slug) slugs.add(post.slug)
    if (post.title) titles.push(post.title)
    add(post.title, `published title "${post.title}"`)
    add(post.slug, `published slug ${post.slug}`)
    add(post.topicKey, `published topicKey ${post.topicKey}`)
  }
  for (const stub of stubs) {
    if (stub.slug) slugs.add(stub.slug)
    if (stub.title) titles.push(stub.title)
    add(stub.slug, `retired stub slug ${stub.slug}`)
    add(stub.title, `retired stub "${stub.title}"`)
  }
  for (const pr of openPrs) {
    for (const key of pr.topicKeys) {
      topicKeys.add(key)
      add(key, `open pull request #${pr.number} topicKey ${key}`)
    }
    for (const slug of pr.slugs) {
      slugs.add(slug)
      add(slug, `open pull request #${pr.number} slug ${slug}`)
    }
    for (const title of pr.titles) {
      titles.push(title)
      add(title, `open pull request #${pr.number} title "${title}"`)
    }
  }
  return { topicKeys, slugs, titles, haystacks }
}

function pickTopic(posts, stubs, openPrs) {
  const corpus = buildCorpus(posts, stubs, openPrs)
  const skipped = []
  for (const topic of TOPICS) {
    const reason = topicBlockedBy(topic, corpus)
    if (reason) skipped.push({ key: topic.key, label: topic.label, reason })
    else return { topic, skipped, corpus }
  }
  return { topic: null, skipped, corpus }
}

function recentFormatWindow(posts, openPrs) {
  const items = []
  for (const pr of openPrs) {
    for (const format of pr.formats) items.push({ date: '9999-12-31', format })
  }
  for (const post of posts) {
    const format = postFormat(post)
    if (format) items.push({ date: post.dateISO || '', format })
  }
  items.sort((a, b) => b.date.localeCompare(a.date))
  return items.slice(0, 4).map(item => item.format)
}

function pickFormat(posts, openPrs) {
  const recent = recentFormatWindow(posts, openPrs)
  const recentSet = new Set(recent)
  const lastUsed = new Map()
  const chronological = [...posts].sort((a, b) => (a.dateISO || '').localeCompare(b.dateISO || ''))
  for (const post of chronological) {
    const format = postFormat(post)
    if (format) lastUsed.set(format, post.dateISO || '')
  }
  for (const pr of openPrs) {
    for (const format of pr.formats) lastUsed.set(format, '9999-12-31')
  }

  const candidates = FORMATS.filter(format => !recentSet.has(format.key))
  candidates.sort((a, b) => {
    const left = lastUsed.get(a.key) || ''
    const right = lastUsed.get(b.key) || ''
    if (left !== right) return left.localeCompare(right)
    return FORMATS.indexOf(a) - FORMATS.indexOf(b)
  })
  if (!candidates.length) {
    throw new BlogError(
      'No format is outside the last 4 posts.',
      '## Weekly blog draft failed\n\nEvery format is already in the last 4 posts.\n',
    )
  }
  return { format: candidates[0], recent }
}

function pickOpening(posts, openPrs) {
  const index = (posts.length + openPrs.length) % OPENINGS.length
  return OPENINGS[index]
}

function failTopicsExhausted(skipped) {
  const lines = [
    '## Weekly blog draft did not run',
    '',
    'No unused topic is left. This job does not revisit a topic that already appears in `blog/data/posts.json`, a retired redirect stub, or an open blog pull request.',
    '',
    'Add new topics to `TOPICS` in `scripts/generate-blog-post.mjs`, then run the workflow again.',
    '',
    '### Topics skipped',
    ...skipped.map(item => `- \`${item.key}\` (${item.label}): ${item.reason}`),
    '',
  ]
  const summary = lines.join('\n')
  throw new BlogError(summary, summary)
}

// ── Model ────────────────────────────────────────────────────────────────────

// Extra direction for the AI agent security series. Reader and angle only:
// it does not loosen the accuracy rules below.
const AGENT_SECURITY_FOCUS = `Series: AI agent security
- Readers are engineers adding agents, tool calling, connectors, and MCP servers to production apps. Write as a senior full-stack engineer who ships these features: the controls the application owns, what to check in code review, and what the system refuses.
- Put the boundary in application terms: the tool registry, the approval queue, the token broker, the renderer, the sandbox, the audit log. Do not rely on the model choosing to behave.
- Give at least one concrete control a team could build this week.
- Do not claim that a vendor, model, or product behaves a certain way unless an allowed URL in the same block says so. Do not name real incidents or CVEs.`

// Extra direction for shipped-work case studies. Facts come only from the
// topic.facts list, which was taken from public product and portfolio pages.
function caseStudyFocus(topic) {
  const facts = (topic.facts || []).map((fact, index) => `${index + 1}. ${fact}`).join('\n')
  return `Series: Shipped work
- Readers are recruiters and engineers who want to see how a shipped product was built. Write as the engineer who built this product. Stay inside the allowed facts.
- You may use first person about this product only ("I built", "I chose"). Do not invent other projects, clients, jobs, quotes, or career history.
- Allowed facts (use only these, plus the allowed URLs). Do not add metrics, user counts, revenue, quotes, timelines, or implementation details that are not in this list:
${facts || '(none listed)'}
- If a detail is not in the list, leave it out. Do not guess at databases, queues, model names, latency, accuracy, or user counts.
- Spell the product name Nutrilogix exactly when you name that app. Never write NutriLogix, Nutri Logix, or Nutri-logix.
- Never mention a number of years of experience, including "15 years" or "15+ years".
- Never include real GPS coordinates or real lake names. If you need a location example, say "the lake the angler is on" or use a clearly labeled illustration with a fake name such as "Example Lake".
- Do not write a hire-me or contact call to action in the body. The page template already adds one that links to the contact form.
- Prefer flow or sequence diagrams of the product path. At most one photo. No lake names, GPS coordinates, or personal data in figure labels.`
}

function buildPrompt(topic, format, opening, priorTitles, problems) {
  const priorList = priorTitles.length
    ? priorTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')
    : '(none yet)'
  const urls = topic.citations.map(url => `- ${url}`).join('\n')
  const retry = problems.length
    ? `\n\nYour previous draft was rejected. Fix every problem:\n${problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n')}\n`
    : ''

  return `You are drafting a weekly post for Anthony Smith's public portfolio at https://anthonysdigital.net. The post will be reviewed in a pull request before it is published. Do not invent his biography, his clients, or his career.

Topic: ${topic.label}
What the post has to say: ${topic.summary}
Area: ${topic.area}
Category must be exactly: ${topic.category}

Suggested illustration (label it as an illustration if you use it): ${topic.illustration || 'choose one small feature that fits the topic'}
${topic.area === 'agent-security' ? `${AGENT_SECURITY_FOCUS}\n` : ''}
${topic.area === 'case-study' ? `${caseStudyFocus(topic)}\n` : ''}
Format: ${format.label}
${format.instruction}

Opening, required for the first block:
${opening.instruction}

Do not repeat these published titles, and do not write a title a reader could confuse with one of them:
${priorList}

Accuracy
- Do not invent statistics, counts, percentages, incidents, quotes, company names, CVEs, or payouts.
- Do not write first-person anecdotes, except in a shipped-work post, where first person is allowed only about that product and only using the allowed facts. Never write "I've seen", "I have seen", "in my 15 years", "15+ years", or any number of years, clients, or incidents about Anthony.
- Spell the product name Nutrilogix exactly when you name that app. Never write NutriLogix, Nutri Logix, or Nutri-logix.
- Never include real GPS coordinates or real lake names.
- Do not write a hire-me or contact call to action in the body. The page template already adds one.
- If you name a standard, an RFC, or a vendor behavior, put one of the allowed URLs in that same block. If you are not sure, describe the mechanism with no number and no citation.
- You may use only these URLs, copied exactly:
${urls}
- Label every example as an illustration in the body, unless it is an allowed fact about the shipped product in a case-study post. Do not present a made-up example as something that happened.
- The excerpt is the reader-facing summary. Do not write "illustration", "labeled as", "placeholder", "TODO", "note:", "editor note", "as an AI", or a bracketed instruction in the excerpt.

Defense
- Defensive framing only. Describe the boundary, the check, and what the application refuses.
- Do not provide exploit payloads, bypass strings, attack procedures, or steps someone could follow to compromise a system.
- Code blocks are optional except when the format asks for one. Zero to two blocks. Each block shows a control the application owns. Never an exploit payload and never attack tooling.
- Illustrative paths such as GET /api/orders/4021 are allowed only when the sentence calls them an illustration.

Style
- Vary the shape to fit the format above. Do not use a fixed outline.
- Do not start the title with "How I Test".
- Keep the title at 44 characters or fewer, so the page title plus " — Anthony Smith" stays within 60 characters.
- Do not start the post, or any sentence, with "Most APIs", "Most apps", "Most applications", "Most organizations", or "The most common mistake I see".
- Never use the phrase "case study".
- Short, direct sentences. No em dashes. No exclamation points. No emoji.
- No "in today's fast-paced landscape", no "let's dive in", no "stay tuned".
- Do not open with a dictionary definition.

Output
Respond with valid JSON only. No markdown fences. No text before or after the JSON.
{
  "title": "specific title that does not start with How I Test",
  "excerpt": "plain text, max 160 characters, no HTML",
  "category": "${topic.category}",
  "readTime": "6 min",
  "keywords": "6-10 comma separated keywords",
  "tags": ${JSON.stringify(topic.tags)},
  "figures": [
    { "kind": "sequence", "afterHeading": "exact heading text", "title": "...", "alt": "...", "caption": "...", "actors": ["...", "..."], "steps": [{ "from": "...", "to": "...", "label": "..." }, { "actor": "...", "note": "..." }] }
  ],
  "body": [
    { "type": "paragraph", "text": "..." },
    { "type": "heading", "text": "..." },
    { "type": "list", "items": ["...", "..."] },
    { "type": "orderedlist", "items": ["...", "..."] },
    { "type": "callout", "text": "..." },
    { "type": "code", "lang": "javascript", "code": "..." }
  ]
}

Figures
- Add 1 or 2 in-body figures in "figures". The script draws each diagram from your spec. Do not write SVG, HTML, or image URLs.
- Prefer diagrams that show the control in this post: who proposes, where the application checks, what it refuses.
- kind "sequence": 2 to 5 "actors" (max 18 characters each) and 3 to 8 "steps". A step is { "from", "to", "label" } with label max 46 characters, or a note on one actor { "actor", "note" } with note max 40 characters. Add "refused": true to a step the application refuses.
- kind "flow": 3 to 5 "stages" as { "label" (max 26), "detail" (max 44, optional) }, an optional "gate" (the 0-based index of the stage that checks), and an optional "refuse" (max 40) for what the gate refuses.
- kind "filter": "source", "gate", and "target" (max 26 each) and 3 to 6 "items" as { "label" (max 28), "allowed": true or false }, with at least one allowed and one refused item.
- kind "photo": at most one, only when a photo helps more than a diagram. Give only "afterHeading". The script picks an unused stock photo and writes its alt text and caption.
- Every diagram needs "title" (max 60), "alt" (one or two plain sentences that describe the whole diagram, max 400), and "caption" (max 200) that starts with "Illustration:". Plain text only, no URLs, and no names of real companies or products.
- "afterHeading" is the exact text of a heading in "body". The figure goes at the end of that section. Two figures go under different headings.
- Do not reuse a figure from another post. Use labels from this post's own illustration.

Block rules
- paragraph, callout, heading, list, orderedlist, and code are the only types.
- The first block is a paragraph, a callout, or a list. It is not a heading and not a code block.
- paragraph, callout, and list item text may use <strong>, <em>, <code>, and <a href> inline tags only.
- Do not choose a featured image. The script assigns one from a pool of unused photos.
- A code block needs "lang". Use one of: javascript, typescript, json, bash, python, yaml, sql, http, markdown, plaintext.
- Target roughly 500 to 800 words. Say the thing and stop.${retry}`
}

function messageText(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const text = content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('').trim()
    if (text) return text
  }
  throw new BlogError(
    `Unparseable model response: missing message content. Raw: ${JSON.stringify(data).slice(0, 500)}`,
  )
}

async function callModel(prompt) {
  if (DRY_RUN) throw new BlogError('callModel was used during --dry-run')

  const response = await fetch(XAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new BlogError(`xAI API error ${response.status}: ${err.slice(0, 800)}`)
  }

  let data
  try {
    data = await response.json()
  } catch (err) {
    throw new BlogError(`Unparseable model response: body was not JSON (${err.message})`)
  }

  const raw = messageText(data)
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(repairJson(jsonStr))
  } catch (err) {
    throw new BlogError(`Unparseable model response: ${err.message}\nRaw: ${raw.slice(0, 500)}`)
  }
}

// ── Dry-run fixture ──────────────────────────────────────────────────────────
// Same picker as a real run. The body follows the chosen format and does not
// use the old "How I Test" / mistake / why-it-hides / single ordered list shape.

function fixtureLead(topic, openingKey) {
  if (topic.area === 'case-study') {
    return `I built this as a shipped product. ${topic.summary}`
  }
  const name = topic.short.toLowerCase()
  switch (openingKey) {
    case 'concrete-object':
      return `Look at ${topic.illustration}. That value is untrusted input. ${topic.summary}`
    case 'question':
      return `Where is ${name} enforced, and which input is forbidden from moving that line? ${topic.summary}`
    case 'contrast':
      return `Knowing who the caller is and enforcing ${name} are different checks. One can succeed while the other is absent. ${topic.summary}`
    case 'safe-shape':
      return `The control for ${name} belongs in the application, on a boundary the caller does not write. ${topic.summary}`
    case 'labeled-illustration':
      return `Illustration: ${topic.illustration}. This is an illustration of the shape, not a report of an incident. ${topic.summary}`
    default:
      return topic.summary
  }
}

function fixtureTitle(topic, formatKey) {
  const labels = {
    checklist: 'Checklist',
    mistakes: 'Gaps',
    explainer: 'Explained',
    review: 'Review',
    walkthrough: 'Control',
    essay: 'Constraint',
  }
  const titled = `${topic.short}: ${labels[formatKey] || 'Note'}`
  if (`${titled} — Anthony Smith`.length <= 60) return titled
  if (topic.short.length <= 44) return topic.short
  return topic.short.slice(0, 44).replace(/\s+\S*$/, '').trim()
}

function fixtureExcerpt(topic) {
  if (topic.summary.length <= 160) return topic.summary
  const trimmed = topic.summary.slice(0, 160).replace(/\s+\S*$/, '').trim()
  return trimmed || topic.summary.slice(0, 160).trim()
}

function pointsFor(topic) {
  if (Array.isArray(topic.points) && topic.points.length >= 3) return topic.points.slice(0, 3)
  return [
    `${topic.summary} The rule lives in application code, not in text the caller supplies.`,
    'Choose the allowed values before reading the untrusted part. Anything outside that set is a handled failure, not a guess.',
    'If the check cannot run, stop. Do not fill the gap with a default taken from the input.',
  ]
}

function citationCallout(topic) {
  const url = topic.citations[0]
  if (topic.area === 'case-study') {
    return `The public write-up for this product is <a href="${url}">${url}</a>. This post stays inside the facts listed for the topic.`
  }
  return `Illustration, not a discovered incident. The reference for this topic is <a href="${url}">${url}</a>. This post does not add counts, quotes, or a personal story on top of that page.`
}

function closingLine(topic) {
  if (topic.area === 'case-study') {
    return `That is the part of ${topic.short} this post covers. Details that are not in the public sources are left out.`
  }
  return `${topic.short} holds when the application, not the untrusted input, decides what happens next. The example above is an illustration of that boundary.`
}

function bodyForFormat(topic, formatKey, lead, points) {
  const [first, second, third] = points
  const callout = { type: 'callout', text: citationCallout(topic) }
  const close = { type: 'paragraph', text: closingLine(topic) }
  const intro = [
    { type: 'paragraph', text: lead },
    { type: 'paragraph', text: `Illustration: ${topic.illustration}. The rest of this post is the defensive control for that shape. It is not a procedure for abusing it.` },
  ]

  if (formatKey === 'checklist') {
    return [
      ...intro,
      { type: 'heading', text: 'Checks for one feature' },
      { type: 'list', items: points },
      callout,
      close,
    ]
  }

  if (formatKey === 'mistakes') {
    return [
      ...intro,
      { type: 'heading', text: 'The input gets to decide' },
      { type: 'paragraph', text: first },
      { type: 'heading', text: 'The check sits on the wrong boundary' },
      { type: 'paragraph', text: second },
      { type: 'heading', text: 'A failure turns into a guess' },
      { type: 'paragraph', text: third },
      callout,
      close,
    ]
  }

  if (formatKey === 'explainer') {
    return [
      ...intro,
      { type: 'heading', text: 'What is allowed to decide' },
      { type: 'paragraph', text: first },
      { type: 'heading', text: 'What stays data' },
      { type: 'paragraph', text: second },
      { type: 'paragraph', text: third },
      callout,
      close,
    ]
  }

  if (formatKey === 'review') {
    return [
      ...intro,
      { type: 'heading', text: 'Where it enters' },
      { type: 'paragraph', text: first },
      { type: 'heading', text: 'What the application owns' },
      { type: 'paragraph', text: second },
      { type: 'heading', text: 'What a refusal looks like' },
      { type: 'paragraph', text: third },
      callout,
      close,
    ]
  }

  if (formatKey === 'walkthrough') {
    return [
      ...intro,
      { type: 'heading', text: 'Separate the decision from the input' },
      { type: 'paragraph', text: first },
      { type: 'code', lang: 'js', code: topic.code || DEFAULT_CODE },
      { type: 'heading', text: 'Keep the allowlist in the application' },
      { type: 'paragraph', text: second },
      { type: 'heading', text: 'Refuse a result that does not match' },
      { type: 'paragraph', text: third },
      callout,
      close,
    ]
  }

  return [
    { type: 'paragraph', text: lead },
    { type: 'paragraph', text: first },
    { type: 'paragraph', text: `Illustration: ${topic.illustration}. ${second}` },
    { type: 'paragraph', text: third },
    callout,
    close,
  ]
}

function fixtureFigures(topic) {
  const name = topic.short
  return [
    {
      kind: 'sequence',
      title: `${name}: where the check sits`,
      alt: `Sequence diagram for ${name}. The model proposes a tool call, the application checks it against rules it owns, and only an allowed call reaches the tool. A refused call stops at the application.`,
      caption: `Illustration: the application, not the model, decides whether a call goes through (${name.toLowerCase()}).`,
      actors: ['Model', 'Application', 'Tool'],
      steps: [
        { from: 'Model', to: 'Application', label: 'proposes a tool call' },
        { actor: 'Application', note: `checks: ${name}`.slice(0, 40) },
        { from: 'Application', to: 'Tool', label: 'runs only the allowed call' },
        { from: 'Application', to: 'Model', label: 'refuses anything else', refused: true },
      ],
    },
    {
      kind: 'flow',
      title: `The ${name} check, step by step`.slice(0, 60),
      alt: `Flow diagram for ${name}. Untrusted input reaches an application check. An allowed action continues and is logged with the actor. Anything else is refused before a side effect starts.`,
      caption: 'Illustration: the check runs in application code before any side effect.',
      stages: [
        { label: 'Untrusted input', detail: 'model output or tool data' },
        { label: 'Application check', detail: name.slice(0, 44) },
        { label: 'Allowed action', detail: 'logged with the actor' },
      ],
      gate: 1,
      refuse: 'Refused before any side effect',
    },
  ]
}

function buildFixture(topic, format, opening) {
  const lead = fixtureLead(topic, opening.key)
  return {
    figures: fixtureFigures(topic),
    title: fixtureTitle(topic, format.key),
    excerpt: fixtureExcerpt(topic),
    category: topic.category,
    readTime: '6 min',
    keywords: topic.keywords,
    tags: topic.tags,
    body: bodyForFormat(topic, format.key, lead, pointsFor(topic)),
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

function collectBlocks(post) {
  return post.body || []
}

function proseParts(post) {
  const parts = [post.title || '', post.excerpt || '']
  for (const block of collectBlocks(post)) {
    if (block.type === 'code') continue
    if (typeof block.text === 'string') parts.push(block.text)
    if (Array.isArray(block.items)) parts.push(...block.items)
  }
  return parts
}

function findUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s"'<>)]+/g) || []
}

function normalizeUrl(url) {
  return String(url || '').replace(/[.,;:]+$/, '').replace(/\/$/, '')
}

// ── In-body figures ──────────────────────────────────────────────────────────

function figureProblems(post, usedKeys) {
  const figures = Array.isArray(post.figures) ? post.figures : []
  if (figures.length < 1 || figures.length > 2) return ['Add 1 or 2 figures in "figures".']
  const problems = []
  if (figures.filter(figure => figure?.kind === 'photo').length > 1) problems.push('Use at most one photo figure.')
  const headings = (post.body || []).filter(block => block.type === 'heading').map(block => visible(block.text))
  const anchors = []
  const hashes = new Set()
  figures.forEach((figure, index) => {
    const specProblems = figureSpecProblems(figure, index)
    problems.push(...specProblems)
    const anchor = visible(figure?.afterHeading || '')
    if (anchor && !headings.includes(anchor)) problems.push(`Figure ${index + 1}: afterHeading "${anchor}" is not a heading in body.`)
    if (anchor && anchors.includes(anchor)) problems.push('Put the two figures under different headings.')
    anchors.push(anchor)
    if (figure?.kind !== 'photo' && !/^illustration:/i.test(String(figure?.caption || '').trim())) {
      problems.push(`Figure ${index + 1}: the caption must start with "Illustration:".`)
    }
    if (figure?.kind === 'photo' || specProblems.length) return
    const hash = sha256(Buffer.from(renderDiagramSvg(figure).svg))
    if (usedKeys.has(`sha256:${hash}`) || hashes.has(hash)) problems.push(`Figure ${index + 1} is identical to a figure already used. Use labels from this post.`)
    hashes.add(hash)
  })
  return problems
}

// End of the section under `heading`, or a spread-out default.
function figureInsertIndex(body, heading, ordinal) {
  const headingIndexes = body.map((block, index) => (block.type === 'heading' ? index : -1)).filter(index => index >= 0)
  let start = headingIndexes.find(index => visible(body[index].text) === visible(heading || ''))
  if (start === undefined) {
    if (!headingIndexes.length) return Math.min(body.length, 2 + ordinal * 3)
    start = headingIndexes[Math.min(headingIndexes.length - 1, ordinal === 0 ? 0 : Math.floor(headingIndexes.length / 2))]
  }
  const next = headingIndexes.find(index => index > start)
  return next === undefined ? body.length : next
}

function pickInlinePhoto(topic, usedKeys) {
  const group = topicGroup(topic)
  const unused = INLINE_PHOTO_POOL.filter(item => !usedKeys.has(item.id))
  const ranked = [...unused.filter(item => item.topics.includes(group)), ...unused.filter(item => !item.topics.includes(group))]
  return ranked[0] || null
}

async function materializeInlinePhoto(item, slug, name) {
  const dest = path.join(HERO_DIR, `${name}.webp`)
  const tmp = path.join(HERO_DIR, `.${name}.download`)
  const source = `https://images.unsplash.com/photo-${item.id}?auto=format&fit=crop&w=1200&h=800&q=70&fm=webp`
  const response = await fetch(source, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new BlogError(`In-body photo download failed (${response.status}) for ${source}`)
  writeFileSync(tmp, Buffer.from(await response.arrayBuffer()))
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', tmp, '-vf', "scale='min(1200,iw)':-2", '-c:v', 'libwebp', '-quality', '68', '-compression_level', '6', dest], { timeout: 30000 })
  } catch (err) {
    throw new BlogError(`Could not convert the in-body photo to WebP (${err.message}).`)
  } finally {
    try { unlinkSync(tmp) } catch { /* already removed */ }
  }
  const probe = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', dest], { timeout: 10000 })
  const [width, height] = probe.stdout.trim().split('x').map(Number)
  return { file: dest, src: `/blog/images/${name}.webp`, width, height }
}

// Writes blog/images/<slug>-figN.svg (or .webp for a photo), inserts figure
// blocks into post.body, and records post.inlineImages for posts.json.
async function materializeFigures(post, topic, usedKeys) {
  const used = new Set(usedKeys)
  const placed = []
  post.inlineImages = []
  for (const [index, spec] of post.figures.entries()) {
    const name = `${post.slug}-fig${index + 1}`
    let block
    let record
    if (spec.kind === 'photo') {
      const item = pickInlinePhoto(topic, used)
      if (!item) {
        console.warn('[Blog] No unused in-body photo is left. Skipping the photo figure.')
        continue
      }
      const saved = await materializeInlinePhoto(item, post.slug, name)
      const hash = sha256(readFileSync(saved.file))
      used.add(item.id)
      used.add(`sha256:${hash}`)
      block = { type: 'figure', src: saved.src, alt: item.alt, caption: item.caption, width: saved.width, height: saved.height }
      record = { src: saved.src, kind: 'photo', unsplashId: item.id, sha256: hash, width: saved.width, height: saved.height, alt: item.alt }
    } else {
      const { svg, width, height } = renderDiagramSvg(spec)
      const hash = sha256(Buffer.from(svg))
      if (used.has(`sha256:${hash}`)) throw new BlogError(`Figure ${index + 1} duplicates an existing figure.`)
      used.add(`sha256:${hash}`)
      writeFileSync(path.join(HERO_DIR, `${name}.svg`), svg, 'utf8')
      const src = `/blog/images/${name}.svg`
      block = { type: 'figure', src, alt: visible(spec.alt), caption: visible(spec.caption), width, height }
      record = { src, kind: 'diagram', sha256: hash, width, height, alt: block.alt }
    }
    post.inlineImages.push(record)
    placed.push({ block, at: figureInsertIndex(post.body, spec.afterHeading, index) })
    console.log(`[Blog] figure ${index + 1}: ${record.kind} -> ${record.src}`)
  }
  // Insert from the end so earlier indexes stay valid.
  placed.sort((a, b) => b.at - a.at)
  for (const { block, at } of placed) post.body.splice(at, 0, block)
  if (!post.inlineImages.length) throw new BlogError('The draft has no in-body figure.')
}

function validatePost(post, topic, format, corpus) {
  const problems = []
  const body = collectBlocks(post)
  const title = post.title || ''

  if (!title.trim()) problems.push('Title is missing.')
  if (/^how i test\b/i.test(title.trim())) {
    problems.push('The title must not start with "How I Test".')
  }
  const documentTitle = `${title.trim()} — Anthony Smith`
  if (documentTitle.length > 60) {
    problems.push(`Document title is ${documentTitle.length} characters ("${documentTitle}"). Maximum is 60, including " — Anthony Smith".`)
  }

  const excerpt = visible(post.excerpt || '')
  if (!excerpt) problems.push('Excerpt is missing.')
  if (excerpt.length > 160) problems.push(`Excerpt is ${excerpt.length} characters. Maximum is 160.`)
  if (excerptHasMetaNote(excerpt)) {
    problems.push('Excerpt reads like an editor note. Write a reader-facing summary without illustration labels, placeholders, TODOs, or bracketed instructions.')
  }

  if (!Array.isArray(body) || body.length < 4) {
    problems.push('Body must be an array of at least 4 blocks.')
  }

  const allowedTypes = new Set(['paragraph', 'heading', 'callout', 'list', 'orderedlist', 'code'])
  for (const block of body) {
    if (!allowedTypes.has(block.type)) problems.push(`Unknown block type "${block.type}".`)
  }

  const first = body[0]
  if (first && !['paragraph', 'callout', 'list', 'orderedlist'].includes(first.type)) {
    problems.push('The first block must be a paragraph, a callout, or a list.')
  }

  const openingText = visible(first?.text || (first?.items || [])[0] || '')
  for (const [pattern, message] of BANNED_OPENERS) {
    if (pattern.test(openingText)) problems.push(message)
  }

  for (const part of proseParts(post)) {
    const plain = visible(part)
    for (const [pattern, message] of BANNED_PROSE) {
      if (pattern.test(plain)) problems.push(message)
    }
    if (/\b\d+(?:\.\d+)?\s*%/.test(plain) || /\bstudies show\b/i.test(plain) || /\bresearch shows\b/i.test(plain)) {
      if (!/https?:\/\//.test(part)) {
        problems.push('A percentage or a study claim needs one of the allowed URLs in the same block.')
      }
    }
    if (/\bnutri[\s-]?logix\b/i.test(plain)) {
      const allowed = (plain.match(/\bNutrilogix\b/g) || []).length
      const all = (plain.match(/\bnutri[\s-]?logix\b/gi) || []).length
      if (all !== allowed) {
        problems.push('Spell the product name "Nutrilogix".')
      }
    }
    if (/\b-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/.test(plain) || /\b\d{1,3}\.\d{3,}\s*°/.test(plain)) {
      problems.push('Remove real GPS coordinates. Do not include coordinates in the post.')
    }
  }

  const allowedUrls = new Set(topic.citations.map(normalizeUrl))
  for (const part of [...proseParts(post), ...(body.filter(block => block.type === 'code').map(block => block.code || ''))]) {
    for (const url of findUrls(part)) {
      if (!allowedUrls.has(normalizeUrl(url))) {
        problems.push(`URL is not on the allowed list for this topic: ${normalizeUrl(url)}`)
      }
    }
  }

  const headings = body.filter(block => block.type === 'heading').length
  const lists = body.filter(block => block.type === 'list' || block.type === 'orderedlist')
  const codeBlocks = body.filter(block => block.type === 'code')
  const paragraphs = body.filter(block => block.type === 'paragraph').length

  if (codeBlocks.length > 2) problems.push(`Use at most 2 code blocks, found ${codeBlocks.length}.`)

  if (format.key === 'checklist' && lists.length < 1) {
    problems.push('A checklist post needs at least one list.')
  }
  if (format.key === 'mistakes' && headings < 3) {
    problems.push(`A mistakes post needs at least 3 headings, found ${headings}.`)
  }
  if (format.key === 'explainer' && (headings < 2 || paragraphs < 3)) {
    problems.push('An explainer needs at least 2 headings and 3 paragraphs.')
  }
  if (format.key === 'review' && headings < 2) {
    problems.push('A defensive review needs at least 2 headings.')
  }
  if (format.key === 'walkthrough' && (codeBlocks.length < 1 || headings < 2)) {
    problems.push('A technique walkthrough needs one code block and at least 2 headings.')
  }
  if (format.key === 'essay' && paragraphs < 4) {
    problems.push('An essay needs at least 4 paragraphs.')
  }

  if (corpus.slugs.has(post.slug)) {
    problems.push(`The title slugifies to "${post.slug}", which is already a post, a retired stub, or an open pull request. Choose a different title.`)
  }
  const clash = similarTitle(title, corpus.titles)
  if (clash) problems.push(`The title is too close to "${clash}". Choose a title that is distinct at a glance.`)
  problems.push(...figureProblems(post, corpus.usedImageKeys || new Set()))

  return unique(problems)
}

function finalizePost(post, dateISO) {
  post.date = formatDate(dateISO)
  post.dateISO = dateISO
  post.slug = slugify(post.title || 'untitled')
  return post
}

const CODE_LANG_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  python: 'python',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  sql: 'sql',
  http: 'http',
  https: 'http',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  text: 'plaintext',
  txt: 'plaintext',
  plaintext: 'plaintext',
  plain: 'plaintext',
}

function codeLanguage(lang) {
  const raw = String(lang || 'plaintext').toLowerCase().trim()
  const mapped = CODE_LANG_ALIASES[raw] || raw
  return /^[a-z0-9_+-]+$/.test(mapped) ? mapped : 'plaintext'
}

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
      return `<pre><code class="language-${codeLanguage(block.lang)}">${escapeCode(block.code || '')}</code></pre>`
    case 'figure':
      return figureHtml(block)
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

function documentTitle(title) {
  const suffix = ' — Anthony Smith'
  const full = `${String(title || '').trim()}${suffix}`
  if (full.length <= 60) return full
  const budget = 60 - suffix.length
  let trimmed = String(title || '').trim().slice(0, budget).replace(/\s+\S*$/, '').replace(/[:\-,]\s*$/, '').trim()
  if (!trimmed) trimmed = String(title || '').trim().slice(0, budget).trim()
  return `${trimmed}${suffix}`
}

function documentDescription(excerpt) {
  const text = visible(excerpt)
  if (text.length <= 160) return text
  const trimmed = text.slice(0, 160).replace(/\s+\S*$/, '').trim()
  return trimmed || text.slice(0, 160).trim()
}

function inlineText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function plainBody(post) {
  const parts = []
  for (const block of post.body || []) {
    if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'callout') {
      parts.push(inlineText(block.text))
    } else if (block.type === 'list' || block.type === 'orderedlist') {
      parts.push((block.items || []).map(item => `- ${inlineText(item)}`).join('\n'))
    } else if (block.type === 'code') {
      parts.push(String(block.code || '').replace(/\s+$/, ''))
    } else if (block.type === 'figure') {
      parts.push(`Figure: ${block.alt}`)
    }
  }
  return parts.filter(Boolean).join('\n\n')
}

function buildPostHtml(post) {
  const bodyHtml = (post.body || []).map(renderBlock).join('\n\n')
  const seoTitle = documentTitle(post.title)
  const seoDescription = documentDescription(post.excerpt)
  const pageUrl = `https://anthonysdigital.net/blog/posts/${post.slug}.html`
  const breadcrumbJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://anthonysdigital.net/' },
      { '@type': 'ListItem', position: 2, name: 'Field Notes', item: 'https://anthonysdigital.net/blog/' },
      { '@type': 'ListItem', position: 3, name: post.title, item: pageUrl },
    ],
  }, null, 2).replace(/</g, '\\u003c')

  const shareImage = publicImageUrl(post.image)
  const heroWidth = Number(post.imageWidth) || 0
  const heroHeight = Number(post.imageHeight) || 0
  const heroDims = heroWidth && heroHeight ? ` width="${heroWidth}" height="${heroHeight}"` : ''

  return `<!doctype html>
<html lang="en-US">
<head>
  ${gtmBootstrap()}


  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(seoDescription)}">
  <meta name="keywords" content="${escapeHtml(post.keywords || '')}">
  <meta name="author" content="Anthony Smith">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://anthonysdigital.net/blog/posts/${post.slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://anthonysdigital.net/blog/posts/${post.slug}.html">
  <meta property="og:title" content="${escapeHtml(seoTitle)}">
  <meta property="og:description" content="${escapeHtml(seoDescription)}">
  <meta property="og:image" content="${shareImage}">
  <meta property="og:site_name" content="Anthony Smith — Senior Software Engineer">
  <meta property="article:published_time" content="${post.dateISO}">
  <meta property="article:author" content="Anthony Smith">
  <meta property="article:section" content="${escapeHtml(post.category)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@anthonys1760">
  <meta name="twitter:title" content="${escapeHtml(seoTitle)}">
  <meta name="twitter:description" content="${escapeHtml(seoDescription)}">
  <meta name="twitter:image" content="${shareImage}">

  <title>${escapeHtml(seoTitle)}</title>

  ${blogFontLinks()}
  <link rel="preload" as="image" href="${post.image}" fetchpriority="high">
  <link rel="stylesheet" href="/css/basic.css">
  <link rel="stylesheet" href="/css/layout.css">
  <link rel="stylesheet" href="/css/animate.css">
  <link rel="stylesheet" href="/css/fontawesome.css">
  <link rel="stylesheet" href="/css/brands.css">
  <link rel="stylesheet" href="/css/solid.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/3.7.2/animate.min.css">
  <link rel="stylesheet" href="/css/hero-theme.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#4bffa5">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": "https://anthonysdigital.net/blog/posts/${post.slug}.html"
    },
    "headline": "${escapeHtml(post.title)}",
    "description": "${escapeHtml(seoDescription)}",
    "keywords": "${escapeHtml(post.keywords || '')}",
    "articleSection": "${escapeHtml(post.category)}",
    "image": {
      "@type": "ImageObject",
      "url": "${shareImage}"
    },
    "datePublished": "${post.dateISO}",
    "dateModified": "${post.dateISO}",
    "author": {
      "@id": "https://anthonysdigital.net/#person"
    },
    "publisher": {
      "@id": "https://anthonysdigital.net/#person"
    },
    "url": "https://anthonysdigital.net/blog/posts/${post.slug}.html",
    "isPartOf": {
      "@type": "Blog",
      "name": "Anthony Smith — Field Notes",
      "url": "https://anthonysdigital.net/blog/"
    }
  }
  </script>

  <script type="application/ld+json">
  ${breadcrumbJson}
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
      font-size: 12px;
      color: rgba(255,255,255,0.62);
    }
    .post-title {
      font-size: clamp(30px, 4vw, 40px);
      font-weight: 700;
      color: #fff;
      line-height: 1.3;
      margin: 0 0 20px;
    }
    .post-hero-img {
      width: 100%;
      height: auto;
      background: #111;
      border-radius: 12px;
      margin-bottom: 48px;
      max-height: 420px;
      object-fit: cover;
    }
    .post-byline {
      margin: -4px 0 18px;
      font-size: 0.95rem;
      color: rgba(255,255,255,0.8);
    }
    .post-byline time { color: rgba(255,255,255,0.62); }
    .post-tldr {
      margin: 0 0 28px;
      padding: 12px 16px;
      border-left: 3px solid #4bffa5;
      background: rgba(75,255,165,0.07);
      border-radius: 0 8px 8px 0;
      color: rgba(255,255,255,0.86);
      line-height: 1.6;
      font-size: 0.98rem;
    }
    .post-author,
    .post-cta {
      margin-top: 48px;
      padding: 18px 20px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      background: rgba(255,255,255,0.04);
    }
    .post-author p,
    .post-cta p {
      margin: 0;
      color: rgba(255,255,255,0.78);
      line-height: 1.65;
      font-size: 0.95rem;
    }
    .post-author a,
    .post-cta a { color: #4bffa5; text-decoration: none; }
    .post-author a:hover,
    .post-cta a:hover { text-decoration: underline; }
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
      max-width: 100%;
      white-space: pre;
      box-sizing: border-box;
      margin: 24px 0;
    }
    .post-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.875rem;
      color: #4bffa5;
    }
    .post-body pre code {
      display: block;
      white-space: pre;
      overflow-wrap: normal;
      word-wrap: normal;
      color: #e6edf3;
      background: transparent;
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
${FIGURE_CSS}
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
      .post-title { font-size: clamp(30px, 4vw, 40px); }
      .post-wrap { padding: 130px 18px 80px; }
      .post-body pre { padding: 12px; }
      .post-body pre code { font-size: 13px; }
    }
  </style>
<link rel="stylesheet" href="/css/review-fixes.css">
</head>

<body class="hero-themed">
  <a class="skip" href="#main">Skip to content</a>
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
        <button type="button" class="menu-btn" aria-label="Open menu" aria-expanded="false"><span></span></button>
        <div class="logo hover-masks-logo">
          <a href="/index.html">
            <span class="mask-lnk">Anthony <strong>Smith</strong></span>
          </a>
        </div>
        <div class="top-menu hover-masks">
          <div class="top-menu-nav">
            <div class="menu-topmenu-container">
              <ul class="menu">
                <li class="menu-item"><a href="/index.html">Home</a></li>
                <li class="menu-item"><a href="/about.html">About</a></li>
                <li class="menu-item"><a href="/portfolio.html">Portfolio</a></li>
                <li class="menu-item current-menu-item"><a href="/blog/" aria-current="page">Field Notes</a></li>
                <li class="menu-item"><a href="/contact.html">Contact</a></li>
              </ul>
            </div>
            <div class="top-menu-social" aria-label="Social links">
              <a class="top-menu-social-link" href="https://github.com/anthonys1760?tab=repositories" target="_blank" rel="noopener" aria-label="GitHub">
                <span class="icon fab fa-github"></span><span class="label">GitHub</span>
              </a>
              <a class="top-menu-social-link" href="mailto:anthony.smith1760@gmail.com" aria-label="Email">
                <span class="icon fas fa-envelope"></span><span class="label">Email</span>
              </a>
              <a class="top-menu-social-link" href="https://www.linkedin.com/in/anthony-smith-b1085389" target="_blank" rel="noopener" aria-label="LinkedIn">
                <span class="icon fab fa-linkedin"></span><span class="label">LinkedIn</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="wrapper" id="main">

      <!-- Post Content -->
      <article class="post-wrap">

        <a href="/blog/" class="post-back">&larr; All posts</a>

        <header class="post-header">
          <div class="post-meta">
            <span class="post-category">${escapeHtml(post.category)}</span>
            <span class="post-read">${escapeHtml(post.readTime)} read</span>
          </div>
          <h1 class="post-title">${escapeHtml(post.title)}</h1>
          ${bylineHtml(post)}
          ${tldrHtml(post)}
        </header>

        <img class="post-hero-img" src="${post.image}" alt="${escapeHtml(post.imageAlt || post.title)}"${heroDims} fetchpriority="high">

        <div class="post-body">
          ${bodyHtml}
        </div>

        ${authorBoxHtml()}

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
            <a target="_blank" rel="noopener" href="https://www.linkedin.com/in/anthony-smith-b1085389" aria-label="LinkedIn">
              <span class="icon fab fa-linkedin"></span>
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
  <script src="/js/highlight.min.js"></script>
  <script src="/js/highlight-http.min.js"></script>
  <script src="/js/highlight-blog.js"></script>
  <script src="/js/scripts.js"></script>
  <script src="/js/enhancements.js"></script>

<script
  src="https://callcatch-api-neon.vercel.app/widget.js"
  data-client="portfolio"
  data-api="https://callcatch-api-neon.vercel.app"
  data-theme="dark"
  data-color="#4bffa5"
  data-accent-ink="#071a10"
  data-launcher="circle"
  data-name="Anthony Smith"
  data-greeting="Hi — ask me about Anthony's work, his products, or whether he's open to a role."
  data-note="Answers come from Anthony's approved information."
  data-fallback="Sorry — I can't reach the assistant right now. Please try again in a moment."
  defer
></script>
</body>
</html>`
}
// ── Sitemap update ────────────────────────────────────────────────────────────

function updateSitemap(slug, dateISO) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml')
  let xml = readFileSync(sitemapPath, 'utf8')

  const postUrl = `https://anthonysdigital.net/blog/posts/${slug}.html`

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

function updateLlmsFiles(post) {
  const llmsPath = path.join(ROOT, 'llms.txt')
  const fullPath = path.join(ROOT, 'llms-full.txt')
  const url = `https://anthonysdigital.net/blog/posts/${post.slug}.html`
  const link = `- [${String(post.title).replace(/[\[\]]/g, '')}](${url})`

  let llms = readFileSync(llmsPath, 'utf8')
  if (!llms.includes(url)) {
    const heading = '## API security writing\n'
    const index = llms.indexOf(heading)
    if (index === -1) {
      throw new BlogError('llms.txt is missing the "## API security writing" section.')
    }
    const insertAt = index + heading.length
    llms = `${llms.slice(0, insertAt)}${link}\n${llms.slice(insertAt)}`
    writeFileSync(llmsPath, llms, 'utf8')
    console.log(`[Blog] Added ${url} to llms.txt`)
  } else {
    console.log('[Blog] llms.txt already lists this post, skipping')
  }

  let full = readFileSync(fullPath, 'utf8')
  if (!full.includes(url)) {
    const block = `# ${post.title}\nURL: ${url}\nDate: ${post.dateISO}\n\n${plainBody(post)}\n`
    if (!full.endsWith('\n')) full += '\n'
    if (!full.endsWith('\n\n')) full += '\n'
    writeFileSync(fullPath, `${full}${block}`, 'utf8')
    console.log(`[Blog] Appended ${url} to llms-full.txt`)
  } else {
    console.log('[Blog] llms-full.txt already contains this post, skipping')
  }
}
function renderBlogCard(post, index) {
  const eager = index === 0
  const attrs = [
    'class="blog-card-img"',
    `src="${escapeHtml(post.image)}"`,
    `alt="${escapeHtml(post.imageAlt || post.title)}"`,
  ]
  if (post.imageWidth && post.imageHeight) {
    attrs.push(`width="${Number(post.imageWidth)}"`, `height="${Number(post.imageHeight)}"`)
  }
  if (eager) attrs.push('fetchpriority="high"')
  else attrs.push('loading="lazy"', 'decoding="async"')
  const tags = (post.tags || []).map(tag => `<span class="blog-card-tag">${escapeHtml(tag)}</span>`).join('')
  return `				<a class="blog-card" href="/blog/posts/${post.slug}.html">
					<img ${attrs.join(' ')}>
					<div class="blog-card-body">
						<div class="blog-card-meta">
							<span class="blog-card-category">${escapeHtml(post.category)}</span>
							<span class="blog-card-read">${escapeHtml(post.readTime)} read</span>
						</div>
						<h2 class="blog-card-title">${escapeHtml(post.title)}</h2>
						<div class="blog-card-tags">${tags}</div>
						<p class="blog-card-excerpt">${escapeHtml(post.excerpt)}</p>
						<div class="blog-card-footer">
							<time class="blog-card-date" datetime="${escapeHtml(post.dateISO)}">${escapeHtml(post.date)}</time>
							<span class="blog-card-arrow">Read more<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
						</div>
					</div>
				</a>`
}

function updateBlogIndex(posts) {
  let html = readFileSync(BLOG_INDEX, 'utf8')
  const cards = posts.map(renderBlogCard).join('\n')
  const block = `<!-- BLOG_POSTS:START -->\n${cards}\n\t\t\t\t\t<!-- BLOG_POSTS:END -->`
  if (html.includes('<!-- BLOG_POSTS:START -->') && html.includes('<!-- BLOG_POSTS:END -->')) {
    html = html.replace(/<!-- BLOG_POSTS:START -->[\s\S]*?<!-- BLOG_POSTS:END -->/, block)
  } else {
    const replaced = html.replace(
      /<div id="blog-grid" class="blog-grid">\s*<div class="blog-loading">[\s\S]*?<\/div>\s*<\/div>/,
      `<div id="blog-grid" class="blog-grid">\n\t\t\t\t\t${block}\n\t\t\t\t</div>`,
    )
    if (replaced === html) {
      throw new BlogError('blog/index.html has no BLOG_POSTS markers and no loading placeholder to replace.')
    }
    html = replaced
  }
  const first = posts[0]
  if (first?.image) {
    const preload = `<link rel="preload" as="image" href="${first.image}" fetchpriority="high">`
    if (html.includes('rel="preload" as="image"')) {
      html = html.replace(/<link rel="preload" as="image" href="[^"]*" fetchpriority="high">/, preload)
    } else {
      html = html.replace(
        /(<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">)/,
        `$1\n\t${preload}`,
      )
    }
  }
  writeFileSync(BLOG_INDEX, html, 'utf8')
  console.log(`[Blog] Wrote static list of ${posts.length} posts to blog/index.html`)
}

function toMeta(post) {
  // Strip body from listing JSON. series, topicKey, format, and tags are
  // extra keys the index ignores. format is how the next run avoids the
  // last four shapes.
  const meta = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    readTime: post.readTime,
    date: post.date,
    dateISO: post.dateISO,
    image: post.image,
    imageAlt: post.imageAlt,
  }
  if (post.imageWidth) meta.imageWidth = post.imageWidth
  if (post.imageHeight) meta.imageHeight = post.imageHeight
  if (post.unsplashId) meta.unsplashId = post.unsplashId
  if (post.series) meta.series = post.series
  if (post.topicKey) meta.topicKey = post.topicKey
  if (post.format) meta.format = post.format
  if (Array.isArray(post.tags) && post.tags.length) meta.tags = post.tags
  if (Array.isArray(post.inlineImages) && post.inlineImages.length) meta.inlineImages = post.inlineImages
  return meta
}

function savePosts(posts) {
  writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2) + '\n', 'utf8')
  console.log(`[Blog] Updated posts.json (${posts.length} total)`)
}

function writeRunFile(post, topic, format, opening) {
  const payload = {
    topicKey: topic.key,
    topicLabel: topic.label,
    format: format.key,
    formatLabel: format.label,
    opening: opening.key,
    title: post.title,
    slug: post.slug,
    dateISO: post.dateISO,
    excerpt: post.excerpt,
  }
  writeFileSync(RUN_JSON, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

async function main() {
  requireApiKey()
  mkdirSync(POSTS_DIR, { recursive: true })
  mkdirSync(path.dirname(POSTS_JSON), { recursive: true })

  const posts = loadExistingPosts()
  const stubs = loadRetiredStubs()
  const openPrs = await loadOpenBlogSignals()
  console.log(`[Blog] ${posts.length} existing posts, ${stubs.length} retired stubs, ${openPrs.length} open blog PRs`)
  if (DRY_RUN) console.log(`[Blog] DRY_RUN: fixture only, no xAI call, model would be ${MODEL}`)
  else console.log(`[Blog] model: ${MODEL}`)

  const { topic, skipped } = pickTopic(posts, stubs, openPrs)
  if (skipped.length) {
    for (const item of skipped) console.log(`[Blog] skip ${item.key}: ${item.reason}`)
  }
  if (!topic) failTopicsExhausted(skipped)

  const { format, recent } = pickFormat(posts, openPrs)
  const opening = pickOpening(posts, openPrs)
  const priorTitles = unique([
    ...posts.map(post => post.title),
    ...stubs.map(stub => stub.title),
    ...openPrs.flatMap(pr => pr.titles),
  ])

  console.log(`[Blog] recent formats: ${recent.join(', ') || '(none)'}`)
  console.log(`[Blog] topic: ${topic.label} (${topic.key})`)
  console.log(`[Blog] format: ${format.label} (${format.key})`)
  console.log(`[Blog] opening: ${opening.key}`)

  const dateISO = today()
  const corpus = buildCorpus(posts, stubs, openPrs)
  const pendingImageIds = await pendingDraftImageIds()
  corpus.usedImageKeys = usedImageIds(posts, pendingImageIds)
  let post
  let problems = []

  for (let attempt = 0; attempt < 2; attempt++) {
    if (DRY_RUN) {
      post = buildFixture(topic, format, opening)
    } else {
      post = await callModel(buildPrompt(topic, format, opening, priorTitles, problems))
    }
    enforceVoice(post)
    post.category = topic.category
    post.series = topic.area
    post.topicKey = topic.key
    post.format = format.key
    if (!Array.isArray(post.tags) || !post.tags.length) post.tags = topic.tags
    finalizePost(post, dateISO)
    problems = validatePost(post, topic, format, corpus)
    if (!problems.length || DRY_RUN) break
    console.warn(`[Blog] Draft failed validation, retrying once:\n${problems.map(problem => `- ${problem}`).join('\n')}`)
  }

  if (problems.length) {
    const detail = problems.map(problem => `- ${problem}`).join('\n')
    throw new BlogError(
      `Draft failed validation:\n${detail}`,
      `## Weekly blog draft failed validation\n\nTopic: ${topic.label}\nFormat: ${format.label}\n\n${detail}\n`,
    )
  }

  const chosen = await assignImage(posts, topic, pendingImageIds)
  post.unsplashId = imageId(chosen.image)
  const localHero = await materializeHero(chosen.image, post.slug)
  post.image = localHero.image
  post.imageWidth = localHero.imageWidth
  post.imageHeight = localHero.imageHeight
  post.imageAlt = chosen.imageAlt
  console.log(`[Blog] image: ${post.unsplashId} -> ${post.image} ${post.imageWidth}x${post.imageHeight} (${topicGroup(topic)})`)
  await materializeFigures(post, topic, new Set([...corpus.usedImageKeys, post.unsplashId]))
  delete post.figures

  const htmlPath = path.join(POSTS_DIR, `${post.slug}.html`)
  writeFileSync(htmlPath, buildPostHtml(post), 'utf8')
  console.log(`[Blog] Wrote ${htmlPath}`)

  posts.unshift(toMeta(post))
  savePosts(posts)
  updateBlogIndex(posts)
  updateSitemap(post.slug, post.dateISO)
  updateLlmsFiles(post)
  writeRunFile(post, topic, format, opening)

  const openingText = visible(post.body?.[0]?.text || (post.body?.[0]?.items || [])[0] || '')
  console.log(`[Blog] title: ${post.title}`)
  console.log(`[Blog] opening: ${openingText}`)
  console.log(`[Blog] slug: ${post.slug}`)
  console.log(`[Blog] Done. Files are local until the workflow opens a pull request.`)
  console.log(`[Blog] Preview URL after merge: https://anthonysdigital.net/blog/posts/${post.slug}.html`)

  writeSummary([
    '## Weekly blog draft',
    '',
    `- Topic: ${topic.label} (\`${topic.key}\`)`,
    `- Format: ${format.label} (\`${format.key}\`)`,
    `- Opening: ${opening.key}`,
    `- Title: ${post.title}`,
    `- Slug: ${post.slug}`,
    '',
  ].join('\n'))
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch(err => {
    console.error(`[Blog] ${err.message}`)
    if (err.summary) writeSummary(err.summary)
    else writeSummary(`## Weekly blog draft failed\n\n${err.message}\n`)
    process.exit(1)
  })
}

export {
  FORMATS,
  figureProblems,
  fixtureFigures,
  materializeFigures,
  usedImageIds,
  IMAGE_POOL,
  TOPICS,
  buildCorpus,
  buildPrompt,
  pickFormat,
  pickOpening,
  loadExistingPosts,
  loadOpenBlogSignals,
  loadRetiredStubs,
  pickTopic,
  assignImage,
  pendingDraftImageIds,
  authorBoxHtml,
  hireCtaHtml,
  HIRE_CTA_HREF,
  blogFontLinks,
  bylineHtml,
  deferGtmInHtml,
  imageId,
  imageUrl,
  materializeHero,
  publicImageUrl,
  tldrHtml,
  tldrSentence,
  topicGroup,
  trimBlogFonts,
  updateBlogIndex,
}
