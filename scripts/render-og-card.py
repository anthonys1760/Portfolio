#!/usr/bin/env python3
"""Render design/og-card.html to images/og-card.jpg (1200x630).

Uses headless Chrome for layout and text, then ffmpeg for the JPEG.
Inter and JetBrains Mono are the intended faces; Chrome falls back to the
next installed sans and monospace if those families are missing.
"""

import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design" / "og-card.html"
OUTPUT = ROOT / "images" / "og-card.jpg"
WIDTH = 1200
HEIGHT = 630
MAX_BYTES = 300 * 1024


def png_size(path):
    with path.open("rb") as handle:
        signature = handle.read(8)
        if signature != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{path} is not a PNG")
        handle.read(8)  # IHDR length and type
        return struct.unpack(">II", handle.read(8))


def main():
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    ffmpeg = shutil.which("ffmpeg")
    if not chrome:
        raise SystemExit("google-chrome or chromium is required to render the card")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to encode the JPEG")
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        png = tmp_path / "og-card.png"
        # Headless Chrome writes the screenshot, then often stays up on dbus
        # errors in this environment. Wait for the file and stop the process.
        proc = subprocess.Popen(
            [
                chrome,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--no-first-run",
                "--disable-extensions",
                f"--user-data-dir={tmp_path / 'chrome'}",
                "--default-background-color=050509",
                f"--window-size={WIDTH},{HEIGHT}",
                f"--screenshot={png}",
                SOURCE.as_uri(),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 25
        while time.time() < deadline:
            if png.is_file() and png.stat().st_size > 1000:
                time.sleep(0.3)
                break
            if proc.poll() is not None:
                break
            time.sleep(0.2)
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
        if not png.is_file():
            raise SystemExit("chrome did not write a screenshot")
        actual = png_size(png)
        if actual != (WIDTH, HEIGHT):
            raise SystemExit(f"screenshot is {actual[0]}x{actual[1]}, expected {WIDTH}x{HEIGHT}")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(png),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                str(OUTPUT),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

    size = OUTPUT.stat().st_size
    if size > MAX_BYTES:
        raise SystemExit(f"{OUTPUT.name} is {size} bytes, over the {MAX_BYTES} byte budget")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({WIDTH}x{HEIGHT}, {size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
