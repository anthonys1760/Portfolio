---
title: "The Code Review Mindset: How to Give and Receive Feedback That Actually Improves Code"
description: "Code reviews are where good engineers become great ones. Here's how to make them collaborative, educational, and ego-free."
date: "2026-04-20"
updated: "2026-11-11"
category: "Engineering"
readTime: "3 min read"
hero: "/blog/images/the-code-review-mindset-how-to-give-and-receive-feedback-tha.webp"
heroAlt: "Two people leaning over one laptop while one points at a list on the screen"
heroWidth: 1600
heroHeight: 1068
---

Teams that treat code reviews as a checkbox exercise ship buggy code and burn engineers out. Teams that treat them as collaborative learning ship better code *and* build stronger engineers. The difference is the mindset, not the tool. How to write the pull request itself, including a clear description and a small diff, lives in [The Pull Request](/blog/the-pull-request-your-most-underutilized-career-growth-tool). This post stays on giving and receiving the review.

## The Two Types of Feedback (And Why You Need Both)

Most engineers conflate two fundamentally different types of feedback: **blocking feedback** (things that must change before merge) and **teaching feedback** (suggestions for improvement that aren't dealbreakers). Mixing these up creates confusion and resentment. When I review code, I explicitly label my comments.

```javascript
// ❌ BLOCKING: This will cause a memory leak in long-running processes
const cache = {};

export function memoize(fn) {
  return (...args) => {
    const key = JSON.stringify(args);
    if (cache[key]) return cache[key];
    cache[key] = fn(...args);
    return cache[key];
  };
}

// ✅ SUGGESTION: Consider using a WeakMap or LRU cache for better memory management
import LRU from 'lru-cache';

const cache = new LRU({ max: 500, ttl: 1000 * 60 * 5 });

export function memoize(fn) {
  return (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}
```

> **Pro tip:** Use prefixes like `blocking:`, `nit:`, or `question:` in your review comments. This single change will eliminate 80% of the friction in your code reviews. The author immediately knows what requires action versus what's optional discussion.

## Ask Questions, Don't Make Demands

The fastest way to make someone defensive is to tell them their code is wrong without understanding their constraints. I've learned to phrase most comments as questions: *"What happens if this API returns null?"* or *"Have you considered using a Set here for O(1) lookups?"* This approach serves two purposes: it makes the author think through edge cases, and it gives them space to explain constraints you might not be aware of. Sometimes the answer is *"Good catch, I'll fix that"* and sometimes it's *"The API contract guarantees non-null, see line 15"*—both are valuable outcomes.

## Review for Architecture First, Style Last

I review PRs in three passes, and the order matters. First pass: architecture and approach. Does this solve the right problem? Are there glaring performance issues or security holes? Second pass: logic and edge cases. Third pass: style and nitpicks. If you comment on indentation before questioning whether the entire approach is sound, you've wasted everyone's time.

- **Pass 1 - Architecture:** Does this belong here? Is the abstraction appropriate? Will this scale?
- **Pass 2 - Correctness:** Edge cases, error handling, race conditions, off-by-one errors
- **Pass 3 - Quality:** Readability, naming, tests, documentation, style consistency
- **Pass 4 - Nitpicks:** Only if you have time and energy, and always marked as non-blocking

## Receiving Feedback: Defend Your Code, Not Your Ego

When someone questions your PR, you have two options: defend the *code* with technical reasoning, or defend your *ego* with emotional reasoning. I've been guilty of the latter more times than I'd like to admit. The trick I use now: wait 10 minutes before responding to any comment that triggers defensiveness. Usually, after that pause, I realize the reviewer has a point. If I still disagree, I respond with data: benchmarks, links to docs, or examples of similar patterns in the codebase.

```typescript
// Reviewer: "Why not use Promise.all here?"
// ❌ Defensive response: "This works fine, we don't need to optimize everything"

// ✅ Technical response with reasoning:
// "Good question. These API calls need to be sequential because 
// each depends on the previous response's data. Here's the flow:"

async function processUserData(userId: string) {
  // Step 1: Get user - needed for step 2
  const user = await fetchUser(userId);
  
  // Step 2: Get permissions - requires user.organizationId from step 1
  const permissions = await fetchPermissions(user.organizationId);
  
  // Step 3: Get resources - filtered by permissions from step 2
  const resources = await fetchResources(permissions.allowedResourceIds);
  
  return { user, permissions, resources };
}

// If they WERE independent, I'd absolutely use Promise.all:
// const [user, settings, preferences] = await Promise.all([
//   fetchUser(userId),
//   fetchSettings(userId),
//   fetchPreferences(userId)
// ]);
```

> **Reality check:** If you find yourself getting defensive about code reviews regularly, that's a signal. Either you're working with jerks (possible), or you're tying your self-worth to your code (more likely). Your code is not you. It's a draft document that gets better with editing.

## The 24-Hour Rule for Big Changes

Here's a rule that's saved me countless hours of rework: if a reviewer suggests a significant architectural change, I don't implement it immediately. I sleep on it. I've found that about 30% of the time, the suggestion doesn't actually fit once I think through all the implications. In those cases, I respond with a detailed explanation of why I'm keeping the current approach. The other 70% of the time, the suggestion is good, and having thought it through means I implement it properly the first time rather than rushing a half-baked version just to appease the reviewer.

Code reviews are the highest-leverage activity in software engineering. They catch bugs, spread knowledge, enforce standards, and mentor junior engineers—all at once. But only if you approach them with the right mindset: collaborative, curious, and focused on the code rather than the coder. Master this, and you'll not only write better code, you'll build better teams.
