---
title: "The First 90 Days: How to Ramp Up in a New Codebase Without Drowning"
description: "Starting a new engineering role? Here's how to navigate unfamiliar codebases, build credibility, and ship meaningful work in your first three months."
date: "2026-07-27"
updated: "2026-07-27"
category: "Engineering"
readTime: "3 min read"
hero: "/blog/images/the-first-90-days-how-to-ramp-up-in-a-new-codebase-without-d.webp"
heroAlt: "The First 90 Days: How to Ramp Up in a New Codebase Without Drowning"
heroWidth: 1600
heroHeight: 1068
---

You've accepted the offer, finished onboarding, and now you're staring at a codebase with 500k+ lines of code, unfamiliar architecture decisions, and a backlog of tickets labeled "good first issue" that are anything but. I've joined five different engineering teams in my career, and the first 90 days are always the hardest—but they're also the most important. How you ramp up sets the tone for your entire tenure. Here's what actually works.

## Week 1-2: Build Your Mental Map

Don't start by reading code top-to-bottom. That's a trap. Instead, trace actual user flows through the system. Pick the most critical feature—user authentication, checkout flow, data sync—and follow a single request from entry point to database and back. Use your debugger. Set breakpoints everywhere. This gives you a mental map of how the pieces connect.

```javascript
// Create a "learning journal" file in your local workspace
// I literally keep a LEARNING.md file that looks like this:

## Auth Flow
- Entry: POST /api/auth/login (src/routes/auth.ts)
- Middleware: validateCredentials() checks against users table
- Session created via Redis (lib/session.ts)
- JWT signed with RS256, 15min expiry
- Refresh token stored in httpOnly cookie

## Questions:
- Why RS256 instead of HS256? (Ask Sarah)
- Where do we handle token refresh? (Found: src/middleware/auth.ts:45)
- What happens if Redis is down? (TODO: trace error path)

## Gotchas:
- Password reset tokens expire in 1hr but UI says 24hrs (bug?)
- Social auth bypasses 2FA check (intentional per Alex)
```

> **Pro tip:** In your first week, schedule 30-minute "code walkthrough" sessions with different team members. Ask them to show you one thing they built recently. You'll learn the codebase *and* build relationships simultaneously.

## Week 3-4: Ship Something Small But Visible

Your first PR shouldn't be a massive refactor or architectural change. It should be something small that touches multiple parts of the system. This forces you to understand testing patterns, deployment pipelines, and code review culture. I look for bugs that require changes in both frontend and backend—fixing these teaches you how the layers communicate.

- Fix a bug that's annoying the team but not critical
- Add missing error handling or logging to an existing feature
- Improve a user-facing error message (requires understanding the full flow)
- Add tests to an under-tested module (you'll learn expected behavior)
- Update documentation that confused you during onboarding

The goal isn't impact—it's *learning the development loop*. How do you run tests locally? What's the code review process? How long do CI/CD pipelines take? What's the deployment schedule? You need this muscle memory before tackling bigger work.

## Week 5-8: Find the Pain Points

By week five, you have enough context to spot problems that insiders have become blind to. Maybe the local development setup takes 45 minutes. Maybe there's no easy way to test payment flows. Maybe the API returns inconsistent error formats. **These observations are gold.** New engineers see the sharp edges that veterans have learned to avoid.

```typescript
// I once joined a team where every engineer had this helper function
// duplicated across multiple files:

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// My "ramp-up project" was creating a shared utilities package:

// lib/utils/json.ts
export function parseJson<T = unknown>(
  input: string,
  fallback: T
): T {
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    logger.warn('JSON parse failed', { input, error });
    return fallback;
  }
}

// Small change, but it:
// 1. Eliminated code duplication
// 2. Added proper logging
// 3. Made types explicit
// 4. Gave me a reason to touch 15+ files and learn the codebase
```

> **Warning:** Don't propose sweeping changes in your first month. Frame your observations as questions: "I noticed we handle errors differently in these three places—is there a reason for that?" You might be missing important context.

## Week 9-12: Own Something End-to-End

By month three, you should ship a feature from design to production. Not a trivial one—something that requires making architectural decisions, coordinating with other teams, and handling edge cases. This is where you prove you're not just ramped up, you're *contributing*. Pick something aligned with team priorities but scoped small enough to finish in 2-3 weeks.

During this phase, I intentionally over-communicate. I write design docs even for medium-sized features. I ask for early feedback on prototypes. I document my decisions in PR descriptions. This isn't just about building trust—it's about learning how the team makes decisions. What trade-offs do they care about? What level of testing is expected? How much documentation is enough?

## The Meta-Skill: Learning How to Learn

The real skill isn't ramping up in *this* codebase—it's getting better at ramping up in *any* codebase. Every new role is a chance to refine your onboarding process. I keep a personal checklist that I update after each job change. What worked? What wasted time? What questions should I have asked earlier?

```markdown
# My Personal Onboarding Checklist

## Week 1
- [ ] Set up local environment and run full test suite
- [ ] Deploy a trivial change to staging
- [ ] Trace 3 critical user flows with debugger
- [ ] Read last 10 post-mortems (learn from past mistakes)
- [ ] Identify the "go-to" person for each system component

## Week 2-4
- [ ] Ship first PR (bug fix or small improvement)
- [ ] Attend on-call shadowing session
- [ ] Review 20+ recent PRs to learn code style
- [ ] Document one thing that confused me during setup

## Week 5-12
- [ ] Propose one developer experience improvement
- [ ] Ship one feature end-to-end
- [ ] Give my first code review with detailed feedback
- [ ] Present something at team show-and-tell
```

The first 90 days are uncomfortable. You'll feel behind. You'll ask obvious questions. You'll accidentally break staging. That's normal. The engineers who ramp up fastest aren't the ones who pretend to know everything—they're the ones who ask good questions, document their learning, and ship incremental value while they're still figuring things out. Three months from now, you'll be the one helping the next new hire navigate the codebase. Make sure you remember what it felt like to be lost.
