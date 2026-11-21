---
title: "When a Valid Session Can Call Admin"
description: "Object access and function access are different checks. This one is a logged-in user calling an admin route that never asks about permission."
date: "2026-09-07"
updated: "2026-11-11"
category: "Security"
readTime: "2 min read"
hero: "/blog/images/how-i-test-for-broken-function-level-authorization.webp"
heroAlt: "A hand holding a phone with a smart-lock app next to a lock on a white door"
heroWidth: 1600
heroHeight: 1068
homeKicker: "API5 · function-level auth"
seriesPrevTitle: "JWT Validation Mistakes That Still Ship"
seriesPrevSlug: "how-i-test-for-jwt-validation-flaws"
seriesNextTitle: "A Rate-Limit Checklist Beyond the Login Endpoint"
seriesNextSlug: "how-i-test-for-unrestricted-resource-consumption"
---

Object access asks whether this user may have this record. That question is [Login Is Not Ownership](/blog/how-i-test-for-broken-object-level-authorization). Function access asks something else: may this user call this operation at all?

A logged-in user opens `POST /api/users` or `DELETE /api/users/:id` because the route exists. Authentication middleware already ran. The handler never asks whether this session is allowed to create users or delete them. The UI never showed the button, so the path looks unused. The route still runs.

## What "protected" often means

A decorator, a guard, or a middleware checks for a session and the code reads as protected. The missing piece is the comparison between this user's permissions and what the function requires. Admin, export, approval, configuration, and other people's resources are the functions to list. Try each one with a low-privilege session, and try the verbs the screen does not use. A 200 or 201 where you expected 403 means the action ran. Some handlers fail open and return a generic success after doing the privileged work.

Watch for a `role` field in the body or query that the server treats as authority rather than as a label. Watch for a pair of routes that disagree: `GET /api/users` limited to admins, `GET /api/users/export` returning the same data without that check. Also call the function with no session at all. A missing user is sometimes treated as "nothing to check" instead of as anonymous.

## A role is not a permission

> Checking `admin` couples every sensitive function to a job title. A new `moderator` or `support` role means finding every admin branch. It also hides bugs: a tester who only uses an admin account will never notice that support can call the same function. Name the permission the function needs, such as `users:create` or `can_delete_users`, and test with the lowest privilege that should be refused.

## One module that maps functions to permissions

Authentication can sit at the edge of the request. Authorization has to sit on the decision. Put the required permission on the route and enforce it in one helper, so a new admin function cannot ship with only a login check.

```javascript
// Authorization middleware that checks specific permissions
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Apply to sensitive routes
app.post('/api/users',
  requirePermission('users:create'),
  createUserHandler
);

app.delete('/api/users/:id',
  requirePermission('users:delete'),
  deleteUserHandler
);
```

Frameworks hand you the session check. The permission map is yours. If it is missing, the happy path still works, because the people using the admin screen really are admins.
