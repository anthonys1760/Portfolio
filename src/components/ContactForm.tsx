import { useState, type FormEvent } from "react";
import { CALENDLY } from "../lib/site";
import { CHALLENGE_MISMATCH, QA_PREFILL, validateContact, firstName, type FieldErrors } from "../lib/contact/validation";

export type FormMode = "default" | "success" | "error" | "rate" | "spam";

export type ContactInitial = {
  mode: FormMode;
  name: string;
  email: string;
  message: string;
  errors: FieldErrors;
  question: string;
  token: string;
  answer: string;
  rendered: string;
};

const EMPTY: FieldErrors = {};

export default function ContactForm({ initial }: { initial: ContactInitial }) {
  const [mode, setMode] = useState<FormMode>(initial.mode);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [message, setMessage] = useState(initial.message);
  const [errors, setErrors] = useState<FieldErrors>(initial.errors);
  const [question, setQuestion] = useState(initial.question);
  const [token, setToken] = useState(initial.token);
  const [answer, setAnswer] = useState(initial.answer);
  const [sending, setSending] = useState(false);
  const [rendered] = useState(initial.rendered);

  function blurField(field: "name" | "email" | "message") {
    const result = validateContact({ name, email, message });
    setErrors((current) => {
      const next = { ...current };
      if (result.errors[field]) next[field] = result.errors[field];
      else delete next[field];
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "rate" || sending) return;
    const result = validateContact({ name, email, message });
    if (Object.keys(result.errors).length) {
      setErrors(result.errors);
      return;
    }
    if (mode === "spam" && !answer.trim()) {
      setErrors({ ...result.errors, challenge: CHALLENGE_MISMATCH });
      return;
    }
    setSending(true);
    setErrors(EMPTY);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name,
          email,
          message,
          company: "",
          rendered,
          challengeAnswer: answer,
          challengeToken: mode === "spam" ? token : "",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
        fields?: FieldErrors;
        question?: string;
        token?: string;
        fieldError?: string;
      };
      if (response.status === 200) {
        setMode("success");
        return;
      }
      if (response.status === 400 && data.fields) {
        setErrors(data.fields);
        setMode("default");
        return;
      }
      if (response.status === 429) {
        setMode("rate");
        return;
      }
      if (response.status === 409 && data.code === "challenge_required") {
        setMode("spam");
        setQuestion(data.question || question);
        setToken(data.token || "");
        setAnswer("");
        setErrors(data.fieldError ? { challenge: data.fieldError } : EMPTY);
        return;
      }
      setMode("error");
    } catch {
      setMode("error");
    } finally {
      setSending(false);
    }
  }

  if (mode === "success") {
    const who = firstName(name) || "there";
    const to = email || "your email";
    return (
      <div className="form" role="status">
        <div className="ok">
          <div className="big" aria-hidden="true">✓</div>
          <h3>Message sent.</h3>
          <p>Thanks, {who}. I reply within a day, to {to}.</p>
          <div className="ctas">
            <a className="btn sec" href={CALENDLY} target="_blank" rel="noopener noreferrer">
              Book a call <span className="ic" aria-hidden="true">↗</span>
            </a>
            <a className="btn ghost" href="/contact">Send another</a>
          </div>
        </div>
      </div>
    );
  }

  const buttonLabel = sending ? "Sending…" : mode === "error" ? "Try again" : mode === "spam" ? "Verify and send" : "Send message";

  return (
    <form className="form" aria-label="Contact form" method="post" action="/api/contact" onSubmit={onSubmit} noValidate>
      {mode === "error" ? (
        <div className="alert err" role="alert">
          <span className="ic" aria-hidden="true">!</span>
          <div>
            <b>Couldn't send your message.</b>
            <span>Something went wrong on my side. Your message is still here, so try again, or email me at anthony.smith1760@gmail.com.</span>
          </div>
        </div>
      ) : null}
      {mode === "rate" ? (
        <div className="alert warn" role="status">
          <span className="ic" aria-hidden="true">!</span>
          <div>
            <b>Too many messages, try again in a few minutes.</b>
            <span>Your message is saved in the form. Email works any time.</span>
          </div>
        </div>
      ) : null}
      <div className="hp" aria-hidden="true">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input type="hidden" name="rendered" value={rendered} />
      <div className="fld">
        <label htmlFor="name">Name</label>
        <input
          className={`inp${errors.name ? " err" : ""}`}
          id="name"
          name="name"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          aria-invalid={errors.name ? "true" : undefined}
          aria-describedby={errors.name ? "name-error" : undefined}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => blurField("name")}
          autoFocus={initial.mode === "default"}
        />
        {errors.name ? <p className="ferr" id="name-error">{errors.name}</p> : null}
      </div>
      <div className="fld">
        <label htmlFor="email">Email</label>
        <input
          className={`inp${errors.email ? " err" : ""}`}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          aria-invalid={errors.email ? "true" : undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() => blurField("email")}
        />
        {errors.email ? <p className="ferr" id="email-error">{errors.email}</p> : null}
      </div>
      <div className="fld">
        <label htmlFor="message">Message</label>
        <textarea
          className={`inp ta${errors.message ? " err" : ""}`}
          id="message"
          name="message"
          placeholder="The role or project, a timeline, and a link."
          value={message}
          aria-invalid={errors.message ? "true" : undefined}
          aria-describedby="message-help"
          onChange={(event) => setMessage(event.target.value)}
          onBlur={() => blurField("message")}
        />
        <p className="hlp" id="message-help">
          <span>{errors.message ? <span className="ferr">{errors.message}</span> : "Role, timeline and a link help most."}</span>
          <span>{message.length} / 2000</span>
        </p>
      </div>
      {mode === "spam" ? (
        <div className="chal" role="group" aria-labelledby="chq">
          <input type="hidden" name="challengeToken" value={token} />
          <p id="chq"><b>One quick check before it sends.</b></p>
          <p style={{ color: "var(--text-2)", fontSize: "14.5px", marginTop: 4 }}>
            Our filter wasn't sure about this one. That happens. Answer this and it goes through.
          </p>
          <div className="q">
            <label htmlFor="challenge">{question || "What is 3 + 4?"}</label>
            <input
              className={`inp${errors.challenge ? " err" : ""}`}
              id="challenge"
              name="challengeAnswer"
              inputMode="numeric"
              autoComplete="off"
              value={answer}
              aria-invalid={errors.challenge ? "true" : undefined}
              aria-describedby={errors.challenge ? "challenge-error" : undefined}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </div>
          {errors.challenge ? <p className="ferr" id="challenge-error">{errors.challenge}</p> : null}
        </div>
      ) : null}
      <div className="formrow">
        <button className="btn pri" type="submit" disabled={mode === "rate" || sending} aria-disabled={mode === "rate" || sending ? "true" : undefined}>
          {buttonLabel}
        </button>
        {mode === "rate" ? <small>Available again in a few minutes</small> : null}
      </div>
    </form>
  );
}

export function qaInitial(state: string, rendered: string): ContactInitial | null {
  if (state === "success") {
    return { mode: "success", ...QA_PREFILL, errors: {}, question: "", token: "", answer: "", rendered };
  }
  if (state === "error" || state === "rate" || state === "spam") {
    return {
      mode: state,
      ...QA_PREFILL,
      errors: {},
      question: "What is 3 + 4?",
      token: "qa",
      answer: state === "spam" ? "7" : "",
      rendered,
    };
  }
  if (state === "default") {
    return { mode: "default", name: "", email: "", message: "", errors: {}, question: "", token: "", answer: "", rendered };
  }
  return null;
}
