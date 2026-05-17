#!/usr/bin/env python3
"""Resolve <target> path using the same precedence as resolve-target.mjs."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def resolve_target(argv: list[str] | None = None, env: dict[str, str] | None = None) -> Path:
    argv = list(sys.argv if argv is None else argv)
    env = os.environ if env is None else env
    if env.get("AGENTTEAMS_TARGET"):
        return Path(env["AGENTTEAMS_TARGET"]).resolve()
    if "--target" in argv:
        i = argv.index("--target")
        if i + 1 < len(argv):
            return Path(argv[i + 1]).resolve()
    try:
        root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        return Path(root) / "agentteams"
    except Exception:
        return Path.cwd() / "agentteams"


if __name__ == "__main__":
    print(resolve_target())
