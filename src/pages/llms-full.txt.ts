import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { entryId, SITE } from "../lib/site";

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog")).sort((a, b) => b.data.date.localeCompare(a.data.date));
  const projects = (await getCollection("projects")).sort((a, b) => a.data.order - b.data.order);
  const projectBlock = projects
    .map((project) => {
      const repo = project.data.links.github ? `\nRepo: ${project.data.links.github}` : "";
      const license = project.data.slug === "drawbridge" ? "\nLicense: Apache-2.0" : "";
      return `### ${project.data.title}\n${project.data.summary}\n${SITE}/projects/${project.data.slug}${repo}${license}\n`;
    })
    .join("\n");
  const postBlock = posts
    .map((post) => {
      const body = "body" in post && typeof post.body === "string" ? post.body : post.data.description;
      return `## ${post.data.title}\n${SITE}/blog/${entryId(post)}\n\n${body}\n`;
    })
    .join("\n");
  const text = `# Anthony Smith — full notes

Senior Software Engineer. Application and API security, React Native, TypeScript, Supabase. Grand Rapids, Michigan.
Home: ${SITE}/
About: ${SITE}/about
Projects: ${SITE}/projects
Contact: ${SITE}/contact
Field notes: ${SITE}/blog
Email: anthony.smith1760@gmail.com

# Projects

${projectBlock}

# Field notes

${postBlock}
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
