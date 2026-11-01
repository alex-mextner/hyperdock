#!/usr/bin/env python3
"""Fills a scratch Downloads and Screenshots folder with a realistic mess.

Used by tools/stacks-shell.sh (D2DA_STACKS_BIG=1) to measure and look at the
stack dropdowns with the folders people really have: hundreds of files, long
names, many real full-size screenshot PNGs that have no freedesktop
thumbnail, folders, and dates spread over several months.

Usage: stacks-fixture.py WORKDIR [--downloads N] [--screenshots M]
Needs ImageMagick's `convert` for the base pictures (stdlib otherwise). The
pictures are made once and copied, so the cost is disk, not time.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time

DAY = 86400

LONG_NAMES = [
    'Quarterly financial report for the Moscow regional office - FINAL (v3) 2026.pdf',
    'Договор аренды помещения на Тверской улице подписанный скан.pdf',
    'invoice-%04d.pdf',
    'report-%04d.pdf',
    'notes-%04d.txt',
    'archive-%04d.zip',
    'setup-%04d.deb',
    'backup-%04d.tar.gz',
    'presentation-%04d.odp',
    'clip-%04d.mp4',
    'song-%04d.mp3',
]


def make_base_pictures(tmp):
    """Three full-size screenshots (RGB PNG) and two photos (JPEG)."""
    sizes = [('2560x1440', 6), ('1920x1080', 4), ('2880x1800', 8)]
    pngs = []
    for i, (size, blur) in enumerate(sizes):
        path = os.path.join(tmp, 'base%d.png' % i)
        subprocess.run(
            ['convert', '-size', size, 'plasma:fractal', '-blur', '0x%d' % blur,
             '-colors', '120', '+dither', 'PNG24:' + path],
            check=True,
        )
        pngs.append(path)
    jpgs = []
    for i, size in enumerate(['4000x3000', '3024x4032']):
        path = os.path.join(tmp, 'photo%d.jpg' % i)
        subprocess.run(
            ['convert', '-size', size, 'plasma:fractal', '-blur', '0x8',
             '-quality', '82', path],
            check=True,
        )
        jpgs.append(path)
    return pngs, jpgs


def stamp(path, age_days):
    t = time.time() - age_days * DAY
    os.utime(path, (t, t))


def fill_downloads(folder, count, pngs, jpgs):
    os.makedirs(folder, exist_ok=True)
    for i in range(count):
        # newest first, spread over ~100 days with a bulge of fresh files
        age = (i / count) ** 1.6 * 100
        kind = i % 10
        if kind in (0, 1):
            src = jpgs[i % len(jpgs)]
            path = os.path.join(folder, 'IMG_%04d.jpg' % i)
            shutil.copyfile(src, path)
        elif kind == 2:
            src = pngs[i % len(pngs)]
            path = os.path.join(folder, 'diagram-%04d-exported-from-figma.png' % i)
            shutil.copyfile(src, path)
        elif kind == 3 and i % 40 == 3:
            path = os.path.join(folder, 'Project folder %04d' % i)
            os.makedirs(path, exist_ok=True)
        else:
            pattern = LONG_NAMES[i % len(LONG_NAMES)]
            name = pattern % i if '%' in pattern else '%04d - %s' % (i, pattern)
            path = os.path.join(folder, name)
            with open(path, 'wb') as f:
                f.write(b'\0' * 64)
        stamp(path, age)


def fill_screenshots(folder, count, pngs):
    os.makedirs(folder, exist_ok=True)
    for i in range(count):
        age = (i / count) * 14
        t = time.time() - age * DAY
        lt = time.localtime(t)
        name = 'Screenshot from %s %02d-%02d-%02d.png' % (
            time.strftime('%Y-%m-%d', lt), lt.tm_hour, lt.tm_min, i % 60)
        path = os.path.join(folder, name)
        if os.path.exists(path):
            path = os.path.join(folder, name[:-4] + ' (%d).png' % i)
        shutil.copyfile(pngs[i % len(pngs)], path)
        os.utime(path, (t, t))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('work')
    ap.add_argument('--downloads', type=int, default=1200)
    ap.add_argument('--screenshots', type=int, default=700)
    args = ap.parse_args()
    tmp = os.path.join(args.work, 'base-pictures')
    os.makedirs(tmp, exist_ok=True)
    pngs, jpgs = make_base_pictures(tmp)
    fill_downloads(os.path.join(args.work, 'Downloads'), args.downloads, pngs, jpgs)
    fill_screenshots(os.path.join(args.work, 'Pictures', 'Screenshots'), args.screenshots, pngs)
    shutil.rmtree(tmp)
    print('fixture: %d downloads, %d screenshots' % (args.downloads, args.screenshots))


if __name__ == '__main__':
    sys.exit(main())
