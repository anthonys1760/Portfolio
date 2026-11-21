import { z } from "astro/zod";

const URL_IN_TEXT = /https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi;

export function stripControls(value: string, allowNewlines: boolean): string {
  const pattern = allowNewlines
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
    : /[\u0000-\u001F\u007F]/g;
  return value.replace(pattern, "");
}

export function countUrls(message: string): number {
  return message.match(URL_IN_TEXT)?.length ?? 0;
}

export function nameContainsUrl(name: string): boolean {
  return /https?:\/\/|www\./i.test(name);
}

export type FieldErrors = Partial<Record<"name" | "email" | "message" | "challenge", string>>;

export function validateContact(input: { name: string; email: string; message: string }): {
  name: string;
  email: string;
  message: string;
  errors: FieldErrors;
} {
  const name = stripControls(input.name ?? "", false).trim();
  const email = stripControls(input.email ?? "", false).trim();
  const message = stripControls(input.message ?? "", true).trim();
  const errors: FieldErrors = {};

  if (name.length < 2 || name.length > 80 || nameContainsUrl(name)) {
    errors.name = "Enter your name.";
  }
  if (!z.string().email().safeParse(email).success) {
    errors.email = "Enter a valid email.";
  }
  if (!message) errors.message = "Enter a message.";
  else if (message.length > 2000) errors.message = "Keep it under 2000 characters.";

  return { name, email, message, errors };
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/** Screenshot fixture from the approved contact mocks. 109 characters. */
export const QA_PREFILL = {
  name: "Jordan Lee",
  email: "jordan@company.com",
  message:
    "Hi Anthony, we're hiring a Senior Software Engineer (mobile + API security). Remote. JD: company.com/jobs/123",
};

export const CHALLENGE_MISMATCH = "That answer doesn’t match. Try again, or email me.";
