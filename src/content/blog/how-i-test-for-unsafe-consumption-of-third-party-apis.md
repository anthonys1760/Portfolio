---
title: "Treat Upstream Responses as Untrusted Input"
description: "Payment, map, and webhook responses are still input. Validate their types, bounds, and shape before they reach your own logic."
date: "2026-11-02"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-unsafe-consumption-of-third-party-apis.webp"
heroAlt: "A cashier at a counter using a card reader beside a tablet point-of-sale screen"
heroWidth: 1600
heroHeight: 1068
seriesPrevTitle: "The Routes That Never Made the Inventory"
seriesPrevSlug: "how-i-test-for-shadow-and-zombie-apis"
---

A payment provider, a maps API, or a webhook is on your side of the diagram. The response still has to be validated like user input. A transaction id, a set of coordinates, or a block of customer details will be stored, rendered, or built into a query. The TLS session and the vendor's reputation do not do that validation.

## Why an upstream response is still input

Integration code is reviewed for the happy path: retries, error logs, the fields the documentation promised. Tests stub the partner with a tidy JSON object, so a defensive parser never runs in CI. A signature proves the bytes came from the holder of a key. It does not prove the values fit your types, your lengths, or your business rules. The partner can have a bug, a bad deploy, or a compromised account, and the signature can still be valid.

> A service escapes comments that users type into a form, then inserts HTML that a content API returned. The form field was treated as untrusted. The partner payload was treated as content. The same split shows up when internal queries are parameterized, but a string from an analytics response is concatenated into a query or a file path.

## Follow the field

List every external API, including services owned by another team whose deploys you do not control. For each response field, write down where it goes: a log line, a column, a template, a redirect, a file path, a generated document. Then decide the type, the bounds, and the format before that value is allowed into application logic.

If the contract says "an integer in a range," a string, a negative, or a missing field needs a handled failure, not a guess. When the partner times out, returns an error, or sends an empty body, fail closed. Do not fill the gap with a default that came from the caller. If you cache the response, the checks apply when the cache is written and still apply when it is read, so a stale payload cannot skip a rule you added later.

Logs and error pages need the same pass. Tokens, keys, and personal data from the partner response should be redacted before they are stored or shown.

## Parse into a known shape

```javascript
function parsePaymentResponse(response) {
  const schema = {
    transactionId: { type: 'string', maxLength: 64, pattern: /^[a-zA-Z0-9_-]+$/ },
    amount: { type: 'number', min: 0, max: 1000000 },
    status: { type: 'string', enum: ['pending', 'completed', 'failed'] }
  };

  for (const [field, rules] of Object.entries(schema)) {
    const value = response[field];

    if (typeof value !== rules.type) {
      throw new ValidationError(`Invalid type for ${field}`);
    }

    if (rules.maxLength && value.length > rules.maxLength) {
      throw new ValidationError(`Field ${field} exceeds max length`);
    }

    if (rules.pattern && !rules.pattern.test(value)) {
      throw new ValidationError(`Field ${field} format invalid`);
    }

    if (rules.enum && !rules.enum.includes(value)) {
      throw new ValidationError(`Field ${field} not in allowed values`);
    }
  }

  return response;
}
```

The schema is the point, not the vendor name. Your checks become the weakest partner you trust without a parser. Unexpected types and oversized values should fail that parser the same way a bad form field would. Partner endpoints that never made your own inventory still count, which is [The Routes That Never Made the Inventory](/blog/how-i-test-for-shadow-and-zombie-apis).
