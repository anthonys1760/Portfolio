---
title: "Documentation Debt: Why Your Team Moves Slower Than You Think"
description: "What a team should write down so other people can change, deploy, and call the system. Architecture decisions live in a separate post."
date: "2026-06-01"
updated: "2026-11-11"
category: "Engineering"
readTime: "2 min read"
hero: "/blog/images/documentation-debt-why-your-team-moves-slower-than-you-think.webp"
heroAlt: "Documentation Debt: Why Your Team Moves Slower Than You Think"
heroWidth: 1600
heroHeight: 1068
---

Team documentation is how someone other than the author can change a system, deploy it, or explain its contract. When the authentication flow of a service lives only in the code, the next person rebuilds that story from scratch. When a third-party integration's quirks live in one person's head, everyone else waits. When the API contract is not written down, frontend and backend spend the time in meetings instead. That cost is real, and it is not a number I can put on a sprint.

This post is about what the team should keep. Personal notes belong in [The Engineering Journal](/blog/the-engineering-journal-why-writing-about-your-work-makes-yo). Architecture decisions belong in [Architecture Decision Records](/blog/architecture-decision-records-the-full-stack-engineers-secre), not in a second copy of that practice here.

## What is worth writing down

Comments that restate the next line are noise. The test for a page is whether a new teammate would lose time without it. These usually pass that test:

- **Runbooks:** what to do when the service is down, how to roll back, how to debug the failures you have already seen.
- **API contracts:** request and response shapes, error codes, rate limits, authentication.
- **Local setup:** environment variables, dependencies, seeds, and the gotchas that block a first run.
- **Domain rules:** business behavior the code does not make obvious, including regulatory constraints and legacy quirks.
- **Pointers to decisions:** a short link to the ADR when the question is why a choice was made, not how the code runs today.

> **The documentation paradox:** the people who understand a system well enough to document it feel the least need, and the people who need the page cannot write it yet. The page has to be part of the change that introduces the behavior, or it does not get written.

## Keep it in the repository

The copy that stays current lives next to the code and is reviewed with it. One way to force API docs to move with the route is to generate them from the same schema the handler validates. A feature branch updates that schema or the checklist fails.

```typescript
// routes/users.ts
import { z } from 'zod';
import { createRoute } from '../lib/route-factory';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(['admin', 'user', 'viewer'])
});

export const createUser = createRoute({
  method: 'POST',
  path: '/api/users',
  schema: CreateUserSchema,
  description: 'Creates a new user account. Requires admin role.',
  exampleRequest: {
    email: 'jane@example.com',
    name: 'Jane Doe',
    role: 'user'
  },
  exampleResponse: {
    id: 'usr_123',
    email: 'jane@example.com',
    name: 'Jane Doe',
    role: 'user',
    createdAt: '2024-01-15T10:30:00Z'
  },
  handler: async (req, res) => {
    // Implementation here
  }
});

// scripts/generate-api-docs.ts
import { routes } from '../routes';
import fs from 'fs';

function generateMarkdown(routes: Route[]) {
  let md = '# API Documentation\n\n';

  routes.forEach(route => {
    md += `## ${route.method} ${route.path}\n\n`;
    md += `${route.description}\n\n`;
    md += `**Request Body:**\n\`\`\`json\n${JSON.stringify(route.exampleRequest, null, 2)}\n\`\`\`\n\n`;
    md += `**Response:**\n\`\`\`json\n${JSON.stringify(route.exampleResponse, null, 2)}\n\`\`\`\n\n`;
  });

  return md;
}

fs.writeFileSync('./docs/API.md', generateMarkdown(routes));
```

The markdown is a build product. When the route changes, the contract changes with it. There is no separate wiki page to forget.

## Decisions are a different document

An ADR captures why a choice was made, in a form you do not edit in place when you change your mind. You write a new record that supersedes the old one. The template, where to store the files, and when to skip one are all in [Architecture Decision Records](/blog/architecture-decision-records-the-full-stack-engineers-secre). A team doc should link the record. It should not restate the whole method.

## Make the missing page part of review

Treat a missing runbook or contract like a missing test when you review. Put the docs in the repo so a pull request can show the diff. A short update is more useful than a perfect page that waits for a writing week. Timebox it, ship it, and fix it in the next change that touches that code. How to talk about that in the review itself is [The Code Review Mindset](/blog/the-code-review-mindset-how-to-give-and-receive-feedback-tha).
