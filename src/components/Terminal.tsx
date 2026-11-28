import { useRef, useState, type KeyboardEvent } from "react";
import { EMAIL } from "../lib/site";

const COMMANDS = ["help", "projects", "drawbridge", "experience", "contact", "whoami", "clear"] as const;

type Line = { kind: "cmd" | "text" | "dim" | "link"; text: string; href?: string; k?: string };

const HELP: Line[] = [
  { kind: "cmd", text: "help" },
  { kind: "dim", text: "available commands" },
  { kind: "text", k: "projects", text: "featured work, with outcomes" },
  { kind: "text", k: "drawbridge", text: "open-source MCP gateway" },
  { kind: "text", k: "experience", text: "jump to experience" },
  { kind: "text", k: "contact", text: "email or send a message" },
  { kind: "text", k: "whoami", text: "role, focus, availability" },
  { kind: "text", k: "clear", text: "clear the screen" },
  { kind: "dim", text: "Tab completes · ↑ history · Esc clears · Ctrl+L clears the screen" },
];

const PROJECTS: Line[] = [
  { kind: "cmd", text: "projects" },
  { kind: "text", text: "CastLog — Shipped to the App Store. Log a catch by voice, offline, with lake, weather and moon phase filled in." },
  { kind: "link", text: "/projects/castlog", href: "/projects/castlog" },
  { kind: "text", text: "Nutrilogix — On TestFlight. Log meals from a photo or by voice, with barcode lookup and Apple Health sync." },
  { kind: "link", text: "/projects/nutrilogix", href: "/projects/nutrilogix" },
  { kind: "text", text: "CallCatch — Live. Answers from a business's own site, never invents a price, and turns unanswered questions into leads." },
  { kind: "link", text: "/projects/callcatch", href: "/projects/callcatch" },
  { kind: "text", text: "Drawbridge — open source. 8/8 scripted attacks pass. An MCP gateway that wraps untrusted tool results." },
  { kind: "link", text: "/projects/drawbridge", href: "/projects/drawbridge" },
  { kind: "link", text: "All projects", href: "/projects" },
];

const DRAWBRIDGE: Line[] = [
  { kind: "cmd", text: "drawbridge" },
  { kind: "text", text: "open-source MCP security gateway · pre-release · Apache-2.0" },
  { kind: "text", text: "8/8 scripted attacks pass. Treats every tool result as untrusted." },
  { kind: "link", text: "/projects/drawbridge", href: "/projects/drawbridge" },
  { kind: "link", text: "/drawbridge/replay/", href: "/drawbridge/replay/index.html" },
];

const WHOAMI: Line[] = [
  { kind: "cmd", text: "whoami" },
  { kind: "text", text: "senior software engineer · solutions architect" },
  { kind: "text", text: "application & API security" },
  { kind: "text", text: "based: Grand Rapids, MI" },
  { kind: "text", text: "open to: full-time · contract" },
];

function plain(lines: Line[]): string {
  return lines
    .map((line) => (line.kind === "cmd" ? `$ ${line.text}` : line.k ? `${line.k} ${line.text}` : line.text))
    .join("\n");
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line, index) => {
        if (line.kind === "cmd") {
          return (
            <div key={index}>
              <span className="p">$ </span>
              <span className="cmd">{line.text}</span>
            </div>
          );
        }
        if (line.kind === "link" && line.href) {
          return (
            <div key={index}>
              <a href={line.href}>{line.text}</a>
            </div>
          );
        }
        if (line.kind === "dim") return <div key={index} className="dim">{line.text}</div>;
        return (
          <div key={index}>
            {line.k ? <span className="k">{line.k}</span> : null}
            {line.text}
          </div>
        );
      })}
    </>
  );
}

