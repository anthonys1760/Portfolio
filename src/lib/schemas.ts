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
  thumbnailKind: z.enum(["phone", "web"]).default("phone"),
  gradient: z.enum(["castlog", "nutri", "voice", "call", "rogue"]),
  featured: z.boolean().default(false),
  order: z.number().int(),
  year: z.number().int(),
  showYear: z.boolean().default(false),
  role: z.string(),
  platform: z.string(),
  problem: z.object({
    title: z.string(),
    body: z.string(),
  }),
  architecture: z.object({
    title: z.string(),
    body: z.string(),
    caption: z.string().optional(),
    diagram: z.string().optional(),
    diagramMobile: z.string().optional(),
    diagramAlt: z.string().optional(),
    confirmed: z.boolean().default(false),
  }),
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
