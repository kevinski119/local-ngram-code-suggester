"""Render exact, editable product graphics and an illustrated engine-verified demo.

Prerequisites: Pillow and ffmpeg. Run npm run compile, then node scripts/export-demo-data.js.
Usage: python scripts/render-v31-media.py --output PATH [--stills-only]
This renders original graphics from code; it does not modify screenshots.
"""
from pathlib import Path
import argparse
import json
import math
import re
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / 'extension/assets/marketplace/demo-data-v31.json').read_text())
S = 2
W, H = 1600, 900
PAPER = '#F3F2EB'
INK = '#18241F'
MUTED = '#617068'
LIME = '#CEEF9A'
DARK = '#17221E'
CODE = '#E9EDE5'
GHOST = '#91A197'
FONT_ROOT = Path('C:/Windows/Fonts')
FONTS = {}


def font(size, kind='ui'):
    key = (size, kind)
    if key not in FONTS:
        name = {'ui': 'segoeui.ttf', 'bold': 'segoeuib.ttf', 'light': 'segoeuil.ttf', 'mono': 'CascadiaMono.ttf'}[kind]
        FONTS[key] = ImageFont.truetype(str(FONT_ROOT / name), int(size * S))
    return FONTS[key]


def text(im, xy, value, size=22, color=INK, kind='ui', anchor=None):
    ImageDraw.Draw(im).text((int(xy[0] * S), int(xy[1] * S)), value, font=font(size, kind), fill=color, anchor=anchor)


def width(value, size=22, kind='ui'):
    return font(size, kind).getlength(value) / S


def box(im, bounds, fill, radius=16, border=None, stroke=1):
    ImageDraw.Draw(im).rounded_rectangle(tuple(int(v * S) for v in bounds), radius=int(radius * S), fill=fill, outline=border, width=stroke * S)


def line(im, bounds, fill, thickness=1):
    ImageDraw.Draw(im).line(tuple(int(v * S) for v in bounds), fill=fill, width=thickness * S)


def shadow(im, bounds, radius=22):
    layer = Image.new('RGBA', im.size)
    ImageDraw.Draw(layer).rounded_rectangle(tuple(int(v * S) for v in bounds), radius=radius * S, fill=(14, 35, 23, 35))
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(18 * S)), (0, 12 * S))


def background():
    im = Image.new('RGBA', (W * S, H * S), PAPER)
    # Subtle drafting grid anchors the editorial layout without competing with code.
    for x in range(1170, 1600, 28):
        for y in range(90, 850, 28):
            box(im, (x, y, x + 1, y + 1), '#D9DFD1', 0)
    return im


def brand(im):
    box(im, (64, 42, 104, 82), INK, 11)
    text(im, (72, 45), 'n', 26, LIME, 'mono')
    text(im, (119, 45), 'LOCAL N-GRAM', 22, INK, 'bold')
    box(im, (318, 47, 369, 77), '#E1E7D8', 15)
    text(im, (331, 51), '3.1', 15, INK, 'bold')
    box(im, (1361, 46, 1536, 78), '#E1E7D8', 16)
    box(im, (1376, 58, 1384, 66), '#3D7556', 4)
    text(im, (1395, 50), 'RUNS LOCALLY', 14, INK, 'bold')


def code(im, xy, value, size=24, override=None):
    x, y = xy
    if value.lstrip().startswith('//'):
        text(im, xy, value, size, '#7F9588', 'mono')
        return width(value, size, 'mono')
    tokens = re.findall(r'[A-Za-z_][A-Za-z_0-9]*|\s+|.', value)
    keywords = {'let', 'mut', 'async', 'fn', 'await', 'return', 'pub'}
    for i, token in enumerate(tokens):
        color = override or ('#C5B8E3' if token in keywords else '#A8D7C0' if i + 1 < len(tokens) and tokens[i + 1] == '(' else CODE)
        text(im, (x, y), token, size, color, 'mono')
        x += width(token, size, 'mono')
    return x - xy[0]


def editor(im, x, y, w, h, size=24, title='client.rs'):
    shadow(im, (x, y, x + w, y + h))
    box(im, (x, y, x + w, y + h), DARK, 20, '#304037')
    for i, color in enumerate(['#789080', '#A1B58C', '#C5D0B5']):
        box(im, (x + 24 + i * 18, y + 23, x + 31 + i * 18, y + 30), color, 4)
    text(im, (x + 104, y + 15), title, 17, '#B7C8BB', 'mono')
    text(im, (x + w - 66, y + 17), 'Rust', 15, '#A8BDAD')
    line(im, (x, y + 54, x + w, y + 54), '#304037')
    line(im, (x, y + h - 39, x + w, y + h - 39), '#304037')
    text(im, (x + 24, y + h - 29), 'UTF-8   ·   Rust', 13, '#91A197', 'mono')
    box(im, (x + w - 151, y + h - 29, x + w - 143, y + h - 21), LIME, 4)
    text(im, (x + w - 134, y + h - 32), 'N-Gram', 15, '#CFE1D2')


