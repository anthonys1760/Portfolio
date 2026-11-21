import { useEffect, useState } from "react";

type TagCount = { name: string; count: number };

export default function TagFilter({ tags, total }: { tags: TagCount[]; total: number }) {
  const [active, setActive] = useState<string | null>(null);
  const [shown, setShown] = useState(total);

  function apply(tag: string | null) {
    const match = tag && tags.some((item) => item.name === tag) ? tag : null;
    setActive(match);
    let visible = 0;
    document.querySelectorAll<HTMLElement>("[data-project]").forEach((card) => {
      const cardTags = (card.dataset.tags || "").split("|");
      const hide = Boolean(match) && !cardTags.includes(match as string);
      card.hidden = hide;
      if (!hide) visible += 1;
    });
    setShown(match ? visible : total);
    const row = document.querySelector<HTMLElement>(".filters");
    const current = row?.querySelector<HTMLElement>(".fchip.on");
    if (row && current && window.matchMedia("(max-width: 767px)").matches) {
      current.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }

  useEffect(() => {
    const read = () => apply(new URLSearchParams(window.location.search).get("tag"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
    // The project list is static HTML; apply reads it once on load and on history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(tag: string | null, event: React.MouseEvent) {
    event.preventDefault();
    const url = tag ? `/projects?tag=${encodeURIComponent(tag)}` : "/projects";
    window.history.pushState({}, "", url);
    apply(tag);
  }

  return (
    <>
      <div className="filters" role="group" aria-label="Filter projects by tag">
        <a className={`fchip${active ? "" : " on"}`} href="/projects" aria-pressed={active ? "false" : "true"} onClick={(event) => go(null, event)}>
          All<span className="n">{total}</span>
        </a>
        {tags.map((tag) => (
          <a
            key={tag.name}
            className={`fchip${active === tag.name ? " on" : ""}`}
            href={`/projects?tag=${encodeURIComponent(tag.name)}`}
            aria-pressed={active === tag.name ? "true" : "false"}
            onClick={(event) => go(tag.name, event)}
          >
            {tag.name}
            <span className="n">{tag.count}</span>
          </a>
        ))}
      </div>
      <p className="rescount" role="status">
        {active ? (
          <>
            <span><b>{shown}</b> of {total} projects · tagged {active}</span>
            <a href="/projects" onClick={(event) => go(null, event)}>Clear filter</a>
          </>
        ) : (
          <span><b>{total}</b> of {total} projects</span>
        )}
      </p>
    </>
  );
}
