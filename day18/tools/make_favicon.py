# Builds the favicon of undefAIned: a pixel art sports car (red like the player's car, dark navy
# outline like the HUD). Two hand drawn versions, 32x32 and 16x16 (a 16x16 scaled down from the
# big one would lose the details), written as img/favicon.png (32x32) and img/favicon.ico
# (16, 32 and 64 px; 64 = the 32 px art doubled with nearest neighbour).
# Run from day18: python tools/make_favicon.py
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'img')

PAL = {
    '.': None,
    'K': (22, 14, 42),        # outline (the ink colour of the HUD)
    'R': (224, 32, 26),       # body red (PLAYER_PAINT)
    'L': (255, 110, 84),      # highlight
    'r': (160, 20, 16),       # dark red (lower body, spoiler)
    'W': (127, 212, 255),     # window
    'w': (42, 95, 160),       # window shade
    'S': (255, 255, 255),     # racing stripe
    'Y': (255, 225, 74),      # headlight
    'T': (255, 130, 40),      # tail light
    'B': (26, 26, 34),        # tyre
    'G': (200, 200, 210),     # rim
}

# The art is built from shapes (rows, discs) and then outlined automatically: every empty pixel
# next to a filled one becomes the dark outline colour. The car faces right.
def build(size, ops):
    g = [['.'] * size for _ in range(size)]

    def put(x, y, ch):
        if 0 <= x < size and 0 <= y < size:
            g[y][x] = ch

    for op in ops:
        if op[0] == 'row':
            _, y, x0, x1, ch = op
            for x in range(x0, x1 + 1):
                put(x, y, ch)
        elif op[0] == 'disc':
            _, cx, cy, r, ch = op
            for y in range(cy - r, cy + r + 1):
                for x in range(cx - r, cx + r + 1):
                    if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.5:
                        put(x, y, ch)
        elif op[0] == 'px':
            put(op[1], op[2], op[3])
    out = [r[:] for r in g]
    for y in range(size):
        for x in range(size):
            if g[y][x] == '.' and any(0 <= x + dx < size and 0 <= y + dy < size and g[y + dy][x + dx] != '.'
                                      for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out[y][x] = 'K'
    return [''.join(r) for r in out]


ART32 = build(32, [
    # spoiler (rear = left) and its support
    ('row', 11, 2, 7, 'r'), ('row', 12, 2, 7, 'r'), ('px', 4, 13, 'r'), ('px', 4, 14, 'r'), ('px', 5, 13, 'r'), ('px', 5, 14, 'r'),
    # roof and windows (the windscreen slopes to the right), with a pillar in the middle
    ('row', 12, 13, 19, 'R'),
    ('row', 13, 13, 21, 'W'), ('row', 14, 12, 22, 'W'), ('row', 15, 11, 23, 'W'),
    ('px', 17, 13, 'w'), ('px', 17, 14, 'w'), ('px', 17, 15, 'w'),
    # body: trunk and hood, side with the stripe, lower sill
    ('row', 16, 5, 26, 'R'), ('row', 16, 8, 13, 'L'),
    ('row', 17, 3, 28, 'R'), ('row', 17, 8, 14, 'L'),
    ('row', 18, 2, 29, 'S'),
    ('row', 19, 2, 30, 'R'),
    ('row', 20, 2, 30, 'r'), ('row', 21, 3, 29, 'r'),
    ('px', 29, 19, 'Y'), ('px', 30, 19, 'Y'), ('px', 30, 20, 'Y'), ('px', 29, 20, 'Y'),
    ('px', 2, 19, 'T'), ('px', 2, 20, 'T'), ('px', 3, 19, 'T'),
    # wheels
    ('disc', 8, 21, 3, 'B'), ('disc', 23, 21, 3, 'B'), ('disc', 8, 21, 1, 'G'), ('disc', 23, 21, 1, 'G'),
])

ART16 = build(16, [
    ('row', 4, 6, 9, 'R'),
    ('row', 5, 5, 10, 'W'), ('px', 8, 5, 'w'),
    ('row', 6, 3, 13, 'R'), ('row', 6, 4, 6, 'L'),
    ('row', 7, 1, 14, 'S'),
    ('row', 8, 1, 14, 'R'), ('px', 14, 8, 'Y'), ('px', 1, 8, 'T'),
    ('row', 9, 1, 14, 'r'),
    ('disc', 4, 10, 2, 'B'), ('disc', 11, 10, 2, 'B'), ('px', 4, 10, 'G'), ('px', 11, 10, 'G'),
])


def render(art, size):
    assert len(art) == size and all(len(r) == size for r in art), [len(r) for r in art]
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for y, row in enumerate(art):
        for x, ch in enumerate(row):
            c = PAL[ch]
            if c:
                im.putpixel((x, y), c + (255,))
    return im


a32, a16 = render(ART32, 32), render(ART16, 16)
a64 = a32.resize((64, 64), Image.NEAREST)
os.makedirs(OUT, exist_ok=True)
a32.save(os.path.join(OUT, 'favicon.png'))
a64.save(os.path.join(OUT, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (64, 64)], append_images=[a16, a32])
print('favicon.png 32x32, favicon.ico 16/32/64')
# a preview, enlarged, next to the tab size
prev = Image.new('RGBA', (32 * 8 + 16 * 8 + 40, 32 * 8 + 20), (240, 240, 245, 255))
prev.alpha_composite(a32.resize((256, 256), Image.NEAREST), (10, 10))
prev.alpha_composite(a16.resize((128, 128), Image.NEAREST), (276, 10))
prev.save(os.path.join(HERE, 'favicon_preview.png'))
