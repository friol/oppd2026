# Builds assets/atlas.png and js/atlas.js from the original sprite sheet.
# Usage (from day1/): python tools/make_atlas.py
import json
from PIL import Image, ImageFilter

SRC = 'assets/sprites.png'
BG = (11, 13, 16)
TOL = 30

# name: (x, y, w, h) in the source sheet
RECTS = {}
for i, x in enumerate([43, 127, 206, 286, 362, 439, 512, 582, 653]):
    RECTS['ball%d' % i] = (x, 92, 50, 48)
RECTS['paddle'] = (758, 107, 137, 41)
RECTS['paddleA1'] = (922, 107, 125, 41)
RECTS['paddleA2'] = (1075, 107, 128, 38)
RECTS['paddleSmall'] = (1246, 111, 82, 33)
RECTS['paddleBig'] = (1372, 97, 136, 52)
COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple']
ROWS = [('', 296, [200, 302, 400, 498, 596, 693]),
        ('Dmg', 398, [200, 303, 400, 498, 595, 694]),
        ('Crk', 500, [200, 302, 401, 498, 596, 694])]
for suffix, y, xs in ROWS:
    for c, x in zip(COLORS, xs):
        RECTS['brick_' + c + suffix] = (x, y, 82, 48)
for name, x, y in [('extraBall', 857, 310), ('multiBall', 1000, 310), ('grow', 1131, 310),
                   ('shrink', 1272, 310), ('speed', 1413, 310), ('shield', 857, 504),
                   ('time', 1000, 504), ('points', 1139, 504), ('bomb', 1281, 504),
                   ('life', 1419, 504)]:
    RECTS['pu_' + name] = (x, y, 98 if name in ('grow', 'shrink', 'multiBall') else 80, 82)
