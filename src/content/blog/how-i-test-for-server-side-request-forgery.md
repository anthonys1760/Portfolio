---
title: "What I Inspect When an API Fetches a User-Supplied URL"
description: "A defensive review of avatar, webhook, and import URLs: where the URL is accepted, what the server may fetch, and how allowlists hold up after DNS resolution."
date: "2026-09-21"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-server-side-request-forgery.webp"
heroAlt: "Earth at night seen from orbit, with city lights spread across the dark surface"
heroWidth: 1600
heroHeight: 1066
seriesPrevTitle: "A Rate-Limit Checklist Beyond the Login Endpoint"
seriesPrevSlug: "how-i-test-for-unrestricted-resource-consumption"
seriesNextTitle: "A Production Sweep for Security Misconfiguration"
seriesNextSlug: "how-i-test-for-security-misconfiguration"
---

An avatar URL, a webhook callback, or an import address is a normal feature. The product asks the user where to fetch something, and the server fetches it. The review question is not whether that feature is useful. It is where the URL is accepted, what the server is willing to request, and how those rules hold after DNS resolution and redirects.

This is a defensive walkthrough. It does not describe how to aim a server at an internal target.

## Where a URL enters

List every field, header, or body property the server treats as a URL, URI, or host. Webhook endpoints and image fetchers are the obvious ones. Also look at import jobs, PDF or HTML renderers that load remote stylesheets, and parsers that resolve external references. If the server will open a connection because of that value, it belongs on the list.

## What the server is allowed to fetch

Decide the schemes and hosts before any client is created. HTTP and HTTPS are usually the whole list. An allowlist of partner or CDN hosts beats a denylist of bad ones, because the dangerous destinations are "everything else," including loopback, private ranges, and link-local addresses used by cloud metadata services.

Validate the URL, resolve the name, and validate the address you actually got. A check that only looks at the string can disagree with the connection the client opens. Disable redirect following, or apply the same allowlist to every hop. A permitted host that returns a redirect should not become a tunnel to some other address. If an allowed host can store user-controlled content or redirect anywhere, the allowlist is only as strict as that host.

> Check the destination before the request and again after resolution. The name in the URL and the address that name becomes are both part of the decision. Treat the network around the server as reachable, not as an authorization boundary.

## A check that fails closed

```javascript
const ALLOWED_HOSTS = ['cdn.example.com', 'api.partner.com'];
const BLOCKED_RANGES = ['127.0.0.0/8', '169.254.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

function isUrlSafe(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) return false;
  const resolved = dns.resolve(parsed.hostname);
  if (BLOCKED_RANGES.some(range => ipInRange(resolved, range))) return false;
  return true;
}
```

The client should use that result. It should not follow redirects on its own, and it should not speak schemes other than the ones you allowed. Log the host you resolved, not a raw copy of every internal response body. Unexpected schemes, private addresses, and redirects are reasons to refuse the fetch, not details to return to the caller.

Features like this stay in the product because webhooks and remote content are ordinary. The control belongs next to the fetch, reviewed whenever a new URL field appears. Forgotten routes that still perform a fetch are an inventory problem, covered in [The Routes That Never Made the Inventory](/blog/how-i-test-for-shadow-and-zombie-apis).
