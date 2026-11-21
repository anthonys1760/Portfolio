---
title: "A Field-Level Checklist for Mass Assignment and Data Exposure"
description: "Run this on one endpoint: extra fields in the body, a missing write allowlist, and a response that returns the whole record."
date: "2026-08-24"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-mass-assignment-and-excessive-data-exposure.webp"
heroAlt: "A clipboard holding a short form, a pen, and the corner of a laptop on a desk"
heroWidth: 1600
heroHeight: 1068
seriesPrevTitle: "Login Is Not Ownership"
seriesPrevSlug: "how-i-test-for-broken-object-level-authorization"
seriesNextTitle: "JWT Validation Mistakes That Still Ship"
seriesNextSlug: "how-i-test-for-jwt-validation-flaws"
---

Pick one endpoint you can call as yourself, such as `PATCH /api/users/me`. Then run the checks below. This is property-level authorization: the object can be yours and still expose fields you should not read, or accept fields you should not write.

## Extra fields in the body

Send the profile update the screen sends, then add a field the form never includes. `{"email": "new@example.com", "role": "admin"}` is the usual shape. If the user record has a `role`, `balance`, `is_verified`, or internal flag, and the handler copies the JSON onto the model, the extra field is stored. Repeat the same fields on `POST`, `PUT`, and `PATCH`. Those verbs often bind parameters in different code.

## A missing write allowlist

There is often no line that says which keys a caller may set. The framework binds the body because that is the short version. A review sees a normal update. Tests pass because the test uses the same payload as the UI. Compare the `GET` of the same resource with the form: anything that comes back and is not editable is a candidate to try on the write.

Also try a resource you can touch without owning it outright, such as another member of a team. A property check and an object check fail in different places. Object ownership is the subject of [Login Is Not Ownership](/blog/how-i-test-for-broken-object-level-authorization).

## The response returns the whole record

> Closing the write does not close the read. An update can allowlist `email` and `name` and still respond with the full user row: password hash, tokens, soft-delete flags, internal ids, columns joined in from another table. Both directions need an explicit field list. A filter such as `?fields=`, or a GraphQL selection, deserves the same question: can the client name a field the screen never shows?

## Allow the write, shape the read

Define a schema per endpoint. Copy only the writable keys onto the update. Return a serializer or DTO for that operation, not the database row.

```javascript
// Allowlist pattern for update
const userUpdateSchema = {
  email: { type: 'string', writable: true },
  name: { type: 'string', writable: true },
  role: { type: 'string', writable: false },
  balance: { type: 'number', writable: false }
};

function updateUser(req, user) {
  const allowed = Object.keys(userUpdateSchema)
    .filter(k => userUpdateSchema[k].writable);

  const updates = {};
  allowed.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  return db.users.update(user.id, updates);
}
```

If the allowlist is missing, nothing fails at compile time. The feature still works for anyone who only uses the screen.
