# anthonysdigital.net

Astro, React islands, and TypeScript. The live site stays on `gh-pages` until this branch is reviewed and merged. Do not change DNS or the root `CNAME`.

## Scripts

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

`npm run preview` serves the production build at http://127.0.0.1:4321.

## Contact form

`POST /api/contact` is the only dynamic API. `/contact` is server-rendered so the signed render timestamp stays fresh and a no-JS submit can come back as HTML. `/projects` is server-rendered so `?tag=` filters the grid, the active chip, and the count without JavaScript. Every other page is static.

`CONTACT_DELIVERY` is `resend` or `stub`. **Stub is the default** and does not send mail. Resend is the approved sender. Set it only after the keys exist:

- `RESEND_API_KEY`
- `CONTACT_FROM_EMAIL` — the sending address will be on a verified Resend subdomain, for example `contact@mail.anthonysdigital.net`
- `CONTACT_TO_EMAIL`

The visitor's validated email is `reply_to`. There is no auto-reply. On a Vercel preview deploy, a real send prefixes the subject with `[preview]`.

Also set, for Production and Preview, and never commit them:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CONTACT_SECRET` (32 bytes or more)
- `IP_HASH_SALT`

The rate limit is an Upstash sliding window: 3 per 10 minutes and 10 per 24 hours, keyed on a salted SHA-256 of the IP. Production has no in-memory fallback. A missing Redis or secret in production returns the error state (503). Locally, without Redis, the rate limit is skipped and nonces stay in memory so the form can be tried.

A challenge is issued on a honeypot hit, a submit under 3 seconds after render, or a message with more than 3 URLs. The token is an HMAC-SHA256 over the answer, a 10-minute expiry, and a single-use nonce. Logs record an outcome category only. They do not include the message or an email address.

Copy `.env.example` to `.env` for local names. Leave the values empty to stay on the stub.

### Contact states without sending mail

Outside production (`VERCEL_ENV` unset locally, or `preview`), open:

- `/contact`
- `/contact?state=success`
- `/contact?state=error`
- `/contact?state=rate`
- `/contact?state=spam`

Production ignores `?state=`.

## What is not on this site

There is no resume, no resume link, and no resume command. Project thumbnails and the CastLog media stage stay labeled placeholders. The CastLog architecture diagram is omitted until its components and AI providers are confirmed. GitHub and the CastLog case study are dashed labels, not links.
