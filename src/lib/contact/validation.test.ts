import { describe, expect, it } from "vitest";
import { countUrls, nameContainsUrl, QA_PREFILL, validateContact } from "./validation";

describe("contact validation", () => {
  it("accepts a normal message", () => {
    const result = validateContact({
      name: "  Jordan Lee ",
      email: "jordan@company.com",
      message: "  A role, a timeline, and a link. ",
    });
    expect(result.errors).toEqual({});
    expect(result.name).toBe("Jordan Lee");
    expect(result.message).toBe("A role, a timeline, and a link.");
  });

  it("requires a name, a valid email, and a message", () => {
    const result = validateContact({ name: "J", email: "not-an-email", message: "   " });
    expect(result.errors).toEqual({
      name: "Enter your name.",
      email: "Enter a valid email.",
      message: "Enter a message.",
    });
  });

  it("rejects a name that contains a URL", () => {
    expect(nameContainsUrl("see https://example.com")).toBe(true);
    const result = validateContact({
      name: "Jordan https://example.com",
      email: "jordan@company.com",
      message: "Hello there",
    });
    expect(result.errors.name).toBe("Enter your name.");
  });

  it("rejects messages over 2000 characters", () => {
    const result = validateContact({
      name: "Jordan Lee",
      email: "jordan@company.com",
      message: "a".repeat(2001),
    });
    expect(result.errors.message).toBe("Keep it under 2000 characters.");
  });

  it("strips control characters before checking length", () => {
    const result = validateContact({
      name: "Jo\u0000rdan",
      email: "jordan@company.com",
      message: "Hello\u0007 there",
    });
    expect(result.name).toBe("Jordan");
    expect(result.message).toBe("Hello there");
    expect(result.errors).toEqual({});
  });

  it("counts URLs and keeps the screenshot fixture at 109 characters", () => {
    expect(countUrls("see https://a.test and www.b.test and https://c.test and https://d.test")).toBe(4);
    expect(countUrls("one https://a.test link")).toBe(1);
    expect(QA_PREFILL.message).toHaveLength(109);
  });
});
