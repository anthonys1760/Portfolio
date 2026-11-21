export const SITE = "https://anthonysdigital.net";
export const EMAIL = "anthony.smith1760@gmail.com";
export const CALENDLY = "https://calendly.com/anthony-tech-solutions";
export const GITHUB = "https://github.com/anthonys1760";
export const LINKEDIN = "https://www.linkedin.com/in/anthony-smith-b1085389";
export const DEVTO = "https://dev.to/anthonys1760";

export const PROJECT_TAGS = [
  "React Native",
  "TypeScript",
  "Supabase",
  "AI",
  "Security",
  "Web",
] as const;

export type ProjectTag = (typeof PROJECT_TAGS)[number];

export function matchProjectTag(raw: string | null | undefined, names: readonly string[] = PROJECT_TAGS): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return names.find((name) => name.toLowerCase() === value.toLowerCase()) ?? null;
}

export const HOME_NOTES = [
  "how-i-test-for-broken-object-level-authorization",
  "how-i-test-for-broken-function-level-authorization",
  "how-i-test-for-jwt-validation-flaws",
] as const;

export function outcomeParts(outcome: string): { lead?: string; rest: string } {
  const match = outcome.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  if (!match) return { rest: outcome };
  return { lead: match[1], rest: match[2] };
}

export function entryId(entry: { id: string }): string {
  return entry.id.replace(/\.(md|mdx)$/i, "");
}
