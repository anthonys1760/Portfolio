import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { blogSchema, projectSchema } from "./lib/schemas";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/projects" }),
  schema: projectSchema,
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: blogSchema,
});

export const collections = { projects, blog };
