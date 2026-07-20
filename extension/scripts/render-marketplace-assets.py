"""Render deterministic Marketplace media from the real bundled model.

These are clearly branded offline-demo graphics, not screenshots of VS Code.
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "extension" / "assets" / "marketplace"
MODEL_PATH = ROOT / "extension" / "models" / "model.json.gz"
BENCHMARK_PATH = ROOT / "benchmarks" / "latest.json"
sys.path.insert(0, str(ROOT))

from benchmarks.run_benchmark import predict  # noqa: E402
from ngram_tokenizer import scan_text  # noqa: E402


WIDTH, HEIGHT = 1200, 675
BG = "#0b1020"
PANEL = "#111827"
PANEL_2 = "#172033"
BORDER = "#293548"
TEXT = "#e5edf8"
MUTED = "#8fa1b8"
CYAN = "#4fd1c5"
BLUE = "#60a5fa"
YELLOW = "#facc15"
GREEN = "#86efac"
PURPLE = "#c4b5fd"
RED = "#fca5a5"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = {
        "ui": ["segoeui.ttf", "arial.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
        "mono": ["CascadiaMono.ttf", "consola.ttf"],
    }
    for candidate in candidates[name]:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


UI = font("ui", 22)
SMALL = font("ui", 17)
TINY = font("ui", 14)
BOLD = font("bold", 26)
TITLE = font("bold", 31)
MONO = font("mono", 24)
MONO_SMALL = font("mono", 20)


def rounded(draw: ImageDraw.ImageDraw, box, fill, radius=16, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def base(title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 74), fill="#0f172a")
    rounded(draw, (25, 18, 61, 54), CYAN, 9)
    draw.rectangle((36, 28, 50, 44), fill="#0f172a")
    draw.text((78, 17), title, font=BOLD, fill=TEXT)
    draw.text((78, 48), subtitle, font=TINY, fill=MUTED)
    rounded(draw, (932, 20, 1173, 53), "#13233a", 16, BORDER)
    draw.text((957, 27), "100% LOCAL  •  OFFLINE", font=TINY, fill=GREEN)
    return image, draw


def footer(draw: ImageDraw.ImageDraw, active: str = "N-Gram 3"):
    draw.rectangle((0, 635, WIDTH, HEIGHT), fill="#0f172a")
    draw.text((28, 647), "Local N-Gram Code Suggester", font=TINY, fill=MUTED)
    draw.text((955, 647), active, font=TINY, fill=CYAN)


def editor_frame(prefix: str, ghost: str = "", accepted: bool = False) -> Image.Image:
    image, draw = base(
        "Offline completion demo",
        "Suggestion generated from the bundled model — no API, account, or telemetry",
    )
    rounded(draw, (28, 94, 1172, 614), PANEL, 18, BORDER)
    draw.rectangle((28, 94, 1172, 139), fill="#151f31")
    draw.text((52, 105), "demo.py", font=SMALL, fill=TEXT)
    draw.text((1080, 105), "Python", font=TINY, fill=BLUE)

    code = [
        ("1", "def ", BLUE, "normalize_number(value):", TEXT),
        ("2", "    # Comments do not affect local code suggestions.", MUTED, "", TEXT),
        ("3", "    if ", PURPLE, "isinstance(value, float) and ", TEXT),
    ]
    y = 178
    for number, lead, lead_color, rest, rest_color in code:
        draw.text((52, y), number, font=MONO_SMALL, fill="#52627a")
        draw.text((92, y), lead, font=MONO, fill=lead_color)
        lead_width = draw.textlength(lead, font=MONO)
        draw.text((92 + lead_width, y), rest, font=MONO, fill=rest_color)
        y += 62

    x = 92 + draw.textlength("    if ", font=MONO)
    x += draw.textlength("isinstance(value, float) and ", font=MONO)
    draw.text((x, 302), prefix, font=MONO, fill=TEXT)
    x += draw.textlength(prefix, font=MONO)
    if ghost:
        draw.text((x, 302), ghost, font=MONO, fill="#6b7b91")
        rounded(draw, (92, 383, 520, 439), "#102a32", 12, "#24585f")
        draw.text((111, 397), "Tab", font=SMALL, fill=CYAN)
        draw.text((168, 397), "accept local suggestion", font=SMALL, fill=TEXT)
    elif accepted:
        rounded(draw, (92, 383, 470, 439), "#142b21", 12, "#27583d")
        draw.text((111, 397), "Completed locally in <1 ms", font=SMALL, fill=GREEN)
    else:
        draw.line((x + 2, 302, x + 2, 332), fill=CYAN, width=3)
        draw.text((92, 393), "Type one character…", font=SMALL, fill=MUTED)

    rounded(draw, (52, 535, 280, 578), "#172b3a", 18)
    draw.text((72, 546), "COMMENTS EXCLUDED", font=TINY, fill=CYAN)
    rounded(draw, (300, 535, 518, 578), "#24213b", 18)
    draw.text((321, 546), "VARIABLE ORDER 2–6", font=TINY, fill=PURPLE)
    rounded(draw, (538, 535, 744, 578), "#1d2c22", 18)
    draw.text((562, 546), "NO NETWORK CALL", font=TINY, fill=GREEN)
    footer(draw)
    return image


def actual_completion(model: dict) -> str:
    prefix = (
        "def normalize_number(value):\n"
        "    # Comments do not affect local code suggestions.\n"
        "    if isinstance(value, float) and value."
    )
    scan = scan_text(prefix, ".py")
    raw = [token.value for token in scan["tokens"]]
    normalized = [token.normalized for token in scan["tokens"]]
    generated: list[str] = []
    for _ in range(4):
        choices = predict(model, ".py", raw, normalized, 1)
        if not choices:
            break
        token = choices[0]
        generated.append(token)
        token_scan = scan_text(token, ".py")
        if not token_scan["tokens"]:
            break
        raw.append(token_scan["tokens"][0].value)
        normalized.append(token_scan["tokens"][0].normalized)
        if token == ":":
            break
    suggestion = "".join(generated)
    if suggestion != "is_integer():":
        raise RuntimeError(f"Unexpected model demo suggestion: {suggestion!r}")
    return suggestion


def render_completion(model: dict):
    suggestion = actual_completion(model)
    frames = [
        editor_frame("value"),
        editor_frame("value.", suggestion),
        editor_frame(f"value.{suggestion}", accepted=True),
    ]
    frames[0].save(
        ASSETS / "completion-demo.gif",
        save_all=True,
        append_images=frames[1:],
        duration=[900, 1700, 1400],
        loop=0,
        optimize=True,
    )


def render_diagnostics(model: dict, benchmark: dict):
    image, draw = base(
        "Local model diagnostics",
        "Everything shown here is calculated and stored on this machine",
    )
    stats = [
        ("MODEL FORMAT", f"v{model['format_version']}", BLUE),
        ("N-GRAM ORDERS", f"{model['min_order']}–{model['max_order']}", PURPLE),
        ("PATTERNS", f"{model['total_patterns']:,}", CYAN),
        ("LOOKUP P95", f"{benchmark['p95_latency_ms']:.3f} ms", GREEN),
        ("TOP-3", f"{benchmark['top3_accuracy'] * 100:.1f}%", YELLOW),
        ("TELEMETRY", "None", GREEN),
    ]
    for index, (label, value, color) in enumerate(stats):
        col, row = index % 3, index // 3
        x, y = 28 + col * 390, 108 + row * 174
        rounded(draw, (x, y, x + 362, y + 146), PANEL, 16, BORDER)
        draw.text((x + 23, y + 20), label, font=TINY, fill=MUTED)
        draw.text((x + 23, y + 57), value, font=TITLE, fill=color)
    rounded(draw, (28, 472, 1172, 608), PANEL_2, 16, BORDER)
    draw.text((54, 493), "Active source", font=TINY, fill=MUTED)
    draw.text((54, 522), "Bundled starter model", font=BOLD, fill=TEXT)
    draw.text((54, 565), "Bundled data: JavaScript/TypeScript • Python", font=SMALL, fill=MUTED)
    footer(draw, "Model v3")
    image.save(ASSETS / "diagnostics.png", optimize=True)


def render_pack_manager():
    image, draw = base(
        "Free language packs",
        "Optional packs download only after explicit user action",
    )
    rounded(draw, (28, 94, 1172, 614), PANEL, 18, BORDER)
    draw.text((58, 124), "Manage Local N-Gram Language Packs", font=TITLE, fill=TEXT)
    draw.text((58, 169), "Starter model active  •  0 optional packs installed", font=SMALL, fill=MUTED)

    packs = [
        ("C# pack", "C# • Razor", "Not installed", BLUE),
        ("JavaScript + TypeScript", "JS • TS • JSX • TSX • Vue", "Not installed", YELLOW),
        ("Python pack", "Python", "Not installed", GREEN),
    ]
    for index, (name, languages, status, color) in enumerate(packs):
        y = 224 + index * 98
        rounded(draw, (58, y, 1140, y + 76), PANEL_2, 13, BORDER)
        rounded(draw, (76, y + 17, 118, y + 59), color, 10)
        draw.text((140, y + 12), name, font=UI, fill=TEXT)
        draw.text((140, y + 43), languages, font=TINY, fill=MUTED)
        rounded(draw, (916, y + 18, 1116, y + 58), "#12283a", 18, "#28506d")
        draw.text((951, y + 29), status.upper(), font=TINY, fill=CYAN)

    draw.text((58, 535), "SHA-256 verified   |   Atomic install   |   Stored in VS Code global storage", font=SMALL, fill=GREEN)
    footer(draw, "Pack manager")
    image.save(ASSETS / "pack-manager.png", optimize=True)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    with gzip.open(MODEL_PATH, "rt", encoding="utf-8") as model_file:
        model = json.load(model_file)
    with BENCHMARK_PATH.open("r", encoding="utf-8") as benchmark_file:
        benchmark = json.load(benchmark_file)
    render_completion(model)
    render_diagnostics(model, benchmark)
    render_pack_manager()
    for name in ("completion-demo.gif", "diagnostics.png", "pack-manager.png"):
        path = ASSETS / name
        print(f"{name}: {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
