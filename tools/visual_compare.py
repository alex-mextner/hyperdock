#!/usr/bin/env python3
"""Compare a shell screenshot with its golden image (stdlib only: zlib PNG codec).

  tools/visual_compare.py ACTUAL GOLDEN --crop X,Y,W,H [--channel-tolerance N]
                          [--max-diff-ratio R] [--diff-out PATH] [--update]

Both images are cropped to the same region first (the panel clock and anything else
outside the dock must not matter). A pixel differs when any RGB channel is more than
--channel-tolerance (default 12, absorbs llvmpipe/antialiasing noise) away; the check
fails when more than --max-diff-ratio (default 0.002) of the cropped pixels differ.
--update writes the cropped ACTUAL as the new GOLDEN instead of comparing.

Exit: 0 match (or updated), 1 regression, 2 unusable input.
"""

import argparse
import struct
import sys
import zlib
from pathlib import Path

SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PngError(Exception):
    pass


def read_png(path):
    """Return (width, height, rows) with rows a list of bytes, RGBA 8-bit."""
    data = Path(path).read_bytes()
    if data[:8] != SIGNATURE:
        raise PngError(f"{path}: not a PNG")
    pos = 8
    idat = []
    width = height = depth = color = interlace = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    if width is None:
        raise PngError(f"{path}: no IHDR")
    if depth != 8 or color not in (2, 6) or interlace != 0:
        raise PngError(f"{path}: only 8-bit RGB/RGBA non-interlaced PNG is supported")
    channels = 3 if color == 2 else 4
    stride = width * channels
    raw = zlib.decompress(b"".join(idat))
    if len(raw) != height * (stride + 1):
        raise PngError(f"{path}: truncated image data")

    rows = []
    previous = bytearray(stride)
    for y in range(height):
        offset = y * (stride + 1)
        mode = raw[offset]
        line = bytearray(raw[offset + 1 : offset + 1 + stride])
        if mode == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif mode == 2:
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 255
        elif mode == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 255
        elif mode == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = previous[i]
                c = previous[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + predictor) & 255
        elif mode != 0:
            raise PngError(f"{path}: bad filter {mode}")
        previous = line
        if channels == 3:
            rgba = bytearray(width * 4)
            rgba[0::4], rgba[1::4], rgba[2::4], rgba[3::4] = line[0::3], line[1::3], line[2::3], b"\xff" * width
            rows.append(bytes(rgba))
        else:
            rows.append(bytes(line))
    return width, height, rows


def write_png(path, width, height, rows):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(b"\x00" + row for row in rows)
    png = SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(png)


def crop(image, region):
    width, height, rows = image
    x, y, w, h = region
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
        raise PngError(f"crop {region} is outside the {width}x{height} image")
    return w, h, [row[x * 4 : (x + w) * 4] for row in rows[y : y + h]]


def differing_pixels(actual, golden, tolerance):
    """Row-major list of (x, y) whose RGB differs by more than tolerance."""
    width, height, a_rows = actual
    _, _, g_rows = golden
    bad = []
    for y in range(height):
        a, g = a_rows[y], g_rows[y]
        if a == g:
            continue
        for x in range(width):
            i = x * 4
            if (
                abs(a[i] - g[i]) > tolerance
                or abs(a[i + 1] - g[i + 1]) > tolerance
                or abs(a[i + 2] - g[i + 2]) > tolerance
            ):
                bad.append((x, y))
    return bad


def write_diff(path, actual, bad):
    width, height, rows = actual
    marked = [bytearray(row) for row in rows]
    for x, y in bad:
        marked[y][x * 4 : x * 4 + 4] = b"\xff\x00\x00\xff"
    write_png(path, width, height, [bytes(r) for r in marked])


def parse_crop(text):
    parts = [int(p) for p in text.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("want X,Y,W,H")
    return tuple(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("actual")
    parser.add_argument("golden")
    parser.add_argument("--crop", type=parse_crop, required=True)
    parser.add_argument("--channel-tolerance", type=int, default=12)
    parser.add_argument("--max-diff-ratio", type=float, default=0.002)
    parser.add_argument("--diff-out")
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args()

    try:
        actual = crop(read_png(args.actual), args.crop)
        if args.update:
            write_png(args.golden, *actual)
            print(f"visual: golden updated: {args.golden} ({actual[0]}x{actual[1]})")
            return 0
        golden = read_png(args.golden)
        if golden[:2] != actual[:2]:
            print(
                f"visual: golden is {golden[0]}x{golden[1]}, the cropped screenshot is "
                f"{actual[0]}x{actual[1]}; regenerate with --update",
                file=sys.stderr,
            )
            return 1
    except (PngError, OSError, zlib.error) as error:
        print(f"visual: {error}", file=sys.stderr)
        return 2

    bad = differing_pixels(actual, golden, args.channel_tolerance)
    ratio = len(bad) / (actual[0] * actual[1])
    print(f"visual: {len(bad)} of {actual[0] * actual[1]} pixels differ ({ratio:.4%}, limit {args.max_diff_ratio:.4%})")
    if ratio > args.max_diff_ratio:
        if args.diff_out:
            write_diff(args.diff_out, actual, bad)
            print(f"visual: diff written to {args.diff_out}")
        print("visual: REGRESSION: the dock no longer renders like the golden image", file=sys.stderr)
        return 1
    print("visual: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
