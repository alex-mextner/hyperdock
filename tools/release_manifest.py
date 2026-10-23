#!/usr/bin/env python3
"""Release bookkeeping for the tag-triggered release workflow.

  tools/release_manifest.py check TAG            TAG must be vMAJOR.MINOR.PATCH and equal
                                                 package.json's version
  tools/release_manifest.py manifest TAG ZIP...  write release.json and SHA256SUMS next to
                                                 the zips (the first ZIP is the extension
                                                 zip named after the uuid)

release.json is the stable, machine-readable pointer an updater follows: it is attached to
every release, so `releases/latest/download/release.json` always describes the newest one.
Stdlib only.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


def load_json(name):
    return json.loads((REPO / name).read_text())


def check(tag):
    if not TAG.match(tag):
        print(f"release: tag '{tag}' is not vMAJOR.MINOR.PATCH", file=sys.stderr)
        return 1
    version = load_json("package.json")["version"]
    if tag != f"v{version}":
        print(
            f"release: tag {tag} does not match package.json version {version}; "
            "bump package.json in a merged PR, then tag that commit",
            file=sys.stderr,
        )
        return 1
    metadata = load_json("metadata.json")
    for key in ("uuid", "name", "shell-version", "version"):
        if key not in metadata:
            print(f"release: metadata.json has no '{key}'", file=sys.stderr)
            return 1
    print(f"release: {tag} OK ({metadata['uuid']}, metadata version {metadata['version']})")
    return 0


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest(tag, zips):
    metadata = load_json("metadata.json")
    paths = [Path(z) for z in zips]
    extension_zip = paths[0]
    if extension_zip.name != f"{metadata['uuid']}.zip":
        print(f"release: {extension_zip.name} is not {metadata['uuid']}.zip", file=sys.stderr)
        return 1
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=REPO, check=True, capture_output=True, text=True
    ).stdout.strip()
    out_dir = extension_zip.parent
    sums = {p.name: sha256(p) for p in paths}
    document = {
        "schema": 1,
        "name": metadata["name"],
        "tag": tag,
        "version": tag.removeprefix("v"),
        "uuid": metadata["uuid"],
        "shell-version": metadata["shell-version"],
        "zip": extension_zip.name,
        "sha256": sums[extension_zip.name],
        "size": extension_zip.stat().st_size,
        "commit": commit,
        "released": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (out_dir / "release.json").write_text(json.dumps(document, indent=2) + "\n")
    (out_dir / "SHA256SUMS").write_text("".join(f"{h}  {n}\n" for n, h in sums.items()))
    print(f"release: wrote {out_dir / 'release.json'} and SHA256SUMS for {tag}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check").add_argument("tag")
    m = sub.add_parser("manifest")
    m.add_argument("tag")
    m.add_argument("zips", nargs="+")
    args = parser.parse_args()
    if args.command == "check":
        return check(args.tag)
    return manifest(args.tag, args.zips)


if __name__ == "__main__":
    sys.exit(main())
