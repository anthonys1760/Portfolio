---
title: "Application Security and OWASP: Start Here"
description: "A map of the API security posts on this site: authorization, tokens, expensive routes, misconfiguration, forgotten routes, and untrusted partner responses."
date: "2026-04-27"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/application-security-and-owasp-best-practices-a-production-e.webp"
heroAlt: "Application Security and OWASP: Start Here"
heroWidth: 1600
heroHeight: 1068
---

This page is the map for the API security posts on this site. Each later article owns one topic. The notes below only say which question that article answers, so this one does not repeat them.

## Who can have this record, this function, or this field

- [Login Is Not Ownership](/blog/how-i-test-for-broken-object-level-authorization) covers a valid session that can still request someone else's object by changing an id.
- [When a Valid Session Can Call Admin](/blog/how-i-test-for-broken-function-level-authorization) covers a valid session that can call a privileged function because the route never checks a permission.
- [A Field-Level Checklist for Mass Assignment and Data Exposure](/blog/how-i-test-for-mass-assignment-and-excessive-data-exposure) covers fields a client should not send, and fields a response should not return.

## Tokens, expensive routes, and fetches

- [JWT Validation Mistakes That Still Ship](/blog/how-i-test-for-jwt-validation-flaws) is about verification, algorithms, expiry, issuer, and audience. Decoding a token is not that check.
- [A Rate-Limit Checklist Beyond the Login Endpoint](/blog/how-i-test-for-unrestricted-resource-consumption) is about search, export, uploads, and other work that login limits never see.
- [What I Inspect When an API Fetches a User-Supplied URL](/blog/how-i-test-for-server-side-request-forgery) is a defensive review of URL fetch features: allowlists, resolution, and redirects.

## What is deployed, and what you accept from partners

- [A Production Sweep for Security Misconfiguration](/blog/how-i-test-for-security-misconfiguration) is the release pass for debug routes, CORS, default credentials, verbose errors, unused methods, and security headers such as `Content-Security-Policy`, `Strict-Transport-Security`, and `X-Content-Type-Options`.
- [The Routes That Never Made the Inventory](/blog/how-i-test-for-shadow-and-zombie-apis) is about undocumented and deprecated paths that still respond.
- [Treat Upstream Responses as Untrusted Input](/blog/how-i-test-for-unsafe-consumption-of-third-party-apis) is about validating partner and webhook payloads before they enter your logic.

## Topics that do not have their own post yet

Injection, across SQL, NoSQL, and command interpreters, is still the habit of treating input as data rather than as part of a query or a command. Parameterized queries and a schema that rejects unexpected types are the practical controls. Cross-site scripting in API-driven frontends, insecure deserialization, and agent or tool-call scoping are not separate articles here yet. When an LLM feature is already in production, the operational side of that work is [AI/LLM Integrations in Production Apps: What They Don't Tell You](/blog/aillm-integrations-in-production-apps-what-they-dont-tell-yo), which is about cost, streaming, and fallbacks rather than tool-call permissions.

Start with the authorization trio if you are deciding what to read first, then tokens, then the sweep. The next article in the series is [Login Is Not Ownership](/blog/how-i-test-for-broken-object-level-authorization).