for i, (cx, cy, s) in enumerate([(62, 846, 40), (143, 845, 56), (235, 843, 84), (338, 847, 100),
                                  (453, 844, 116), (571, 838, 120), (713, 836, 150)]):
    RECTS['boom%d' % i] = (cx - s // 2, cy - s // 2, s, s)
RECTS['lifeIcon'] = (1375, 823, 43, 27)

def near_bg(p):
    return abs(p[0] - BG[0]) + abs(p[1] - BG[1]) + abs(p[2] - BG[2]) < TOL

def cut(img, rect):
    x, y, w, h = rect
    c = img.crop((x - 2, y - 2, x + w + 2, y + h + 2)).convert('RGBA')
    W, H = c.size
    px = c.load()
    # flood fill background from the borders so dark outlines inside sprites survive
    stack = [(i, 0) for i in range(W)] + [(i, H - 1) for i in range(W)] + \
            [(0, j) for j in range(H)] + [(W - 1, j) for j in range(H)]
    seen = set()
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        if not near_bg(px[p]):
            continue
        px[p] = (0, 0, 0, 0)
        i, j = p
        for q in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in seen:
                stack.append(q)
    bbox = c.getbbox()
    return c.crop(bbox) if bbox else c

# Extra power-up icons (not in the sheet): 16x16 pixel-art badges in the same style.
# fill = (light, mid, dark) badge colours; symbol(x, y) returns a palette key or None.
def badge_icon(fill, symbol):
    pal = {'k': (16, 20, 24), 'L': fill[0], 'M': fill[1], 'D': fill[2],
           'W': (255, 255, 255), 'Y': (253, 224, 71), 'O': (249, 115, 22),
           'S': (170, 180, 195), 'G': (75, 85, 99)}
    n = 16
    inside = lambda x, y: 0 <= x < n and 0 <= y < n and min(x, n - 1 - x) + min(y, n - 1 - y) >= 2
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    for y in range(n):
        for x in range(n):
            if not inside(x, y):
                continue
            if not all(inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                c = 'k'
            elif x == 1 or y == 1 or (x == 2 and y == 2):
                c = 'L'
            elif x == n - 2 or y == n - 2:
                c = 'D'
            else:
                c = 'M'
            c = symbol(x, y) or c
            img.putpixel((x, y), pal[c] + (255,))
    return img.resize((80, 80), Image.NEAREST)

# Laser: teal badge with two vertical laser bolts
def laser_symbol(x, y):
    if 3 <= y <= 12 and x in (4, 5, 10, 11):
        return 'W' if y <= 4 else 'Y' if y <= 10 else 'O'
    return None

# Steel ball: blue badge with a shiny metal sphere
def steel_symbol(x, y):
    d = ((x - 7.5) ** 2 + (y - 7.5) ** 2) ** 0.5
    if d <= 4.6:
        if (x - 6) ** 2 + (y - 6) ** 2 <= 1.5:
            return 'W'
        return 'S' if d <= 3.4 else 'G'
    return None

# Warp gate: pink badge with two white chevrons pointing right (towards the exit)
def warp_symbol(x, y):
    if 4 <= y <= 11:
        d = 3 - abs(int(y - 7.5 + (0.5 if y >= 8 else -0.5)))  # 0..3 then back to 0
        for c0 in (3, 8):
            if x in (c0 + d, c0 + d + 1):
                return 'W'
    return None

# CPU gun (negative): red badge with a yellow arrow pointing down at the player
def cpu_gun_symbol(x, y):
    if 3 <= y <= 8 and x in (7, 8):
        return 'Y'
    if 9 <= y <= 12 and abs(x - 7.5) <= 12.5 - y - 0.5 * (y > 9) - 0.5:
        return 'Y' if y < 12 else 'O'
    return None

src = Image.open(SRC).convert('RGB')
parts = {n: cut(src, r) for n, r in RECTS.items()}
parts['pu_laser'] = badge_icon(((110, 231, 249), (20, 184, 166), (15, 118, 110)), laser_symbol)
parts['pu_cpuGun'] = badge_icon(((252, 140, 140), (200, 30, 30), (120, 10, 10)), cpu_gun_symbol)
parts['pu_warp'] = badge_icon(((249, 168, 212), (219, 39, 119), (131, 24, 67)), warp_symbol)
parts['pu_steel'] = badge_icon(((147, 197, 253), (37, 99, 235), (30, 58, 138)), steel_symbol)

# Space Invaders style aliens (level 4): classic "crab" in two leg poses, drawn as pixel art
# with a black outline and a soft coloured glow, one sprite per colour and pose.
# Keep ALIEN_SCALE / ALIEN_GLOW in sync with ALIEN_BODY_W in js/game.js: (11 + 2) * ALIEN_SCALE.
ALIEN_POSES = [
    ['..X.....X..',
     '...X...X...',
     '..XXXXXXX..',
     '.XX.XXX.XX.',
     'XXXXXXXXXXX',
     'X.XXXXXXX.X',
     'X.X.....X.X',
     '...XX.XX...'],
    ['..X.....X..',
     'X..X...X..X',
     'X.XXXXXXX.X',
     'XXX.XXX.XXX',
     'XXXXXXXXXXX',
     '.XXXXXXXXX.',
     '..X.....X..',
     '.X.......X.'],
]
ALIEN_COLORS = {'green': (70, 235, 40), 'cyan': (40, 200, 255), 'magenta': (240, 50, 230),
                'orange': (255, 160, 30), 'red': (240, 35, 35)}
ALIEN_SCALE = 4
ALIEN_GLOW = 8

def alien_sprite(rows, rgb):
    gw, gh = len(rows[0]) + 2, len(rows) + 2
    body = {(x + 1, y + 1) for y, r in enumerate(rows) for x, ch in enumerate(r) if ch == 'X'}
    light = tuple(min(255, c + 70) for c in rgb)
    dark = tuple(int(c * 0.7) for c in rgb)
    small = Image.new('RGBA', (gw, gh), (0, 0, 0, 0))
    for y in range(gh):
        for x in range(gw):
            if (x, y) in body:
                c = light if (x, y - 1) not in body else dark if (x, y + 1) not in body else rgb
                small.putpixel((x, y), c + (255,))
            elif any((x + dx, y + dy) in body for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                small.putpixel((x, y), (8, 8, 8, 255))
    big = small.resize((gw * ALIEN_SCALE, gh * ALIEN_SCALE), Image.NEAREST)
    g = ALIEN_GLOW
    out = Image.new('RGBA', (big.width + g * 2, big.height + g * 2), (0, 0, 0, 0))
    glow = Image.new('RGBA', out.size, rgb + (0,))
    glow.putalpha(Image.new('L', out.size, 0))
    mask = Image.new('L', out.size, 0)
    mask.paste(big.getchannel('A').point(lambda a: 150 if a else 0), (g, g))
    glow.putalpha(mask.filter(ImageFilter.GaussianBlur(5)))
    out = Image.alpha_composite(out, glow)
    layer = Image.new('RGBA', out.size, (0, 0, 0, 0))
    layer.paste(big, (g, g))
    return Image.alpha_composite(out, layer)

for cname, rgb in ALIEN_COLORS.items():
    for i, pose in enumerate(ALIEN_POSES):
        parts['alien_%s%d' % (cname, i)] = alien_sprite(pose, rgb)

# simple shelf packing
ATLAS_W = 1024
x = y = shelf = 0
frames = {}
for n, im in sorted(parts.items(), key=lambda kv: -kv[1].size[1]):
    w, h = im.size
    if x + w > ATLAS_W:
        x, y, shelf = 0, y + shelf + 2, 0
    frames[n] = (x, y, w, h)
    x += w + 2
    shelf = max(shelf, h)
atlas = Image.new('RGBA', (ATLAS_W, y + shelf), (0, 0, 0, 0))
for n, (fx, fy, w, h) in frames.items():
    atlas.paste(parts[n], (fx, fy))
atlas.save('assets/atlas.png')
with open('js/atlas.js', 'w') as f:
    f.write('// Generated by tools/make_atlas.py - do not edit by hand.\n')
    f.write('const ATLAS_FRAMES = ' + json.dumps(frames, indent=1, sort_keys=True) + ';\n')
print('atlas', atlas.size, len(frames), 'frames')