def num(im, x, y, value, size=22):
    text(im, (x, y), str(value), size, '#52695B', 'mono')


def footer(im, right='Illustrated demo · verified completion output'):
    line(im, (64, 830, 1536, 830), '#D5DCCF')
    text(im, (64, 850), 'LOCAL N-GRAM CODE SUGGESTER', 14, MUTED, 'bold')
    text(im, (1536, 850), right, 14, MUTED, anchor='ra')


def hero():
    im = background()
    brand(im)
    text(im, (64, 159), 'Your patterns.', 79, INK, 'bold')
    text(im, (64, 252), 'Your machine.', 79, INK, 'bold')
    text(im, (67, 385), 'Code completion that learns locally.', 25, MUTED)
    text(im, (67, 425), 'No account. No LLM. No cloud inference.', 23, MUTED)
    box(im, (65, 508, 316, 565), INK, 28)
    text(im, (91, 519), 'Built for your flow', 22, LIME, 'bold')
    text(im, (67, 609), 'Rust + C# + Java + JS/TS', 19, INK)
    text(im, (67, 641), 'Python + JSON and more', 19, MUTED)

    x, y, w, h = 721, 162, 815, 520
    editor(im, x, y, w, h, title='patterns.rs')
    rows = [(1, '// A pattern from your project'), (2, DATA['source']), (3, ''), (4, '// Right when you need it'), (5, DATA['prefix'])]
    for n, value in rows:
        yy = y + 90 + (n - 1) * 48
        num(im, x + 25, yy, n, 18)
        code(im, (x + 67, yy), value, 20)
    xx = x + 67 + width(DATA['prefix'], 20, 'mono')
    code(im, (xx, y + 282), DATA['completion'], 20, GHOST)
    box(im, (x + 68, y + 375, x + 117, y + 409), '#324237', 7, '#536B59')
    text(im, (x + 78, y + 380), 'Tab', 15, LIME, 'mono')
    text(im, (x + 130, y + 378), 'Accept a familiar pattern', 18, '#BCD0C1')

    for x, title, caption in [(64, '01  REUSE YOUR CODE', 'Real project patterns. Original spacing.'),
                              (568, '02  KEEP IT LOCAL', 'No code sent for inference.'),
                              (1072, '03  STAY IN CONTROL', 'Pause, tune, or reset in a click.')]:
        line(im, (x, 730, x + 464, 730), '#B7C6AC', 2)
        text(im, (x, 748), title, 17, INK, 'bold')
        text(im, (x, 778), caption, 18, MUTED)
    footer(im, 'Product illustration · Quality mode · 12-token limit')
    return im


def demo_base():
    im = background()
    brand(im)
    text(im, (64, 114), 'From your code. Back into your flow.', 55, INK, 'bold')
    text(im, (67, 191), 'Familiar Rust expressions, completed entirely on your machine.', 24, MUTED)
    editor(im, 64, 259, 1060, 524)
    for n, value in [(1, '// Pattern from an open project file'), (2, DATA['source']), (3, ''), (4, '// Elsewhere in the same project')]:
        yy = 354 + (n - 1) * 55
        num(im, 92, yy, n, 22)
        code(im, (139, yy), value, 25)
    num(im, 92, 574, 5, 22)
    footer(im, 'Illustrated demo · engine-verified · Quality / 12 tokens')
    return im


