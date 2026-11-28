import { z } from "astro/zod";

export const projectTags = z.enum([
  "React Native",
  "TypeScript",
  "Supabase",
  "AI",
  "Security",
  "Web",
]);

export const projectSchema = z.object({
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  summary: z.string(),
  outcome: z.string(),
  status: z.string(),
  statusKind: z.enum(["live", "development"]).default("live"),
  tags: z.array(projectTags).min(1),
  stack: z.array(z.string()).min(1),
  thumbnail: z.string(),
  thumbnailAlt: z.string().optional(),
  thumbnailSize: z.tuple([z.number(), z.number()]).optional(),
  thumbnailKind: z.enum(["phone", "web"]).default("phone"),
  gradient: z.enum(["castlog", "nutri", "voice", "call", "rogue", "drawbridge"]),
  featured: z.boolean().default(false),
  spotlight: z.boolean().default(false),
  order: z.number().int(),
  year: z.number().int(),
  showYear: z.boolean().default(false),
  role: z.string(),
  platform: z.string(),
  problem: z.object({
    title: z.string(),
    body: z.string(),
  }),
  layout: z.enum(["standard", "case-study"]).default("standard"),
  architecture: z
    .object({
      title: z.string(),
      body: z.string(),
      caption: z.string().optional(),
      diagram: z.string().optional(),
      diagramMobile: z.string().optional(),
      diagramAlt: z.string().optional(),
      confirmed: z.boolean().default(false),
    })
    .optional(),
  facts: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        sample: z.boolean().default(false),
      }),
    )
    .optional(),
  steps: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
  attacks: z
    .object({
      source: z.string().url(),
      data: z.string(),
      caveat: z.string(),
    })
    .optional(),
  replay: z
    .object({
      src: z.string(),
      poster: z.string(),
      posterAlt: z.string().default(""),
      title: z.string(),
      fullLabel: z.string().default("Open full screen"),
    })
    .optional(),
  gallery: z
    .array(
      z.object({
        src: z.string(),
        alt: z.string(),
        caption: z.string(),
        width: z.number(),
        height: z.number(),
        kind: z.enum(["wide", "phone"]),
      }),
    )
    .optional(),
  resources: z
    .array(
      z.object({
        label: z.string(),
        href: z.string().url().or(z.string().startsWith("/")),
        note: z.string(),
        primary: z.boolean().default(false),
      }),
    )
    .optional(),
  results: z.array(
    z.object({
      label: z.string(),
      body: z.string(),
      placeholder: z.boolean().default(false),
    }),
  ),
  links: z
    .object({
      appStore: z.string().url().optional(),
      playStore: z.string().url().optional(),
      testFlight: z.string().url().optional(),
      androidBeta: z.string().url().optional(),
      website: z.string().url().optional(),
      github: z.string().url().optional(),
      caseStudy: z.string().url().optional(),
      demo: z.string().url().optional(),
      demoLabel: z.string().optional(),
    })
    .default({}),
  screens: z.array(z.string()).optional(),
  next: z.string().optional(),
});

export const blogSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.string(),
  updated: z.string().optional(),
  category: z.string(),
  readTime: z.string().optional(),
  hero: z.string().optional(),
  heroAlt: z.string().optional(),
  heroWidth: z.number().optional(),
  heroHeight: z.number().optional(),
  homeKicker: z.string().optional(),
  seriesPrevTitle: z.string().optional(),
  seriesPrevSlug: z.string().optional(),
  seriesNextTitle: z.string().optional(),
  seriesNextSlug: z.string().optional(),
});