export default function Terminal() {
  const [log, setLog] = useState<Line[][]>([HELP]);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [announce, setAnnounce] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const histIndex = useRef(-1);
  const draft = useRef("");
  const escArmed = useRef(false);

  function push(lines: Line[], follow?: () => void) {
    setLog((current) => [...current, lines]);
    setAnnounce(plain(lines));
    follow?.();
  }

  function run(raw: string) {
    const command = raw.trim().toLowerCase();
    if (!command) return;
    if (command !== raw.trim()) {
      /* keep original echo via command name */
    }
    if (command === "help") push(HELP);
    else if (command === "projects") push(PROJECTS);
    else if (command === "drawbridge") push(DRAWBRIDGE);
    else if (command === "experience") {
      push(
        [
          { kind: "cmd", text: "experience" },
          { kind: "text", text: "Opening experience." },
          { kind: "link", text: "/about#experience", href: "/about#experience" },
        ],
        () => {
          window.location.assign("/about#experience");
        },
      );
    } else if (command === "contact") {
      push([
        { kind: "cmd", text: "contact" },
        { kind: "link", text: EMAIL, href: `mailto:${EMAIL}` },
        { kind: "link", text: "/contact", href: "/contact" },
      ]);
    } else if (command === "whoami") push(WHOAMI);
    else if (command === "clear") {
      setLog([]);
      setAnnounce("Screen cleared");
    } else {
      push([
        { kind: "cmd", text: raw.trim() },
        { kind: "text", text: `command not found: ${raw.trim()} · try help` },
      ]);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const typed = value.trim();
      if (typed) {
        history.current.push(typed);
        histIndex.current = -1;
        draft.current = "";
      }
      run(value);
      setValue("");
      escArmed.current = false;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.current.length) return;
      if (histIndex.current === -1) draft.current = value;
      const next = histIndex.current < 0 ? history.current.length - 1 : Math.max(0, histIndex.current - 1);
      histIndex.current = next;
      setValue(history.current[next] ?? "");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (histIndex.current < 0) return;
      const next = histIndex.current + 1;
      if (next >= history.current.length) {
        histIndex.current = -1;
        setValue(draft.current);
      } else {
        histIndex.current = next;
        setValue(history.current[next] ?? "");
      }
      return;
    }
    if (event.key === "Escape") {
      if (value) {
        setValue("");
        draft.current = "";
        histIndex.current = -1;
        escArmed.current = true;
      } else {
        inputRef.current?.blur();
        escArmed.current = false;
      }
      return;
    }
    if (event.key === "Tab") {
      const typed = value.trim().toLowerCase();
      if (!typed) return;
      const matches = COMMANDS.filter((command) => command.startsWith(typed) && command !== typed);
      if (matches.length === 1) {
        event.preventDefault();
        setValue(matches[0]);
      }
      return;
    }
    if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      setLog([]);
      setAnnounce("Screen cleared");
    }
  }

  return (
    <div className="term" role="region" aria-label="Interactive terminal. Type help, or use the command buttons below.">
      <div className="bar">
        <span className="t">~/anthony</span>
        <span>— ship &amp;&amp; break</span>
        <span className="st">interactive</span>
      </div>
      <div className="body" id="terminal-help">
        {log.map((block, index) => (
          <Lines key={index} lines={block} />
        ))}
      </div>
      <div className="sr-only" aria-live="polite">{announce}</div>
      <div className="inrow">
        <span className="p" aria-hidden="true">$</span>
        <div className="field">
          <span className="mirror" aria-hidden="true">{value}</span>
          {focused ? <span className="caret blink" aria-hidden="true" /> : null}
          <input
            id="term-input"
            ref={inputRef}
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => {
              setValue(event.target.value);
              escArmed.current = false;
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
          />
        </div>
        <span className="kbd">Tab ⇥ completes · ↑ history</span>
      </div>
      <div className="foot">
        <label className="hint" htmlFor="term-input">
          Type <code>help</code> or use the buttons
        </label>
        <div className="chips" role="group" aria-label="Run a command">
          <a className="chip" href="#terminal-help" onClick={(event) => { event.preventDefault(); run("help"); }}>help</a>
          <a className="chip" href="/projects" onClick={(event) => { event.preventDefault(); run("projects"); }}>projects</a>
          <a className="chip" href="/about#experience" onClick={(event) => { event.preventDefault(); run("experience"); }}>experience</a>
          <a className="chip" href="/contact" onClick={(event) => { event.preventDefault(); run("contact"); }}>contact</a>
          <a className="chip" href="#whoami" onClick={(event) => { event.preventDefault(); run("whoami"); }}>whoami</a>
        </div>
        <noscript>
          <div id="whoami" className="body">
            senior software engineer · solutions architect
            {"\n"}application &amp; API security
            {"\n"}based: Grand Rapids, MI
            {"\n"}open to: full-time · contract
          </div>
        </noscript>
      </div>
    </div>
  );
}
