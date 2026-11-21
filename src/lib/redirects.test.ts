import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const specSources = [
  "/index.html",
  "/about.html",
  "/portfolio.html",
  "/contact.html",
  "/works_creative.html",
  "/contacts_image.html",
  "/blog/index.html",
  "/blog/",
  "/blog/posts/edge-functions-the-future-of-serverless-architecture.html",
  "/blog/posts/mastering-mobile-app-state-management-a-pragmatic-guide.html",
  "/blog/posts/the-engineering-ladder-trap-why-promotion-chasing-hurts-your.html",
  "/blog/posts/:slug.html",
];

describe("vercel redirects", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
    redirects: { source: string; destination: string; statusCode: number }[];
  };

  it("covers every old path in the spec with a 301", () => {
    for (const source of specSources) {
      const rule = config.redirects.find((item) => item.source === source);
      expect(rule, source).toBeTruthy();
      expect(rule?.statusCode).toBe(301);
    }
  });

  it("places retired posts ahead of the generic blog slug rule", () => {
    const index = (source: string) => config.redirects.findIndex((item) => item.source === source);
    const generic = index("/blog/posts/:slug.html");
    expect(index("/blog/posts/edge-functions-the-future-of-serverless-architecture.html")).toBeLessThan(generic);
    expect(index("/blog/posts/mastering-mobile-app-state-management-a-pragmatic-guide.html")).toBeLessThan(generic);
    expect(index("/blog/posts/the-engineering-ladder-trap-why-promotion-chasing-hurts-your.html")).toBeLessThan(generic);
  });

  it("does not send any path to a resume file", () => {
    for (const rule of config.redirects) {
      expect(rule.destination.toLowerCase()).not.toContain("resume");
    }
  });
});
