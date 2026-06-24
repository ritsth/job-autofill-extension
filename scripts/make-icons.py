#!/usr/bin/env python3
"""Generate the extension PNG icons from the hand-drawn source art.

Reads assets/icon-source.png (the cropped, square icon artwork — a navy sketch of
a star + pencil) and writes public/icons/icon{16,48,128}.png with rounded corners
masked to transparency so it sits cleanly in the Chrome toolbar and Web Store.

Requires Pillow (`pip install pillow`). Run: python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw
import os

SRC = "assets/icon-source.png"
OUT = "public/icons"
SIZES = (16, 48, 128)
RADIUS_FRAC = 0.17  # rounded-corner radius as a fraction of the icon size


def rounded_mask(size):
    """Anti-aliased rounded-square alpha mask (4x supersampled)."""
    ss = 4
    big = size * ss
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, big - 1, big - 1], radius=int(big * RADIUS_FRAC), fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def main():
    art = Image.open(SRC).convert("RGB")
    os.makedirs(OUT, exist_ok=True)
    for size in SIZES:
        icon = art.resize((size, size), Image.LANCZOS).convert("RGBA")
        icon.putalpha(rounded_mask(size))
        icon.save(f"{OUT}/icon{size}.png")
        print(f"wrote {OUT}/icon{size}.png")


if __name__ == "__main__":
    main()