def demo_frame(base, t):
    im = base.copy()
    if t < 2.5:
        stage = 0
        typed, ghost, accepted = '', '', False
    elif t < 4.2:
        stage = 1
        count = min(len(DATA['prefix']), int((t - 2.5) / 1.5 * len(DATA['prefix'])) + 1)
        typed, ghost, accepted = DATA['prefix'][:count], '', False
    elif t < 7.6:
        stage = 1
        typed, ghost, accepted = DATA['prefix'], DATA['completion'], False
    else:
        stage = 2
        typed, ghost, accepted = DATA['prefix'] + DATA['completion'], '', True

    if stage == 0:
        box(im, (129, 407, 1096, 451), '#253B2C', 6)
        code(im, (139, 409), DATA['source'], 25)
    if accepted:
        box(im, (129, 572, 1096, 616), '#2C3C29', 6)
    xx = 139 + code(im, (139, 574), typed, 25)
    if ghost:
        code(im, (xx, 574), ghost, 25, GHOST)
    if (int(t * 2) % 2 == 0) and not accepted:
        line(im, (xx + 1, 578, xx + 1, 608), LIME, 2)
    if ghost:
        pressed = t >= 7.1
        box(im, (139, 660, 200, 704), LIME if pressed else '#304338', 9, '#5D7865')
        text(im, (152, 668), 'Tab', 19, INK if pressed else LIME, 'mono')
        text(im, (219, 669), 'Accept suggestion', 20, '#BCCDC0')
    elif accepted:
        box(im, (139, 659, 169, 689), LIME, 15)
        line(im, (147, 674, 153, 680, 163, 668), INK, 2)
        text(im, (184, 660), 'Accepted. Still entirely local.', 21, LIME)

    steps = [('Learn a pattern', ['From an indexed', 'open project file.']),
             ('Recognize context', ['Reuse the expression.', 'Keep its spacing.']),
             ('Accept with Tab', ['Your choices shape', 'this session’s ranking.'])]
    for i, (title, lines) in enumerate(steps):
        yy = 259 + i * 161
        active = i == stage
        box(im, (1160, yy, 1536, yy + 139), LIME if active else '#E8EADF', 18)
        text(im, (1185, yy + 17), f'0{i + 1}', 15, '#486345' if active else '#71806C', 'mono')
        text(im, (1185, yy + 44), title, 24, INK, 'bold')
        for j, value in enumerate(lines):
            text(im, (1185, yy + 83 + j * 24), value, 18, '#4E6350' if active else MUTED)
    # A quiet progress bar, separate from simulated editor chrome.
    box(im, (1160, 759, 1536, 766), '#D6DDCD', 3)
    box(im, (1160, 759, 1160 + 376 * min(t / 12, 1), 766), '#658250', 3)
    return im


def controls():
    im = background()
    brand(im)
    text(im, (64, 147), 'Local by design.', 72, INK, 'bold')
    text(im, (64, 233), 'Yours to control.', 72, INK, 'bold')
    for i, (title, caption) in enumerate([
        ('Pause whenever you want', 'One click to stop. One click to resume.'),
        ('Tune the amount of help', 'Adjust frequency, length and confidence.'),
        ('Reset what it remembers', 'Session preferences stay in memory.')]):
        yy = 383 + i * 107
        box(im, (65, yy + 4, 89, yy + 28), '#D8E8BD', 12)
        text(im, (106, yy), title, 25, INK, 'bold')
        text(im, (106, yy + 40), caption, 20, MUTED)
    x, y, w, h = 740, 164, 796, 588
    editor(im, x, y, w, h, title='Local N-Gram controls')
    box(im, (x + 26, y + 77, x + w - 26, y + 129), '#22332A', 10, '#5B795A')
    text(im, (x + 44, y + 90), 'Local N-Gram · Offline completion', 21, '#D6E5D4')
    items = [('Pause suggestions', 'Local completion only'), ('Settings', 'Frequency, length, confidence and learning'),
             ('Diagnostics', 'Model, learned files and latency'), ('Relearn open files', 'Refresh project patterns'),
             ('Reset session preferences', 'Forget which suggestions you accepted')]
    for i, (title, caption) in enumerate(items):
        yy = y + 146 + i * 75
        if i == 0: box(im, (x + 27, yy, x + w - 27, yy + 67), '#324A35', 8)
        text(im, (x + 49, yy + 5), title, 22, LIME if i == 0 else CODE, 'bold' if i == 0 else 'ui')
        text(im, (x + 49, yy + 37), caption, 16, '#9FB3A4')
    footer(im, 'Controls illustration · labels from v3.1')
    return im


def export(im, path):
    im.convert('RGB').resize((W, H), Image.Resampling.LANCZOS).save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stills-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    export(hero(), args.output / 'hero-v31.png')
    base = demo_base()
    export(demo_frame(base, 5.5), args.output / 'rust-completion-v31.png')
    export(controls(), args.output / 'controls-v31.png')
    if args.stills_only: return
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg: raise RuntimeError('ffmpeg must be on PATH')
    mp4 = args.output / 'rust-demo-v31.mp4'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    encoder = subprocess.Popen([ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', '12', '-i', '-',
        '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(mp4)], stdin=subprocess.PIPE, creationflags=flags)
    for frame in range(144):
        im = demo_frame(base, frame / 12).convert('RGB').resize((W, H), Image.Resampling.LANCZOS)
        encoder.stdin.write(im.tobytes())
    encoder.stdin.close()
    if encoder.wait() != 0: raise RuntimeError('Video encoding failed')
    subprocess.run([ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(mp4),
        '-filter_complex', 'fps=10,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
        '-loop', '0', str(args.output / 'rust-demo-v31.gif')], check=True, creationflags=flags)
    print(f'Created 3 PNGs, a 12-second MP4 and a looping GIF in {args.output}')


if __name__ == '__main__': main()
