/**
 * Email delivery adapter.
 *
 * Resend is the approved sender. CONTACT_DELIVERY stays `stub` until
 * RESEND_API_KEY, CONTACT_FROM_EMAIL, and CONTACT_TO_EMAIL are set in
 * Vercel (Production and Preview). Never commit those values.
 *
 * CONTACT_FROM_EMAIL must be on a domain Resend has verified. Plan on a
 * subdomain, for example contact@mail.anthonysdigital.net.
 *
 * The message goes to CONTACT_TO_EMAIL. reply_to is the visitor's validated
 * email. There is no auto-reply.
 *
 * Preview (VERCEL_ENV=preview) still sends when delivery is `resend`, with
 * the subject prefixed `[preview]`. Stub mode never sends.
 */

export type DeliveryInput = { name: string; email: string; message: string };

export type DeliveryResult = { ok: true; mode: "sent" | "stubbed" } | { ok: false };

function subjectFor(name: string): string {
  const clean = name.replace(/[\r\n]+/g, " ").slice(0, 120);
  const base = `Portfolio: ${clean}`;
  return process.env.VERCEL_ENV === "preview" ? `[preview] ${base}` : base;
}

function plainText(input: DeliveryInput): string {
  return `Name: ${input.name}\nEmail: ${input.email}\n\n${input.message}\n`;
}

async function sendResend(input: DeliveryInput): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!key || !from || !to) return { ok: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: input.email,
      subject: subjectFor(input.name),
      text: plainText(input),
    }),
  });
  return response.ok ? { ok: true, mode: "sent" } : { ok: false };
}

export async function deliverContact(input: DeliveryInput): Promise<DeliveryResult> {
  const mode = (process.env.CONTACT_DELIVERY || "stub").toLowerCase();
  try {
    if (mode === "resend") return await sendResend(input);
    if (mode === "stub") return { ok: true, mode: "stubbed" };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
