import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { entryId, SITE } from "../lib/site";

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog")).sort((a, b) => a.data.title.localeCompare(b.data.title));
  const writing = posts
    .map((post) => `- [${post.data.title}](${SITE}/blog/${entryId(post)})`)
    .join("\n");
  const body = `# Anthony Smith

> Senior Software Engineer with 15+ years building production systems, specializing in application and API security. Open to full-time roles and contract or freelance work. Based in Grand Rapids, Michigan, US.

Knows about application security, API security, the OWASP API Security Top 10, React Native, TypeScript, Supabase, and AI and LLM integrations. CompTIA PenTest+ certified.

## What I do
- [Home](${SITE}/): 15+ years building production systems. React Native, TypeScript and Supabase apps with AI APIs, plus API security testing against the OWASP API Top 10.
- Ships React Native and TypeScript mobile apps on Supabase, including [CastLog](https://castlogapp.com/), [Nutrilogix](https://nutrilogix-ai.com/), and [VoiceLift](https://voicelift.app/).
- [CallCatch](https://callcatch-api-neon.vercel.app/) answers from a business's own website, does not invent a price, and turns unanswered questions into leads. [Rogue River Labs](https://rogueriverlabs.dev/) builds mobile apps and the APIs behind them, and finds where access checks break.
- Open to full-time roles and to contract or freelance work.

## Selected work
- [Projects](${SITE}/projects): CastLog, Nutrilogix, CallCatch, Drawbridge, VoiceLift, and Rogue River Labs.

## About
- [About](${SITE}/about): Senior Software Engineer with 15+ years building production systems, specializing in application and API security. Grand Rapids, Michigan.

## Contact
- [Contact](${SITE}/contact): Open to full-time roles and contract or freelance work. Email anthony.smith1760@gmail.com.

## Products
- [CastLog](https://castlogapp.com/): Voice-first fishing journal. Say the catch and it logs the lake, weather, and moon phase, including offline. iOS is on the App Store, and an Android test is open. [Project page](${SITE}/projects/castlog).
- [Nutrilogix](https://nutrilogix-ai.com/): Log meals from a photo or by voice, with barcode lookup and Apple Health sync. The iOS TestFlight beta is open. [Project page](${SITE}/projects/nutrilogix).
- [VoiceLift](https://voicelift.app/): Voice-first workout logging. Say a set and it is logged, including gym slang, supersets, and partials. [Project page](${SITE}/projects/voicelift).
- [CallCatch](https://callcatch-api-neon.vercel.app/): Answers from a business's own website, does not invent a price, and turns unanswered questions into leads. [Project page](${SITE}/projects/callcatch).
- [Rogue River Labs](https://rogueriverlabs.dev/): Builds mobile apps and the APIs behind them, and finds where access checks break. [Project page](${SITE}/projects/rogue-river-labs).
- [Drawbridge](https://github.com/anthonys1760/drawbridge): Open-source MCP security gateway (Apache-2.0, pre-release). Treats every tool result as untrusted and asks before an agent sends anything out. [Project page](${SITE}/projects/drawbridge). Replay: ${SITE}/drawbridge/replay/.

## Field notes
${writing}

## Profiles
- [LinkedIn](https://www.linkedin.com/in/anthony-smith-b1085389)
- [GitHub](https://github.com/anthonys1760)
- [Dev.to](https://dev.to/anthonys1760)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
