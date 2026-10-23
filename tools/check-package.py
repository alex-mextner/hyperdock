#!/usr/bin/env python3
"""Build the extension zip with tools/publish.sh and verify what would ship.

Catches the packaging mistakes a tag would otherwise publish: a missing required
file, a dev-only file leaking in, a relative import that points at a module the zip
does not contain (publish.sh copies an explicit directory list, so a new top-level
directory is silently left out), or a zip whose metadata.json disagrees with the repo.

Usage: tools/check-package.py [--zip PATH]   (default: build via tools/publish.sh)
Exit:  0 ok, 1 problems found.
"""

import argparse
import json
import posixpath
import re
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

REQUIRED = ["metadata.json", "extension.js", "prefs.js", "stylesheet.css"]
REQUIRED_GLOBS = [re.compile(r"^schemas/.+\.gschema\.xml$")]
FORBIDDEN = re.compile(
    r"^(tests|tools|ci|agents|node_modules|\.github|screenshots|\.githooks)/"
    r"|^(package(-lock)?\.json|rig\.yaml|eslint\.config\.js|\.oxlintrc\.json|Makefile)$"
    r"|\.compiled$|\.zip$|\.rig-bak"
)
IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""")


def build_zip():
    subprocess.run([str(REPO / "tools" / "publish.sh")], check=True, stdout=subprocess.DEVNULL)
    uuid = json.loads((REPO / "metadata.json").read_text())["uuid"]
    return REPO / f"{uuid}.zip"


def verify(zip_path):
    problems = []
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        for required in REQUIRED:
            if required not in names:
                problems.append(f"missing required file: {required}")
        for pattern in REQUIRED_GLOBS:
            if not any(pattern.match(n) for n in names):
                problems.append(f"missing required file matching {pattern.pattern}")
        for name in sorted(names):
            if FORBIDDEN.search(name):
                problems.append(f"dev-only file in the zip: {name}")

        if "metadata.json" in names:
            shipped = json.loads(archive.read("metadata.json"))
            source = json.loads((REPO / "metadata.json").read_text())
            if shipped != source:
                problems.append("zip metadata.json differs from the repo's metadata.json")
            if "50" not in shipped.get("shell-version", []):
                problems.append("metadata.json shell-version does not list 50")
            if zip_path.name != f"{shipped['uuid']}.zip":
                problems.append(f"zip is named {zip_path.name}, expected {shipped['uuid']}.zip")

        for name in sorted(n for n in names if n.endswith(".js")):
            for spec in IMPORT.findall(archive.read(name).decode("utf-8")):
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), spec))
                if target not in names:
                    problems.append(f"{name} imports {spec}, which is not in the zip")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--zip", type=Path, help="verify this zip instead of building one")
    args = parser.parse_args()

    zip_path = args.zip or build_zip()
    problems = verify(zip_path)
    for problem in problems:
        print(f"check-package: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"check-package: {zip_path.name} OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
