export type ContactLogCategory =
  | "sent"
  | "stubbed"
  | "rate_limited"
  | "rate_limit_skipped"
  | "challenge"
  | "invalid"
  | "provider_error";

/** Outcome category only. Never pass a message body, email, or IP. */
export function logContact(category: ContactLogCategory): void {
  console.info(JSON.stringify({ contact: category }));
}
