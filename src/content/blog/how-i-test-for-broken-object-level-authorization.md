---
title: "Login Is Not Ownership"
description: "A user who can open invoice 4021 can often open 4022. The ownership mistakes that allow it, including treating a UUID as access control."
date: "2026-08-01"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-broken-object-level-authorization.webp"
heroAlt: "An apartment building with many separate balconies and windows, each unit its own"
heroWidth: 1600
heroHeight: 2134
homeKicker: "API1 · BOLA"
seriesPrevTitle: "Application Security and OWASP: Start Here"
seriesPrevSlug: "application-security-and-owasp-best-practices-a-production-e"
seriesNextTitle: "A Field-Level Checklist for Mass Assignment and Data Exposure"
seriesNextSlug: "how-i-test-for-mass-assignment-and-excessive-data-exposure"
---

A user who can load `GET /api/invoices/4021` tries `GET /api/invoices/4022` and receives someone else's invoice. The session token was valid. The record exists. Nothing in the request asked whether invoice 4022 belongs to that user, and nothing in the handler answered.

That gap is broken object level authorization, sometimes called IDOR. Login answered who the caller is. It did not answer whose record this is. The mistakes below are how that second question gets skipped. Function access, where a valid session calls an admin route, is a different problem and is covered in [When a Valid Session Can Call Admin](/blog/how-i-test-for-broken-function-level-authorization).

## Treating a session as ownership

The handler checks that a token is present, then loads whatever id arrived in the path, query, or body. The check and the query live in different layers, so a review can see "this route is authenticated" and stop. Ownership is custom logic. Frameworks ship authentication middleware. They do not know that an invoice belongs to a customer.

## Trusting the screen to hide other ids

Ordinary use never sends a foreign id. The client lists the caller's own invoices and only links those. Reviewers and integration tests then exercise one account that owns every fixture. The API looks correct until the id changes. A `GET` can be locked down while `PATCH` or `DELETE` on the same path uses another handler that forgot the filter. Soft-deleted, draft, and private rows often take a different path and skip the check that the live row got.

## Treating a UUID as a permission

> A UUID is not an authorization control. It makes guessing harder. If a valid id shows up in a shared link, a webhook, a log, or an email, the API still has to decide whether this caller may have this row. Switching from integers to UUIDs only makes the missing check less obvious. Opaque ids also leak from list endpoints and error messages, which is enough for someone who was never supposed to know the id.

## Put the owner on the query

The durable fix is to enforce ownership where the row is loaded, not only in the route. A query that fetches by id also filters by the authenticated user. A miss returns not found, so the response does not reveal that the other invoice exists.

```javascript
// Enforce ownership in the data layer
async function getInvoice(invoiceId, userId) {
  const invoice = await db.invoices.findOne({
    id: invoiceId,
    userId: userId  // Always scope by owner
  });

  if (!invoice) {
    throw new NotFoundError();  // Don't leak existence
  }

  return invoice;
}
```

The same idea has to hold for every verb and every id the handler trusts, including file keys and reference tokens that are not labeled as the resource id. One careful endpoint does not fix the one next to it.
