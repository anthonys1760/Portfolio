import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import vercel from "@astrojs/vercel";

const retired = {
  "/blog/posts/edge-functions-the-future-of-serverless-architecture.html": "/blog",
  "/blog/posts/mastering-mobile-app-state-management-a-pragmatic-guide.html":
    "/blog/react-native-mobile-architecture-lessons-from-production",
  "/blog/posts/the-engineering-ladder-trap-why-promotion-chasing-hurts-your.html":
    "/blog/the-myth-of-the-10x-engineer-what-actually-makes-someone-sen",
};

export default defineConfig({
  site: "https://anthonysdigital.net",
  output: "static",
  adapter: vercel(),
  trailingSlash: "never",
  integrations: [
    react(),
    mdx(),
    sitemap({
      filter: (page) => !page.includes("/404"),
      customPages: ["https://anthonysdigital.net/projects"],
    }),
  ],
  redirects: {
    "/index.html": "/",
    "/about.html": "/about",
    "/portfolio.html": "/projects",
    "/contact.html": "/contact",
    "/works_creative.html": "/projects",
    "/contacts_image.html": "/contact",
    "/blog/index.html": "/blog",
    ...retired,
    "/blog/posts/[slug].html": "/blog/[slug]",
  },
});
