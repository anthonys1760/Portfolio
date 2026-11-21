import type { APIRoute } from "astro";
import { handleContact } from "../../lib/contact/handle";

export const prerender = false;

function cookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.VERCEL_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/contact; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const POST: APIRoute = async ({ request }) => {
  const result = await handleContact(request);
  const headers = new Headers();
  if (result.retryAfter) headers.set("Retry-After", String(result.retryAfter));
  if (result.clearDraft) headers.append("Set-Cookie", cookie("contact_draft", "", 0));
  if (result.draft) {
    headers.append("Set-Cookie", cookie("contact_draft", JSON.stringify(result.draft), 600));
  }
  if (result.ack) {
    headers.append("Set-Cookie", cookie("contact_ack", JSON.stringify(result.ack), 120));
  }

  const contentType = request.headers.get("content-type") || "";
  const asJson = contentType.includes("application/json");
  if (!asJson) {
    headers.set("Location", result.redirect);
    return new Response(null, { status: 303, headers });
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(result.json), { status: result.status, headers });
};
