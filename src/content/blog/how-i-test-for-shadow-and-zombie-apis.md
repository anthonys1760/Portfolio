---
title: "The Routes That Never Made the Inventory"
description: "Deprecated and undocumented routes often still answer. How they appear while shipping, and how to keep an inventory that matches what is actually deployed."
date: "2026-10-05"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-shadow-and-zombie-apis.webp"
heroAlt: "A long empty office hallway lined with glass-walled rooms and no one in sight"
heroWidth: 1600
heroHeight: 1068
seriesPrevTitle: "A Production Sweep for Security Misconfiguration"
seriesPrevSlug: "how-i-test-for-security-misconfiguration"
seriesNextTitle: "Treat Upstream Responses as Untrusted Input"
seriesNextSlug: "how-i-test-for-unsafe-consumption-of-third-party-apis"
---

`/api/v2/users` requires a token. `/api/v1/users` still returns the same records and does not. The v1 route was the previous contract. Shipping v2 did not remove it. That responding leftover is a zombie API. A route that was never written down, and still answers, is a shadow API.

Both exist because shipping is append-only unless someone makes removal a step. A feature branch adds a path. A rewrite adds a version. An internal admin route is left in place because a load balancer was supposed to hide it. Documentation is updated later, or once, and then the code moves on. Gateways route traffic. They do not, by themselves, produce a list of every process behind them.

## How a route falls out of the inventory

The people who added a path know that path. They do not automatically know a path from another team or from a previous version. Code review looks at the diff, not at a listener that was already deployed. A deprecation note in a doc is not the same as a route that returns 410 and is gone from the gateway. If the old code is deployed and the path resolves, it is still part of the product.

Old hostnames, acquired products, and renamed services linger in DNS the same way. Debug and health routes that were meant to stay internal show up here too. Those settings are the sweep in [A Production Sweep for Security Misconfiguration](/blog/how-i-test-for-security-misconfiguration).

## What a living inventory has to match

Build the list from what responds, not only from the OpenAPI file. Capture traffic from ordinary use, then compare that set with the spec and the gateway. A path that responds and is undocumented is shadow. A path marked deprecated that still accepts requests is a zombie.

For each of those, record who it is for, whether it authenticates, whether it is rate limited, and whether it is supposed to exist. Old versions often missed the controls that were added later. An export or admin function on a forgotten path is the same authorization problem as on a current path, covered in [When a Valid Session Can Call Admin](/blog/how-i-test-for-broken-function-level-authorization).

> Versioning is not isolation. Deploying `/v2/` does not turn off `/v1/`. Decommissioning means taking the route off the gateway, refusing the traffic, and deleting the deployed handler. A document that says "deprecated" does not do that.

Tie the inventory to deploy, so a route has to be listed to be routed, and a retired route has to be removed in the same change that replaces it. Security review can only cover the surface someone can name.
