"""Cut the sprites out of 'assets/roguelaike spritesheet.png' into a clean atlas.

The sheet has no regular grid, so every sprite is listed by hand as a loose
rectangle (x0, y0, x1, y1). Inside it the black background is removed with a
flood fill from the border, the sprite is cropped to what is left and scaled
into a square cell of the atlas. Tiles are stretched to fill the whole cell.

The hero is also saved in one colour per class (warrior_*, rogue_*, mage_*):
only the blue of the hood and clothes is moved to another hue.

Output: assets/atlas.png and js/atlas.js (cell positions by name).
Run from the day8 folder: python tools/slice.py
"""
import colorsys

from PIL import Image

SRC = 'assets/roguelaike spritesheet.png'
CELL = 64
COLS = 16
BG = 22  # max channel value still considered background

# name: (x0, y0, x1, y1, kind) where kind is 'tile' (fill) or 'sprite' (fit)
S = {}


def add(name, x0, y0, x1, y1, kind='sprite'):
    S[name] = (x0, y0, x1, y1, kind)


# hero: the labels on the sheet say UP, DOWN, LEFT, RIGHT, but the drawings are
# turned left, facing us, seen from the back and turned right
for n, (a, b) in zip(['left', 'down', 'up', 'right'],
                     [(20, 92), (104, 178), (190, 258), (264, 336)]):
    add('hero_' + n, a, 48, b, 144)

# enemies: two rows of frames
ENEMIES = {
    'skeleton': [(368, 432), (434, 482), (484, 530)],
    'slime': [(552, 596), (596, 642), (642, 692)],
    'goblin': [(708, 762), (762, 810), (810, 860)],
    'ghost': [(884, 946), (946, 1004)],
    'bat': [(1016, 1090), (1090, 1158)],
    'spider': [(1164, 1232)],
    'eyeball': [(1268, 1330), (1338, 1392)],
    'demon': [(1414, 1476), (1476, 1530)],
}
for n, cols in ENEMIES.items():
    rows = [(48, 102), (102, 164)] if n == 'eyeball' else [(48, 106), (106, 164)]
    for r, (y0, y1) in enumerate(rows):
        for c, (x0, x1) in enumerate(cols):
            add('%s_%d' % (n, r * len(cols) + c), x0, y0, x1, y1)

row = (248, 346)
for n, a, b in [('coins', 22, 104), ('chest', 132, 212), ('gem', 240, 320),
                ('potion', 356, 416), ('scroll', 448, 520), ('key', 542, 600),
                ('crown', 630, 714), ('ring', 740, 800)]:
    add(n, a, row[0], b, row[1])
for n, a, b in [('stairs_up', 858, 942), ('stairs_down', 974, 1060)]:
    add(n, a, row[0], b, row[1], 'tile')
for n, a, b in [('spikes', 1106, 1194), ('fire', 1218, 1302),
                ('pit', 1328, 1412), ('trap', 1432, 1516)]:
    add(n, a, row[0], b, row[1])

for n, a, b in [('floor', 18, 98), ('wall', 108, 204), ('corner', 216, 294),
                ('door', 308, 380), ('secret', 394, 466), ('water', 494, 568),
                ('lava', 578, 650), ('grass', 660, 732), ('sand', 740, 814),
                ('snow', 824, 896)]:
    add(n, a, 430, b, 518, 'tile')
for n, a, b in [('torch', 936, 990), ('candle', 1012, 1056),
                ('barrel', 1076, 1138), ('crate', 1150, 1214),
                ('urn', 1228, 1288), ('table', 1296, 1372),
                ('chair', 1384, 1436), ('bookshelf', 1446, 1520)]:
    add(n, a, 426, b, 516)

for n, a, b in [('explosion', 12, 96), ('sparkle', 100, 180),
                ('magic', 182, 256), ('smoke', 264, 336), ('blood', 340, 432),
                ('poison', 438, 520), ('arrow', 580, 618),
                ('fireball', 646, 720), ('ice', 726, 796),
                ('poison_bolt', 800, 878), ('bolt', 898, 980),
                ('heart', 1034, 1108), ('skull', 1130, 1192),
                ('question', 1210, 1264), ('alert', 1282, 1326),
                ('portal', 1336, 1420), ('teleport', 1430, 1530)]:
    add(n, a, 604, b, 700)

# dungeon tile variations: three rows of fifteen
XS = [18, 80, 144, 198, 260, 322, 386, 446, 510, 576, 636, 700, 766, 830, 896]
WS = [54, 54, 42, 54, 54, 56, 52, 56, 58, 52, 54, 56, 54, 56, 68]
for r, (y0, y1) in enumerate([(784, 856), (864, 910), (918, 980)]):
    for c in range(15):
        x0 = XS[c]
        x1 = x0 + WS[c]
        if r == 1 and c == 7:  # two tiles merged in the sheet
            x1 = x0 + 56
        add('dtile_%d_%d' % (r, c), x0, y0, x1, y1, 'tile')
