#!/usr/bin/env python3
"""Capture each project's live marketing page and compose one device mockup.

Uses headless Chrome (DevTools protocol). Requires Pillow and the websockets
package. Regenerates the WebP files the portfolio cards use:

    python3 scripts/device-mockups.py

Nothing here is a placeholder. Each screen is an above-the-fold capture of
the project's own site.
"""

from __future__ import annotations

import asyncio
import base64
import json
import subprocess
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "images" / "projects"
RAW_DIR = Path("/tmp/device-mockup-raw")

PROJECTS = (
    {"slug": "castlog", "url": "https://castlogapp.com/"},
    {"slug": "nutrilogix", "url": "https://nutrilogix-ai.com/"},
    # Same host the earlier VoiceLift card capture used.
    {"slug": "voicelift", "url": "https://voicelift.app/"},
)

# Above-the-fold viewports. The composed canvas is identical for every project.
VIEWPORTS = (
    ("laptop", 1440, 900),
    ("tablet", 834, 1112),
    ("phone", 390, 844),
)

CANVAS = (1600, 1000)
CHROME_PORT = 9333

# Shared layout, in canvas pixels. Laptop sits at the back; tablet and phone
# overlap it in front. Screen boxes keep each capture's real aspect ratio.
LAYOUT = {
    "laptop": {"x": 250, "y": 56, "screen": (1072, 670), "bezel": 16, "radius": 22, "chin": 28, "deck": 46},
    "tablet": {"x": 78, "y": 268, "screen": (390, 520), "bezel": 14, "radius": 26, "chin": 0, "deck": 0},
    "phone": {"x": 1268, "y": 318, "screen": (214, 463), "bezel": 12, "radius": 28, "chin": 0, "deck": 0},
}

BEZEL = (24, 26, 31, 255)
BEZEL_EDGE = (255, 255, 255, 36)
DECK = (18, 19, 23, 255)


