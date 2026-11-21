---
title: "Architecture Decision Records: The Full-Stack Engineer's Secret Weapon"
description: "How to write an architecture decision record, where to keep it, and when to skip it, including a frontend state-management example."
date: "2026-06-15"
updated: "2026-11-11"
category: "Engineering"
readTime: "2 min read"
hero: "/blog/images/architecture-decision-records-the-full-stack-engineers-secre.webp"
heroAlt: "Architecture Decision Records: The Full-Stack Engineer's Secret Weapon"
heroWidth: 1600
heroHeight: 1060
---

An architecture decision record is a short, dated note of a choice: the context, what you picked, and the consequences. It is not a wiki about how the system works. Team how-to pages live in [Documentation Debt](/blog/documentation-debt-why-your-team-moves-slower-than-you-think). A private scratch log of the same decision lives in [The Engineering Journal](/blog/the-engineering-journal-why-writing-about-your-work-makes-yo). This post is only the team record.

## What the record is for

Code shows what the system does now. It does not show which alternatives you rejected, or which constraint forced the choice. An ADR is immutable on purpose. When the context changes, you write a new record that supersedes the old one. You do not quietly rewrite history. That chain is what you want when someone asks why sessions live in Redis, or why a monolith was split.

The format stays small. This is a modified Michael Nygard template:

```markdown
# ADR-015: Use Redis for Session Storage

## Status
Accepted (supersedes ADR-008)

## Context
Our Node.js API currently stores sessions in-memory, which breaks when we scale horizontally. We're adding a second API instance behind a load balancer next sprint. Session data is ~2KB per user, 10K active sessions at peak.

## Decision
We will use Redis for session storage with a 24-hour TTL.

## Consequences

### Positive
- Horizontal scaling works immediately

## Alternatives Considered

### PostgreSQL sessions table
Rejected: Adds load to primary DB, requires active cleanup jobs

### JWT tokens (stateless)
Rejected: Can't invalidate sessions on logout, token size bloats requests

### Sticky sessions
Rejected: Complicates deployments, uneven load distribution
```

> If the note takes a long writing session, it has become a design doc. An ADR captures the decision while the context is still fresh. The design doc can still exist. It is a different file.

## Where the files go

Store them in the repo, in `docs/adr/`, not in a wiki the deploy never sees. They version with the code, they show up in pull requests, and people find them because they are next to the change. In a monorepo, split by area: `docs/adr/backend/`, `docs/adr/frontend/`, `docs/adr/infrastructure/`.

## An example: frontend state

The following is an example of the shape, not a claim that a particular team published this record. It is specific about constraints, which is the part general library comparisons leave out.

```markdown
# ADR-023: Use React Query + Zustand for State Management

## Status
Accepted

## Context
Our React dashboard has three types of state:
1. Server cache (API data): User profiles, analytics data, settings
2. UI state: Modal open/closed, selected filters, sidebar collapsed
3. Form state: Handled by React Hook Form (out of scope)

Current pain: Redux boilerplate is slowing feature development. Engineers spend 40% of PR time on action creators and reducers. We have 12 API endpoints with manual cache invalidation logic that's buggy.

## Decision
Use React Query for server state, Zustand for UI state.

## Consequences

### Positive
- React Query handles caching, refetching, invalidation automatically
- Zustand is 10 lines of code vs 50+ for Redux equivalents
- Bundle size: -45KB (Redux + toolkit + saga removed)
- Onboarding: New engineers productive in hours, not days

### Negative
- Team needs to learn two libraries instead of one
- Existing Redux code needs gradual migration
- Less established patterns than Redux (smaller community)

## Implementation Notes

// Zustand store example
import create from 'zustand'

const useUIStore = create((set) => ({
  sidebarOpen: true,
  selectedFilters: [],
  toggleSidebar: () => set((state) => ({
    sidebarOpen: !state.sidebarOpen
  }))
}))

// React Query usage
const { data, isLoading } = useQuery(
  ['user', userId],
  () => fetchUser(userId),
  { staleTime: 5 * 60 * 1000 }
)
```

The numbers in that sample are part of the example's context section. They show how an ADR names constraints. They are not a measurement from a confirmed project.

## When to write one, and when to skip it

Write one when the choice will still matter later, when more than one person has to live with it, or when you can already hear the future argument. Database, authentication, deployment, API style, state management, and third-party services usually qualify. Skip coding-style preferences a linter can hold, temporary workarounds, choices with no real alternative, and decisions you can reverse in a day.

- Someone is about to add a major dependency.
- The choice crosses teams or services.
- You are explaining the same architectural choice again.
- Security, performance, or cost will be questioned later.
- You are superseding an older decision. Say so in the status line.

## Put it in the same pull request as the change

The record that ships is the one in the pull request that implements the decision. Review sees the code and the why together. A template at `docs/adr/000-template.md`, plus a small script that copies it and numbers the file, makes writing the record easier than skipping it. For how the personal version of a decision differs from this file, see [The Engineering Journal](/blog/the-engineering-journal-why-writing-about-your-work-makes-yo).
