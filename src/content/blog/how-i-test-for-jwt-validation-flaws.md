---
title: "JWT Validation Mistakes That Still Ship"
description: "Decoding a token is not verification. JWT mistakes that still ship: unsigned tokens, skipped expiry, and algorithm mixups."
date: "2026-08-31"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-jwt-validation-flaws.webp"
heroAlt: "JWT Validation Mistakes That Still Ship"
heroWidth: 1600
heroHeight: 1068
homeKicker: "auth · JWT"
seriesPrevTitle: "A Field-Level Checklist for Mass Assignment and Data Exposure"
seriesPrevSlug: "how-i-test-for-mass-assignment-and-excessive-data-exposure"
seriesNextTitle: "When a Valid Session Can Call Admin"
seriesNextSlug: "how-i-test-for-broken-function-level-authorization"
---

Decoding a JWT is not the same as verifying it. Any string of three base64 segments separated by periods will decode. No secret is required. An API that decodes the payload, reads `sub` or `user_id`, and loads that user has not checked that this system signed the token.

Libraries make that split easy. Decode works in development. The claims look right. Nothing errors. Verification is a different function, and it is easy to never call it. The mistakes below are the ones that still ship, with the check that should reject each one.

## Trusting claims from an unverified payload

The signature exists so the payload cannot be swapped. If the application never compares it to the secret or public key, a change to `sub`, `email`, or a role claim is just another decoded field. Do not read claims until verification has succeeded. Until then the caller controls the whole token body.

> A token that parses is not a token you can trust. Parsing succeeds when the signature is wrong, missing, or never checked.

## Honoring `alg: none`

Some libraries skip verification when the header says `none`, including a token that keeps the trailing period and drops the signature. The defensive check is to pass an explicit allowlist of algorithms, such as `HS256` only, and to reject `none`. Do not let the token choose the algorithm from a default that includes unsigned tokens.

## Using one key for two algorithms

If the API signs with RS256, a confused verifier may accept a token whose header says HS256 and whose signature was produced with the public key as an HMAC secret. The server then uses the same key material for two different meanings. Pin the algorithm you issue. Do not verify HMAC with the RSA public key.

## Skipping expiry, issuer, and audience

A signature check without `exp` accepts a token forever, and removing `exp` should not make the token more valid. `iss` and `aud` tie the token to a specific issuer and client. If they are not checked, a token from another system that happens to share key material still passes. Set a short lifetime on access tokens, reject expired tokens, and pass issuer and audience into the verify call.

## Call verify, and tell it the rules

```javascript
const jwt = require('jsonwebtoken');

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'api.example.com',
      audience: 'web-client'
    });
    return decoded;
  } catch (err) {
    throw new Error('Invalid token');
  }
}
```

Store the secret outside the repo and rotate it. The failure mode of a decode-only middleware is silence: the API behaves like a careful one until a claim changes and nobody rejects it. The same authentication topic, from the series map, starts at [Application Security and OWASP: Start Here](/blog/application-security-and-owasp-best-practices-a-production-e).