def chrome_ready(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as resp:
            return resp.status == 200
    except Exception:
        return False


def ensure_chrome(port: int) -> None:
    if chrome_ready(port):
        return
    profile = Path(f"/tmp/chrome-device-mockups-{port}")
    profile.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(
        [
            "google-chrome",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--disable-dev-shm-usage",
            f"--user-data-dir={profile}",
            f"--remote-debugging-port={port}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        if chrome_ready(port):
            return
        time.sleep(0.25)
    raise RuntimeError("Headless Chrome did not open a DevTools port")


SETTLE_JS = r"""
(async function () {
  const cap = (p) => Promise.race([p, new Promise((res) => setTimeout(res, 4000))]);
  if (document.fonts && document.fonts.ready) await cap(document.fonts.ready);
  await cap(Promise.all([...document.images].map((img) => img.complete ? 1 : new Promise((res) => {
    img.addEventListener('load', res, {once: true});
    img.addEventListener('error', res, {once: true});
  }))));
  const labels = ['accept all', 'accept', 'i agree', 'agree', 'got it', 'allow all', 'allow cookies', 'okay', 'ok'];
  document.querySelectorAll('button, [role="button"]').forEach((el) => {
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text || text.length > 32) return;
    if (labels.includes(text) || text.includes('accept') || text.includes('agree')) el.click();
  });
  document.querySelectorAll('div, aside, section').forEach((el) => {
    const id = ((el.id || '') + ' ' + (el.className || '')).toString().toLowerCase();
    if (!/cookie|consent|gdpr|banner/.test(id)) return;
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') el.style.setProperty('display', 'none', 'important');
  });
  return document.title;
})()
"""


async def capture_all(port: int) -> dict[str, dict[str, Image.Image]]:
    import websockets

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
    page = next(t for t in targets if t["type"] == "page")
    shots: dict[str, dict[str, Image.Image]] = {}
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=80_000_000) as ws:
        seq = 0

        async def call(method, params=None, timeout=40):
            nonlocal seq
            seq += 1
            mid = seq
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            while True:
                data = json.loads(await asyncio.wait_for(ws.recv(), timeout))
                if data.get("id") == mid:
                    if "error" in data:
                        raise RuntimeError(data["error"])
                    return data.get("result", {})

        await call("Page.enable")
        await call("Runtime.enable")
        for project in PROJECTS:
            shots[project["slug"]] = {}
            for name, width, height in VIEWPORTS:
                print(f"opening {project['slug']} {name}", flush=True)
                await call(
                    "Emulation.setDeviceMetricsOverride",
                    {"width": width, "height": height, "deviceScaleFactor": 2, "mobile": name != "laptop"},
                )
                await call("Page.navigate", {"url": project["url"]})
                await asyncio.sleep(2.2)
                await call(
                    "Runtime.evaluate",
                    {"expression": SETTLE_JS, "awaitPromise": True, "returnByValue": True},
                )
                await asyncio.sleep(0.6)
                shot = await call(
                    "Page.captureScreenshot",
                    {
                        "format": "png",
                        "fromSurface": True,
                        "clip": {"x": 0, "y": 0, "width": width, "height": height, "scale": 1},
                    },
                )
                raw = base64.b64decode(shot["data"])
                path = RAW_DIR / f"{project['slug']}-{name}.png"
                path.write_bytes(raw)
                image = Image.open(path).convert("RGB")
                shots[project["slug"]][name] = image
                print(f"captured {project['slug']} {name} {image.size}")
    return shots


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def add_shadow(canvas: Image.Image, box: tuple[int, int, int, int], radius: int) -> None:
    x, y, w, h = box
    pad = 48
    layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        (pad, pad + 10, pad + w, pad + h + 10),
        radius=radius,
        fill=(0, 0, 0, 88),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(16))
    canvas.alpha_composite(layer, (x - pad, y - pad))


def draw_device(canvas: Image.Image, shot: Image.Image, spec: dict) -> None:
    sw, sh = spec["screen"]
    bezel = spec["bezel"]
    chin = spec["chin"]
    outer_w = sw + bezel * 2
    outer_h = sh + bezel * 2 + chin
    x, y = spec["x"], spec["y"]
    add_shadow(canvas, (x, y, outer_w, outer_h + spec["deck"]), spec["radius"])

    body = Image.new("RGBA", (outer_w, outer_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(body)
    draw.rounded_rectangle((0, 0, outer_w - 1, outer_h - 1), radius=spec["radius"], fill=BEZEL)
    draw.rounded_rectangle((1, 1, outer_w - 2, outer_h - 2), radius=spec["radius"] - 1, outline=BEZEL_EDGE)
    screen = cover(shot, sw, sh).convert("RGBA")
    screen.putalpha(rounded_mask((sw, sh), max(8, spec["radius"] - bezel)))
    body.alpha_composite(screen, (bezel, bezel))
    cx = outer_w // 2
    draw.ellipse((cx - 3, max(3, bezel // 2 - 3), cx + 3, max(9, bezel // 2 + 3)), fill=(70, 74, 82, 255))
    if chin == 0 and sh > 400:
        draw.rounded_rectangle((cx - 18, outer_h - bezel + 3, cx + 18, outer_h - 5), radius=3, fill=(70, 74, 82, 255))
    canvas.alpha_composite(body, (x, y))

    if spec["deck"]:
        deck_w = outer_w + 70
        deck_h = spec["deck"]
        deck_x = x - 35
        deck_y = y + outer_h - 8
        deck = Image.new("RGBA", (deck_w, deck_h), (0, 0, 0, 0))
        ddraw = ImageDraw.Draw(deck)
        ddraw.rounded_rectangle((0, 0, deck_w - 1, deck_h - 1), radius=8, fill=DECK)
        ddraw.rounded_rectangle((deck_w // 2 - 36, deck_h // 2 - 3, deck_w // 2 + 36, deck_h // 2 + 4), radius=3, fill=(48, 52, 60, 255))
        canvas.alpha_composite(deck, (deck_x, deck_y))


def compose(shots: dict[str, dict[str, Image.Image]]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for project in PROJECTS:
        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        for name in ("laptop", "tablet", "phone"):
            draw_device(canvas, shots[project["slug"]][name], LAYOUT[name])
        dest = OUT_DIR / f"{project['slug']}-devices.webp"
        canvas.save(dest, "WEBP", quality=82, method=6)
        print(f"wrote {dest.relative_to(ROOT)} {canvas.size} {dest.stat().st_size} bytes")


def main() -> None:
    ensure_chrome(CHROME_PORT)
    shots = asyncio.run(capture_all(CHROME_PORT))
    compose(shots)


if __name__ == "__main__":
    main()
