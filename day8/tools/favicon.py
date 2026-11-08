"""Build favicon.svg: a little warrior in pixel art, with an automatic dark outline.

Every pixel of the map below is a rect (runs on a row are merged).
Run from the day8 folder: python tools/favicon.py
"""

ROWS = [
    '................',
    '............W...',
    '............Ww..',
    '....RRRR....Ww..',
    '...RRRRRR...Ww..',
    '...RSSSSR...Ww..',
    '...RESSER...Ww..',
    '...RSSCSR...Ww..',
    '..BBRRRRRR.GGGG.',
    '.BbbBrrrrrSSkk..',
    '.BbYbBrrrr..kk..',
    '.BbbBgggg.......',
    '..BBrrrrr.......',
    '.....LL.LL......',
    '.....DD.DD......',
    '................',
]
COLORS = {
    'R': '#e05050', 'r': '#a82a30', 'S': '#f2c6a0', 'E': '#1a1420', 'C': '#d0707a',
    'W': '#ffffff', 'w': '#9aa3b8', 'G': '#f2c14e', 'k': '#6a4422',
    'B': '#8d93a8', 'b': '#8a5a2c', 'Y': '#f2c14e', 'g': '#5e3a1a',
    'L': '#3a3446', 'D': '#5e3a1a',
}
OUTLINE = '#0c0a10'
N = 16

grid = [[COLORS.get(ch) for ch in row] for row in ROWS]
out = [row[:] for row in grid]
for y in range(N):
    for x in range(N):
        if grid[y][x]:
            continue
        if any(0 <= x + dx < N and 0 <= y + dy < N and grid[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            out[y][x] = OUTLINE

# runs of the same colour on a row become one rect
rects = []
for y in range(N):
    x = 0
    while x < N:
        c = out[y][x]
        if not c:
            x += 1
            continue
        x0 = x
        while x < N and out[y][x] == c:
            x += 1
        rects.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>' % (x0, y, x - x0, c))

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">\n'
       '  <defs><radialGradient id="glow" cx="0.5" cy="0.45" r="0.6">'
       '<stop offset="0" stop-color="#4a2a1a"/><stop offset="1" stop-color="#15121c"/></radialGradient></defs>\n'
       '  <rect width="16" height="16" rx="3" fill="url(#glow)"/>\n  '
       + '\n  '.join(rects) + '\n</svg>\n')
open('favicon.svg', 'w', newline='\n').write(svg)
print(len(rects), 'rects')
