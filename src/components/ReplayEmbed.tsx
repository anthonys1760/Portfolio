import { useEffect, useRef, useState } from "react";

type Poster = string | { src: string; width: number; height: number };

interface Props {
  src: string;
  fullHref: string;
  poster: Poster;
  posterAlt?: string;
  title: string;
  minWidth?: number;
}

export default function ReplayEmbed({
  src,
  fullHref,
  poster,
  posterAlt = "",
  title,
  minWidth = 768,
}: Props) {
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const posterSrc = typeof poster === "string" ? poster : poster.src;
  const posterWidth = typeof poster === "string" ? 1200 : poster.width;
  const posterHeight = typeof poster === "string" ? 700 : poster.height;

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (loaded) iframeRef.current?.focus();
  }, [loaded]);

  function wideEnough() {
    return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
  }

  function onLoad() {
    if (wideEnough()) setLoaded(true);
    else window.open(fullHref, "_blank", "noopener,noreferrer");
  }

  if (loaded) {
    return (
      <>
        <iframe
          ref={iframeRef}
          className="replay-iframe"
          src={src}
          title={title}
          referrerPolicy="no-referrer"
          loading="eager"
          tabIndex={0}
        />
        <p className="sr-only" aria-live="polite">Replay loaded</p>
      </>
    );
  }

  return (
    <div className="poster">
      {ready ? (
        <>
          <img src={posterSrc} width={posterWidth} height={posterHeight} alt={posterAlt} loading="lazy" decoding="async" />
          <div className="veil">
            <button className="btn pri" type="button" onClick={onLoad}>
              ▶ Load the interactive replay
            </button>
            <p>Sample data · loads from this site, nothing leaves your browser</p>
          </div>
        </>
      ) : (
        <a href={fullHref}>
          <img src={posterSrc} width={posterWidth} height={posterHeight} alt={posterAlt} loading="lazy" decoding="async" />
          <span className="sr-only">Open the interactive replay</span>
        </a>
      )}
    </div>
  );
}
