#!/usr/bin/env python3
"""Pack UI2HTML project PNGs into an engine-compatible imageset.

The TypeScript exporter owns the engine JSON and the frame-name mapping. This
tool only creates the imageset PNG/JSON, so the browser export and the staged
engine package cannot silently diverge in Area or property conversion rules.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image


def safe_source(root: Path, relative: str) -> Path:
    candidate = (root / relative.replace("\\", "/")).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise ValueError(f"非法资源路径：{relative}")
    return candidate


def pack_assets(assets_dir: Path, output_dir: Path, atlas_name: str, manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("assets", [])
    if not isinstance(entries, list):
        raise ValueError("资源清单格式错误")

    padding = 2
    atlas_width = 1024
    loaded: list[tuple[str, Image.Image]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        relative = str(entry.get("assetPath", ""))
        frame_name = str(entry.get("frameName", ""))
        if not relative or not frame_name:
            continue
        source = safe_source(assets_dir, relative)
        if not source.is_file():
            raise FileNotFoundError(f"找不到工程资源：{relative}")
        with Image.open(source) as image:
            loaded.append((frame_name, image.convert("RGBA")))

    x = padding
    y = padding
    row_height = 0
    placements: list[tuple[str, Image.Image, int, int]] = []
    for frame_name, image in loaded:
        if image.width + padding * 2 > atlas_width:
            raise ValueError(f"资源过宽，无法放入 1024 宽图集：{frame_name}")
        if x + image.width + padding > atlas_width:
            x = padding
            y += row_height + padding
            row_height = 0
        placements.append((frame_name, image, x, y))
        x += image.width + padding
        row_height = max(row_height, image.height)

    atlas_height = max(1, y + row_height + padding) if loaded else 1
    output_dir.mkdir(parents=True, exist_ok=True)
    image_name = f"{atlas_name}.png"
    json_name = f"{atlas_name}.json"
    sheet = Image.new("RGBA", (atlas_width, atlas_height), (0, 0, 0, 0))
    frames: dict[str, dict[str, Any]] = {}
    for frame_name, image, px, py in placements:
        sheet.alpha_composite(image, (px, py))
        frames[frame_name] = {
            "frame": {"x": px, "y": py, "w": image.width, "h": image.height},
            "offset": {"x": 0, "y": 0, "w": image.width, "h": image.height},
            "sourceSize": {"w": image.width, "h": image.height},
        }
    sheet.save(output_dir / image_name, format="PNG")
    atlas = {
        "frames": frames,
        "meta": {
            "image": image_name,
            "format": "RGBA8888",
            "size": {"w": atlas_width, "h": atlas_height},
            "scale": "1",
            "type": "frame",
        },
    }
    (output_dir / json_name).write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"image": image_name, "json": json_name, "frames": frames}


def main() -> int:
    parser = argparse.ArgumentParser(description="生成自研引擎 UIEditor 可识别的 imageset")
    parser.add_argument("--assets-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--atlas-name", required=True)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    result = pack_assets(args.assets_dir, args.output_dir, args.atlas_name, args.manifest)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
