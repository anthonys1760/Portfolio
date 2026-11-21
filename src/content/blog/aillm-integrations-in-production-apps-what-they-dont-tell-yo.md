---
title: "AI/LLM Integrations in Production Apps: What They Don't Tell You"
description: "Cost, streaming, prompt versioning, fallbacks, and observability for production LLM features. Do not freeze the design to one token price."
date: "2026-08-10"
updated: "2026-11-11"
category: "AI"
readTime: "3 min read"
hero: "/blog/images/aillm-integrations-in-production-apps-what-they-dont-tell-yo.webp"
heroAlt: "AI/LLM Integrations in Production Apps: What They Don't Tell You"
heroWidth: 1600
heroHeight: 900
---

Adding a model to a product is the easy part. Production is the infrastructure around it: what a request costs, how you stream the response, how you version a prompt, and what you do when the provider fails. The demo does not teach that.

The first surprise is the bill. Vendors publish separate rates for input and output tokens, and those rates change. A conversation that resends a long context on every turn costs more than a short prompt, and a feature people actually use will show up on the invoice. Do not freeze an old rate card into the design.

The response is to **instrument everything** and treat cost as a first-class metric. Track token usage per request, per user, and per feature. Alert when it spikes. Use a smaller model for simpler tasks and reserve a more capable model for harder reasoning. Recheck the vendor's current rates when you choose, because yesterday's price list goes stale.

```typescript
// Track costs in real-time with custom metrics
import { trackMetric } from './monitoring';

async function callLLM(prompt: string, userId: string) {
  const startTime = Date.now();
  
  const response = await openai.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  // Read inputRate and outputRate from the vendor's current price list.
  const cost = (inputTokens * inputRate) + (outputTokens * outputRate);

  await trackMetric({
    metric: 'llm.cost',
    value: cost,
    tags: { userId, model: process.env.LLM_MODEL },
  });

  await trackMetric({
    metric: 'llm.latency',
    value: Date.now() - startTime,
    tags: { userId },
  });

  return response.choices[0].message.content;
}
```

## Streaming Is Non-Negotiable

LLM responses can take 5-15 seconds. That's an eternity in user experience terms. If you're waiting for the full response before showing anything, your users will think your app is broken. **Streaming responses is not optional for production applications.**

```typescript
// Server-side streaming endpoint
export async function POST(req: Request) {
  const { prompt } = await req.json();
  
  const stream = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  const encoder = new TextEncoder();
  
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

## Prompt Versioning and Management

Here's a mistake I see constantly: hardcoding prompts in your application code. When you need to tweak the prompt (and you will), you're redeploying your entire app. Worse, you have no history of what changed or why. Treat prompts like database migrations—version them, store them separately, and make them easy to roll back.

I store prompts in the database with versioning. Each prompt has a key, version number, and the actual template. The application fetches the active version at runtime. This lets product managers iterate on prompts without engineering deploys, and gives you an audit trail when something goes wrong.

```sql
CREATE TABLE prompts (
  id UUID PRIMARY KEY,
  key VARCHAR(255) NOT NULL,
  version INTEGER NOT NULL,
  template TEXT NOT NULL,
  variables JSONB,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  UNIQUE(key, version)
);

CREATE INDEX idx_prompts_active ON prompts(key, is_active) WHERE is_active = true;
```

> **Key insight:** Use a simple templating system for variable interpolation in prompts. I use `{{variableName}}` syntax and replace at runtime. Keep it simple—you don't need a complex DSL.

## Error Handling and Fallbacks

LLM APIs fail. They rate limit, timeout, return malformed responses, or just have bad days. Your error handling needs to be more sophisticated than `try/catch` and showing a generic error message. Implement exponential backoff, circuit breakers, and meaningful fallbacks.

- **Rate limiting:** OpenAI has per-minute token limits. Queue requests and implement backpressure instead of failing immediately.
- **Timeouts:** Set aggressive timeouts (30s max) and fail fast. A slow response is worse than an error message with a retry button.
- **Fallback responses:** For non-critical features, have pre-written fallback content. Better to show something useful than an error.
- **Model fallback:** If the primary model errors, retry once with a fallback model when the feature can tolerate a different answer. Say so in the interface when the fallback is a worse experience.
- **User communication:** Be honest. 'AI is experiencing high demand' is better than 'Something went wrong'.

## Observability Is Everything

You need visibility into your LLM usage that goes beyond basic logging. Track token usage, latency, error rates, and cost per user. But also track *quality metrics*—are users regenerating responses? Editing them heavily? Abandoning the feature? These signals tell you if your prompts are actually working.

> I use a combination of Datadog for metrics and a custom events table for LLM interactions. Every request logs: prompt version used, tokens consumed, latency, model, user feedback (thumbs up/down), and whether the user edited the output. This data is gold for optimization.

The hardest part of production LLM features isn't the integration—it's building the infrastructure to make them reliable, cost-effective, and observable. Start with these patterns, measure everything, and iterate based on real usage data. The companies winning with AI aren't using better models; they're using better infrastructure around those models.
