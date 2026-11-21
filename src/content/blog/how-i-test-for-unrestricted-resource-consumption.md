---
title: "A Rate-Limit Checklist Beyond the Login Endpoint"
description: "Login limits do not cover search, export, or uploads. A checklist of which routes are expensive, and what a useful limit bounds before the work runs."
date: "2026-09-14"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-unrestricted-resource-consumption.webp"
heroAlt: "An aerial view of a crowded highway interchange with traffic filling every lane"
heroWidth: 1600
heroHeight: 1200
seriesPrevTitle: "When a Valid Session Can Call Admin"
seriesPrevSlug: "how-i-test-for-broken-function-level-authorization"
seriesNextTitle: "What I Inspect When an API Fetches a User-Supplied URL"
seriesNextSlug: "how-i-test-for-server-side-request-forgery"
---

Search, export, and upload are where the bill shows up. A search that scans a large table, an export that builds a PDF in memory, or an image route that resizes a large upload on every request can be unbounded even when login is tightly limited. Rate limiting that exists only to slow password guesses does not cover those routes.

## Which routes are expensive

List operations that do more than a cheap indexed read. External calls, heavy computation, storage, and large result sets qualify. Include public routes. Rate-limit middleware is often skipped when there is no session, and those routes are still work.

## Does a limit exist, and does it run first

For each expensive route, check for a per-user or per-key limit, not only a per-IP limit. Then check whether the limit is evaluated before the upload is processed, the query runs, or the export starts. A counter that increments after the work still pays the cost.

A ceiling of many requests per minute is not enough if each request is itself unbounded. Pagination, a maximum upload size, a timeout on outbound calls, and a cap on search complexity limit the work inside one request. Request count does not.

## What the limit should bound

> IP limits do not contain an authenticated caller. One valid account can spend CPU, memory, and storage without looking like a flood from many addresses. Key the limit on the user or API key, and size it to what that caller is allowed to consume. A free account and a large customer are not the same budget. The budget is CPU, memory, payload size, and downstream cost, not only "how many HTTP calls."

## Work that starts after the response

Jobs, webhook deliveries, and other background work triggered by the request often bypass the HTTP limiter because the response already returned. Count that work against the same identity, or the limit is a number on the wrong timeline.

```javascript
// Apply rate limit before expensive operation
const rateLimitKey = `export:${userId}`;
const limit = await rateLimiter.check(rateLimitKey, {
  max: 10,
  window: '1h'
});

if (!limit.allowed) {
  return res.status(429).json({
    error: 'Rate limit exceeded',
    retryAfter: limit.resetAt
  });
}

// Only now perform the expensive export
const report = await generateReport(userId, params);
```

When this is missing, the API still matches its design. It gets expensive only when a route is used harder than the polite case the load test ran. Adding servers hides that. A 429 with `Retry-After`, applied before the work, makes the cost predictable. Login-specific limits are only one slice of this, which is why the series map points here from [Application Security and OWASP: Start Here](/blog/application-security-and-owasp-best-practices-a-production-e).
