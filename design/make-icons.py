"""Regenerate the logo variants and app icons from the master logo.

Usage: python3 design/make-icons.py design/logo.webp public   (needs Pillow)
"""
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
# Trim fully transparent margins
bbox = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
im = im.crop(bbox)
pad = 12
c = Image.new("RGBA", (im.width + 2*pad, im.height + 2*pad), (0,0,0,0)); c.paste(im, (pad,pad)); im = c
im = im.resize((800, int(im.height * 800 / im.width)), Image.LANCZOS)
im.save(f"{out}/logo.png", optimize=True)
print("trimmed", im.size)
# Light-background variant: near-white, low-saturation pixels -> navy #0F172A
px = im.load(); lt = im.copy(); lp = lt.load()
for y in range(im.height):
    for x in range(im.width):
        r,g,b,a = px[x,y]
        if a and min(r,g,b) > 200 and max(r,g,b)-min(r,g,b) < 30:
            lp[x,y] = (15,23,42,a)
lt.save(f"{out}/logo-on-light.png", optimize=True)
# Square icon: the wrench + car mark (top part of the logo) on navy
full = Image.open(src).convert("RGBA")
mark = full.crop((20, 190, 1536, 600))
# Drop the "SAI MOTOR WORKS" lettering that sits under the spanner (keep the jaw on the left)
mp = mark.load()
for y in range(330, mark.height):
    for x in range(215, mark.width):
        mp[x, y] = (0, 0, 0, 0)
mb = mark.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox(); mark = mark.crop(mb)
def icon(size, bg=True):
    c = Image.new("RGBA", (size,size), (15,23,42,255) if bg else (0,0,0,0))
    w = int(size*0.84); h = int(mark.height * w / mark.width)
    m = mark.resize((w,h), Image.LANCZOS)
    c.alpha_composite(m, ((size-w)//2, (size-h)//2))
    return c
icon(512).save(f"{out}/icon-512.png", optimize=True)
icon(192).save(f"{out}/icon-192.png", optimize=True)
icon(180).convert("RGB").save(f"{out}/apple-icon.png", optimize=True)
icon(48).save(f"{out}/favicon.ico", sizes=[(16,16),(32,32),(48,48)])