S['dtile_1_8'] = (510, 864, 566, 910, 'tile')

for n, a, y0, b, y1 in [
        ('bone', 986, 784, 1040, 864), ('skull_small', 1050, 784, 1098, 864),
        ('web', 1100, 784, 1170, 864), ('rocks', 1172, 784, 1240, 864),
        ('mushroom', 1248, 784, 1300, 864), ('weeds', 1304, 784, 1366, 864),
        ('cactus', 1376, 780, 1434, 866), ('tree', 1446, 780, 1520, 866),
        ('flower', 986, 896, 1042, 966), ('crystals', 1046, 896, 1098, 966),
        ('crystal', 1100, 884, 1166, 966), ('bone2', 1176, 880, 1220, 966),
        ('bones', 1224, 896, 1278, 966), ('mushroom2', 1284, 896, 1334, 966),
        ('bush', 1334, 896, 1392, 966), ('frost', 1394, 896, 1452, 966),
        ('pine', 1456, 874, 1528, 978)]:
    add(n, a, y0, b, y1)


def cut(im, x0, y0, x1, y1, kind):
    reg = im.crop((x0, y0, x1, y1)).convert('RGBA')
    w, h = reg.size
    px = reg.load()
    dark = lambda x, y: max(px[x, y][:3]) <= BG
    seen = set()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + \
            [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or not dark(x, y):
            continue
        seen.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    for x, y in seen:
        px[x, y] = (0, 0, 0, 0)
    box = reg.getbbox()
    if kind == 'tile':
        # a small inset drops the dark seams, then the tile is made opaque
        reg = reg.crop((box[0] + 3, box[1] + 3, box[2] - 3, box[3] - 3))
        tile = Image.new('RGBA', reg.size, (12, 10, 14, 255))
        tile.alpha_composite(reg)
        return tile.resize((CELL, CELL), Image.LANCZOS)
    return reg.crop(box)


def group(name):
    # frames of the same creature share one scale
    if name.startswith('hero_'):
        return 'hero'
    return name.rsplit('_', 1)[0] if name[-1].isdigit() else name


def fit(reg, size):
    w, h = reg.size
    k = (CELL - 4) / size
    reg = reg.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    cell = Image.new('RGBA', (CELL, CELL))
    # centred horizontally, standing on the bottom of the cell
    cell.paste(reg, ((CELL - reg.width) // 2, CELL - 2 - reg.height), reg)
    return cell


# class colours: target hue (0-1) and a saturation/brightness factor
CLASSES = {'warrior': (0.0, 1.0, 0.95), 'rogue': (0.33, 0.8, 0.8), 'mage': (0.78, 1.0, 1.0)}
MERCHANT = (0.1, 0.8, 0.85)  # the merchant: the hero in brown and gold


def recolor(img, hue, sat, val):
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.5 < h < 0.75 and s > 0.3:
                r, g, b = colorsys.hsv_to_rgb(hue, min(1, s * sat), min(1, v * val))
                px[x, y] = (round(r * 255), round(g * 255), round(b * 255), a)
    return out


def main():
    im = Image.open(SRC).convert('RGB')
    names = list(S)
    rows = (len(names) + COLS - 1) // COLS
    atlas = Image.new('RGBA', (COLS * CELL, rows * CELL))
    pos = {}
    cuts = {n: cut(im, *S[n]) for n in names}
    size = {}
    for n in names:
        if S[n][4] != 'tile':
            g = group(n)
            size[g] = max(size.get(g, 0), *cuts[n].size)
    cells = {n: cuts[n] if S[n][4] == 'tile' else fit(cuts[n], size[group(n)]) for n in names}
    for cls, args in CLASSES.items():
        for d in ['up', 'down', 'left', 'right']:
            cells[cls + '_' + d] = recolor(cells['hero_' + d], *args)
    cells['merchant'] = recolor(cells['hero_down'], *MERCHANT)
    names = list(cells)
    rows = (len(names) + COLS - 1) // COLS
    atlas = Image.new('RGBA', (COLS * CELL, rows * CELL))
    for i, n in enumerate(names):
        c, r = i % COLS, i // COLS
        atlas.paste(cells[n], (c * CELL, r * CELL))
        pos[n] = [c, r]
    atlas.save('assets/atlas.png', optimize=True)
    lines = ',\n'.join('    %s: [%d, %d]' % (n, c, r) for n, (c, r) in pos.items())
    with open('js/atlas.js', 'w', newline='\n') as f:
        f.write('// Generated by tools/slice.py from "assets/roguelaike spritesheet.png".\n')
        f.write("'use strict';\n\nconst ATLAS = {\n  cell: %d,\n  sprites: {\n%s\n  }\n};\n" % (CELL, lines))
    print(len(names), 'sprites,', atlas.size)


main()
