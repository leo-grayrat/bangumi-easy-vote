#!/usr/bin/env python3
"""Local style preview helper for the ranking poster."""
from __future__ import annotations

import argparse
import copy
import json
import time
from pathlib import Path

import render


def deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_config(config_path: Path, style_path: Path | None) -> dict:
    cfg = load_json(config_path)
    if style_path is not None and style_path.exists():
        cfg = deep_merge(cfg, load_json(style_path))

    assets = cfg.get("assets")
    if assets and not Path(assets).is_absolute():
        repo_root = Path(__file__).resolve().parents[2]
        cfg["assets"] = str((repo_root / assets).resolve())
    return cfg


def render_once(config_path: Path, style_path: Path | None, output: Path) -> None:
    cfg = build_config(config_path, style_path)
    render.render(cfg, output)
    print(f"rendered: {output}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Render a poster with an optional local style override.")
    ap.add_argument("config", type=Path, nargs="?", default=Path("sample.json"))
    ap.add_argument("--style", type=Path, default=None, help="local JSON override, e.g. style.local.json")
    ap.add_argument("-o", "--output", type=Path, default=Path("preview.png"))
    ap.add_argument("--watch", action="store_true", help="rerender whenever config/style is saved")
    args = ap.parse_args()

    render_once(args.config, args.style, args.output)
    if not args.watch:
        return

    watched = [args.config]
    if args.style is not None:
        watched.append(args.style)
    mtimes = {p: p.stat().st_mtime_ns if p.exists() else None for p in watched}
    print("watching for changes; Ctrl+C to stop")
    try:
        while True:
            time.sleep(0.5)
            changed = False
            for path in watched:
                current = path.stat().st_mtime_ns if path.exists() else None
                if current != mtimes[path]:
                    mtimes[path] = current
                    changed = True
            if changed:
                try:
                    render_once(args.config, args.style, args.output)
                except Exception as exc:
                    print(f"render failed: {exc}")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
