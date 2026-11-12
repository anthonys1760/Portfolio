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
 * not already used in posts.json. It does not reuse one when the pool is empty.
 */

import { execFile } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { fileURLToPath } from 'url'

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

function topicGroup(topic) {
  const category = String(topic?.category || '').toLowerCase()
  const area = String(topic?.area || '')
  if (area === 'agent-security' || category === 'ai') return 'ai'
  if (area === 'appsec' || category === 'security') return 'security'
  if (category === 'mobile') return 'mobile'
  if (category === 'backend') return 'backend'
  return 'engineering'
}

function usedImageIds(posts) {
  return new Set(posts.map(post => imageId(post.image)).filter(Boolean))
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

// Prefer an unused pool photo in the topic group. If that group is used up,
// take any other unused pool photo. If none remain, fail instead of reusing.
async function assignImage(posts, topic) {
  const used = usedImageIds(posts)
  const group = topicGroup(topic)
  const unused = IMAGE_POOL.filter(item => !used.has(item.id))
  const primary = unused.filter(item => item.topics[0] === group)
  const secondary = unused.filter(item => item.topics[0] !== group && item.topics.includes(group))
  const rest = unused.filter(item => !item.topics.includes(group))
  const candidates = [...primary, ...secondary, ...rest]

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

Format: ${format.label}
${format.instruction}

Opening, required for the first block:
${opening.instruction}

Do not repeat these published titles, and do not write a title a reader could confuse with one of them:
${priorList}

Accuracy
- Do not invent statistics, counts, percentages, incidents, quotes, company names, CVEs, or payouts.
- Do not write first-person anecdotes. Never write "I've seen", "I have seen", "in my 15 years", or any number of years, clients, or incidents about Anthony.
- If you name a standard, an RFC, or a vendor behavior, put one of the allowed URLs in that same block. If you are not sure, describe the mechanism with no number and no citation.
- You may use only these URLs, copied exactly:
${urls}
- Label every example as an illustration in the body. Do not present an illustration as something that happened.
- The excerpt is the reader-facing summary. Do not write "illustration", "labeled as", "placeholder", "TODO", "note:", "editor note", "as an AI", or a bracketed instruction in the excerpt.

Defense
- Defensive framing only. Describe the boundary, the check, and what the application refuses.
- Do not provide exploit payloads, bypass strings, attack procedures, or steps someone could follow to compromise a system.
- Code blocks are optional except when the format asks for one. Zero to two blocks. Each block shows a control the application owns. Never an exploit payload and never attack tooling.
- Illustrative paths such as GET /api/orders/4021 are allowed only when the sentence calls them an illustration.

Style
- Vary the shape to fit the format above. Do not use a fixed outline.
- Do not start the title with "How I Test".
- Do not start the post, or any sentence, with "Most APIs", "Most apps", "Most applications", "Most organizations", or "The most common mistake I see".
- Never use the phrase "case study".
- Short, direct sentences. No em dashes. No exclamation points. No emoji.
- No "in today's fast-paced landscape", no "let's dive in", no "stay tuned".
- Do not open with a dictionary definition.

Output
Respond with valid JSON only. No markdown fences. No text before or after the JSON.
{
  "title": "specific title that does not start with How I Test",
  "excerpt": "plain text, max 200 characters, no HTML",
  "category": "${topic.category}",
  "readTime": "6 min",
  "keywords": "6-10 comma separated keywords",
  "tags": ${JSON.stringify(topic.tags)},
  "body": [
    { "type": "paragraph", "text": "..." },
    { "type": "heading", "text": "..." },
    { "type": "list", "items": ["...", "..."] },
    { "type": "orderedlist", "items": ["...", "..."] },
    { "type": "callout", "text": "..." },
    { "type": "code", "lang": "javascript", "code": "..." }
  ]
}

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
  switch (formatKey) {
    case 'checklist':
      return `A ${topic.short} Checklist for One Feature`
    case 'mistakes':
      return `${topic.short} Gaps to Close Before Shipping`
    case 'explainer':
      return `Where ${topic.short} Sits in the Request`
    case 'review':
      return `A Defensive Pass for ${topic.short}`
    case 'walkthrough':
      return `Implementing a ${topic.short} Control`
    case 'essay':
      return `${topic.short} Is a Design Constraint`
    default:
      return topic.short
  }
}

function fixtureExcerpt(topic) {
  if (topic.summary.length <= 200) return topic.summary
  return `${topic.summary.slice(0, 197).replace(/\s+\S*$/, '').trim()}...`
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
  return `Illustration, not a discovered incident. The reference for this topic is <a href="${url}">${url}</a>. This post does not add counts, quotes, or a personal story on top of that page.`
}

function closingLine(topic) {
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

function buildFixture(topic, format, opening) {
  const lead = fixtureLead(topic, opening.key)
  return {
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

function validatePost(post, topic, format, corpus) {
  const problems = []
  const body = collectBlocks(post)
  const title = post.title || ''

  if (!title.trim()) problems.push('Title is missing.')
  if (/^how i test\b/i.test(title.trim())) {
    problems.push('The title must not start with "How I Test".')
  }
  if (title.length > 110) problems.push(`Title is ${title.length} characters. Keep it under 110.`)

  const excerpt = visible(post.excerpt || '')
  if (!excerpt) problems.push('Excerpt is missing.')
  if (excerpt.length > 200) problems.push(`Excerpt is ${excerpt.length} characters. Maximum is 200.`)
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


  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="description" content="${escapeHtml(post.excerpt)}">
  <meta name="keywords" content="${escapeHtml(post.keywords || '')}">
  <meta name="author" content="Anthony Smith">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://anthonysdigital.net/blog/posts/${post.slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://anthonysdigital.net/blog/posts/${post.slug}.html">
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
      "@id": "https://anthonysdigital.net/blog/posts/${post.slug}.html"
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
      "url": "https://anthonysdigital.net",
      "jobTitle": "Senior Full Stack Engineer & Solutions Architect"
    },
    "publisher": {
      "@type": "Person",
      "name": "Anthony Smith",
      "url": "https://anthonysdigital.net"
    },
    "url": "https://anthonysdigital.net/blog/posts/${post.slug}.html",
    "isPartOf": {
      "@type": "Blog",
      "name": "Anthony Smith — Field Notes",
      "url": "https://anthonysdigital.net/blog/"
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
            <span class="post-date">${escapeHtml(post.date)}</span>
          </div>
          <h1 class="post-title">${escapeHtml(post.title)}</h1>
        </header>

        <img class="post-hero-img" src="${post.image}" alt="${escapeHtml(post.imageAlt || post.title)}" onerror="this.style.display='none'">

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
  <script src="/js/highlight.min.js"></script>
  <script src="/js/highlight-http.min.js"></script>
  <script src="/js/highlight-blog.js"></script>
  <script src="/js/scripts.js"></script>
  <script src="/js/enhancements.js"></script>
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
  if (post.series) meta.series = post.series
  if (post.topicKey) meta.topicKey = post.topicKey
  if (post.format) meta.format = post.format
  if (Array.isArray(post.tags) && post.tags.length) meta.tags = post.tags
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

  const chosen = await assignImage(posts, topic)
  post.image = chosen.image
  post.imageAlt = chosen.imageAlt
  console.log(`[Blog] image: ${imageId(post.image)} (${topicGroup(topic)})`)

  const htmlPath = path.join(POSTS_DIR, `${post.slug}.html`)
  writeFileSync(htmlPath, buildPostHtml(post), 'utf8')
  console.log(`[Blog] Wrote ${htmlPath}`)

  posts.unshift(toMeta(post))
  savePosts(posts)
  updateSitemap(post.slug, post.dateISO)
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

export { IMAGE_POOL, assignImage, imageId, imageUrl, topicGroup }
