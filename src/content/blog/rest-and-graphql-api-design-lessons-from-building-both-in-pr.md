---
title: "REST and GraphQL API Design: Lessons from Building Both in Production"
description: "After shipping both REST and GraphQL APIs to millions of users, here's what actually matters when choosing and designing your API layer."
date: "2026-07-20"
updated: "2026-11-11"
category: "Backend"
readTime: "3 min read"
hero: "/blog/images/rest-and-graphql-api-design-lessons-from-building-both-in-pr.webp"
heroAlt: "Labeled network ports on a patch panel, with ethernet cables plugged into a few of them"
heroWidth: 1600
heroHeight: 1068
---

I've built and maintained both REST and GraphQL APIs in production for years. The discourse around which is "better" misses the point entirely. The real question isn't REST vs GraphQL—it's understanding the tradeoffs and knowing when each shines. Here's what I've learned shipping both to production with teams of varying sizes.

## The Real Difference Nobody Talks About

REST and GraphQL aren't just different query syntaxes. They represent fundamentally different contracts between client and server. **REST is resource-oriented**—you're asking for things. **GraphQL is requirement-oriented**—you're describing what you need. This distinction affects everything from caching to versioning to team dynamics.

In REST, the server dictates the shape of responses. In GraphQL, the client does. This sounds like a minor detail, but it changes who owns the complexity. With REST, backend engineers absorb the complexity of creating the right endpoints. With GraphQL, that complexity shifts to the schema design and resolver implementation.

## When REST Actually Wins

REST isn't outdated—it's *predictable*. For public APIs, third-party integrations, or webhook systems, REST is often the better choice. Why? HTTP caching works out of the box. Every developer understands it. Tools like Postman and curl make it trivial to debug. Here's a well-designed REST endpoint that leverages HTTP semantics properly:

```typescript
// Good REST design uses HTTP methods and status codes correctly
app.get('/api/v1/users/:id', async (req, res) => {
  const user = await db.users.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, name: true, createdAt: true }
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Set proper cache headers for GET requests
  res.set('Cache-Control', 'private, max-age=300');
  res.set('ETag', `"${user.id}-${user.updatedAt.getTime()}"`);
  
  return res.json({ data: user });
});

app.patch('/api/v1/users/:id', async (req, res) => {
  // PATCH for partial updates, PUT for full replacement
  const { name, email } = req.body;
  
  try {
    const updated = await db.users.update({
      where: { id: req.params.id },
      data: { name, email },
    });
    
    return res.json({ data: updated });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    throw error;
  }
});
```

> **Key insight:** REST forces you to think in resources and HTTP semantics. This constraint is actually valuable—it prevents bikeshedding and gives you a standard vocabulary. Every engineer knows what a 404 means. Not everyone agrees on what a GraphQL error extension should look like.

## When GraphQL Solves Real Problems

GraphQL shines when you have multiple clients with different data requirements. Mobile apps need less data than web dashboards. Internal tools need different fields than customer-facing apps. With REST, you end up with endpoint sprawl: `/users/basic`, `/users/detailed`, `/users/with-posts`. GraphQL eliminates this.

The other killer feature: **eliminating overfetching and underfetching**. In REST, you either make multiple requests or return too much data. GraphQL lets clients request exactly what they need in one round trip. Here's a practical example:

```typescript
// GraphQL resolver with DataLoader to prevent N+1 queries
import DataLoader from 'dataloader';

const userLoader = new DataLoader(async (userIds) => {
  const users = await db.users.findMany({
    where: { id: { in: userIds } }
  });
  
  // Return in same order as requested IDs
  const userMap = new Map(users.map(u => [u.id, u]));
  return userIds.map(id => userMap.get(id) || null);
});

const resolvers = {
  Query: {
    user: (_, { id }) => userLoader.load(id),
  },
  User: {
    posts: async (user, { limit = 10 }) => {
      return db.posts.findMany({
        where: { authorId: user.id },
        take: limit,
        orderBy: { createdAt: 'desc' }
      });
    },
    // Resolver runs only if client requests this field
    followerCount: async (user) => {
      return db.followers.count({
        where: { followingId: user.id }
      });
    }
  }
};
```

> **Warning:** GraphQL's flexibility is also its biggest footgun. Without proper query complexity analysis and depth limiting, clients can craft queries that bring down your database. Always implement query cost analysis in production—libraries like `graphql-query-complexity` are non-negotiable.

## The Versioning Question

REST versioning is explicit: `/v1/users` vs `/v2/users`. You maintain multiple versions until clients migrate. GraphQL proponents claim you never need versioning because you just add fields and deprecate old ones. In theory, this is true. In practice, I've seen teams struggle with schema bloat and unclear deprecation timelines.

My take: **both approaches require discipline**. With REST, you need a sunset policy for old versions. With GraphQL, you need strict governance around schema changes and clear communication about deprecations. Neither is easier—they're just different types of work.

## Practical Decision Framework

- **Choose REST when:** You're building a public API, need simple HTTP caching, have straightforward CRUD operations, or want maximum tooling compatibility
- **Choose GraphQL when:** You have multiple clients with different data needs, complex nested relationships, or want to avoid endpoint proliferation
- **Use both when:** Your public API is REST but internal services use GraphQL, or you expose GraphQL for web/mobile but REST webhooks for integrations
- **Avoid GraphQL if:** Your team is small, your data model is simple, or you don't have time to invest in proper tooling and monitoring

The best API design isn't about choosing the "right" technology—it's about understanding your constraints. I've seen elegant REST APIs and nightmare GraphQL schemas. The technology matters less than the thought you put into the contract between client and server. Design for your team's strengths, your client's needs, and your operational capabilities. Everything else is just syntax.

## Authorization is a separate decision

REST or GraphQL does not decide who may call a route. Object ownership is [Login Is Not Ownership](/blog/how-i-test-for-broken-object-level-authorization). Function access is [When a Valid Session Can Call Admin](/blog/how-i-test-for-broken-function-level-authorization). Fields a client should not send or receive are [A Field-Level Checklist for Mass Assignment and Data Exposure](/blog/how-i-test-for-mass-assignment-and-excessive-data-exposure).
