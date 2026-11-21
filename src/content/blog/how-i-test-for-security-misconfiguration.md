---
title: "A Production Sweep for Security Misconfiguration"
description: "A release sweep for debug routes, open CORS, default credentials, verbose errors, unused HTTP methods, and headers that give away the stack."
date: "2026-09-28"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-security-misconfiguration.webp"
heroAlt: "A close-up of a circuit board covered with chips, capacitors, and solder joints"
heroWidth: 1600
heroHeight: 1068
seriesPrevTitle: "What I Inspect When an API Fetches a User-Supplied URL"
seriesPrevSlug: "how-i-test-for-server-side-request-forgery"
seriesNextTitle: "The Routes That Never Made the Inventory"
seriesNextSlug: "how-i-test-for-shadow-and-zombie-apis"
---

Run this before a release. The questions are about what is still turned on: debug routes, CORS, default credentials, verbose errors, unused verbs, and headers that describe the stack. None of these need a novel bug. They are leftovers.

## Debug and admin routes

Walk the app and record every path the client calls. Then look for routes that are not linked: `/admin`, `/debug`, `/internal`, health checks, and `/.well-known`. A health check that prints versions, or an admin page that assumes a firewall, is still part of the surface if the public host answers. Routes that were never documented are the subject of [The Routes That Never Made the Inventory](/blog/how-i-test-for-shadow-and-zombie-apis).

## Verbose errors

Send malformed JSON, omit a required field, and send an overly long value. The production response should be generic. Stack traces, file paths, SQL, and framework versions are configuration, not helpful UX. The same pass applies to `X-Powered-By` and `Server` headers that advertise the stack.

## CORS and security headers

Note `Access-Control-Allow-Origin`. An allow-any origin is a setting, not a default you have to live with. Confirm `Strict-Transport-Security` and `Content-Security-Policy` are present and match what you meant to ship. Headers are easy to drift when someone later "fixes" a client by loosening them.

## Default credentials and leaked config

Try the sample usernames and passwords that shipped with the framework or the tutorial you copied. Request paths that often hold config, such as `/.env` and `/config.json`. Example files and environment dumps are misconfiguration when they are reachable.

## Verbs you do not implement

On a path you do support, try `OPTIONS`, `TRACE`, `PUT`, and `DELETE`. A method that should not exist sometimes still dispatches. Function-level checks for the verbs you do intend are covered in [When a Valid Session Can Call Admin](/blog/how-i-test-for-broken-function-level-authorization).

## Defaults that moved

> Configuration is not finished at the first deploy. A framework default can change between major versions, so a setting that was safe until you upgraded now needs an explicit choice. Re-run this sweep after a major dependency bump, not only when the app is new. Third-party libraries with insecure defaults belong in the same pass. How those dependencies' responses are handled is separate, in [Treat Upstream Responses as Untrusted Input](/blog/how-i-test-for-unsafe-consumption-of-third-party-apis).

Each item is small, which is why it gets deferred. Together they are the surface you did not mean to publish.
