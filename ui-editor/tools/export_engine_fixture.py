#!/usr/bin/env python3
"""Create a native-engine UIEditor fixture from one UI2HTML .ui.json project.

The fixture is deliberately self-contained: standalone project assets are packed
into one TexturePacker-compatible imageset.  It does not write to the engine
repository; the output directory can be copied into an engine resource path for
manual UIEditor verification.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

from PIL import Image


ENGINE_FONT_SIZES = (8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 48, 64, 72, 120, 160)


def engine_font_name(value: Any) -> str:
    size = num(value, 16)
    target = next((candidate for candidate in ENGINE_FONT_SIZES if candidate >= size), ENGINE_FONT_SIZES[-1])
    return f"HT{target}"


def num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def fmt(value: float) -> str:
    value = 0 if abs(value) < 0.00005 else value
    rounded = round(value, 4)
    return str(int(rounded)) if float(rounded).is_integer() else str(rounded)


def area(rect: dict[str, Any], parent: dict[str, float], anchor: dict[str, Any]) -> str:
    """Convert the editor's visual rect to engine Area min/max coordinates."""
    width = max(1.0, num(rect.get("width"), 1))
    height = max(1.0, num(rect.get("height"), 1))
    px = num(anchor.get("parentX"), 0)
    py = num(anchor.get("parentY"), 0)
    base_x = num(rect.get("x")) - px * (parent["width"] - width)
    base_y = num(rect.get("y")) - py * (parent["height"] - height)
    return "{{0,%s},{0,%s},{0,%s},{0,%s}}" % (
        fmt(base_x), fmt(base_y), fmt(base_x + width), fmt(base_y + height)
    )


def align_x(value: Any) -> str:
    value = num(value)
    return "Right" if value >= 0.75 else "Centre" if value >= 0.25 else "Left"


def align_y(value: Any) -> str:
    value = num(value)
    return "Bottom" if value >= 0.75 else "Centre" if value >= 0.25 else "Top"


def color(value: Any) -> str | None:
    if not value:
        return None
    values = [num(x) for x in re.findall(r"[-+]?\d*\.?\d+", str(value))]
    if len(values) < 3:
        return None
    channels = [max(0.0, min(1.0, x / 255 if x > 1 else x)) for x in values[:3]]
    alpha = values[3] if len(values) > 3 else 1.0
    if alpha > 1:
        alpha /= 255
    return " ".join(fmt(x) for x in channels + [max(0.0, min(1.0, alpha))])


class Atlas:
    def __init__(self, source_assets: Path, output: Path, atlas_name: str):
        self.source_assets = source_assets
        self.output = output
        self.atlas_name = atlas_name
        self.entries: list[tuple[str, Image.Image]] = []
        self.frames: dict[str, dict[str, Any]] = {}
        self.used: set[str] = set()

    def add(self, asset_path: str) -> str | None:
        source = self.source_assets / asset_path
        if not source.is_file():
            return None
        stem = re.sub(r"[^0-9A-Za-z_-]+", "_", Path(asset_path).stem) or "image"
        name = stem
        suffix = 2
        while name in self.used:
            name = f"{stem}_{suffix}"
            suffix += 1
        self.used.add(name)
        self.entries.append((name, Image.open(source).convert("RGBA")))
        return name

    def write(self) -> None:
        if not self.entries:
            return
        padding = 2
        atlas_width = 512
        x = padding
        y = padding
        row_height = 0
        placements: list[tuple[str, Image.Image, int, int]] = []
        for name, image in self.entries:
            if x + image.width + padding > atlas_width:
                x = padding
                y += row_height + padding
                row_height = 0
            placements.append((name, image, x, y))
            x += image.width + padding
            row_height = max(row_height, image.height)
        atlas_height = max(1, y + row_height + padding)
        canvas = Image.new("RGBA", (atlas_width, atlas_height), (0, 0, 0, 0))
        for name, image, px, py in placements:
            canvas.alpha_composite(image, (px, py))
            self.frames[name] = {
                "frame": {"x": px, "y": py, "w": image.width, "h": image.height},
                "offset": {"x": 0, "y": 0, "w": image.width, "h": image.height},
                "sourceSize": {"w": image.width, "h": image.height},
            }
        self.output.mkdir(parents=True, exist_ok=True)
        image_name = f"{self.atlas_name}.png"
        canvas.save(self.output / image_name)
        (self.output / f"{self.atlas_name}.json").write_text(json.dumps({
            "frames": self.frames,
            "meta": {"image": image_name, "format": "RGBA8888", "size": {"w": atlas_width, "h": atlas_height}, "scale": "1", "type": "frame"},
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class Exporter:
    def __init__(self, project_path: Path, output: Path):
        self.project_path = project_path
        self.output = output
        self.data = json.loads(project_path.read_text(encoding="utf-8-sig"))
        self.package_name = re.sub(r"[^0-9A-Za-z_-]+", "_", project_path.name.replace(".ui.json", "")) or "ui-project"
        self.assets = project_path.with_name(project_path.stem.replace(".ui", "") + ".assets")
        if not self.assets.is_dir():
            self.assets = project_path.with_suffix(".assets")
        self.atlas = Atlas(self.assets, output / "res" / "imageset", self.package_name)
        self.asset_refs: dict[str, str] = {}

    def image_ref(self, asset_path: str | None) -> str | None:
        if not asset_path:
            return None
        if asset_path not in self.asset_refs:
            frame = self.atlas.add(asset_path)
            self.asset_refs[asset_path] = frame or ""
        frame = self.asset_refs[asset_path]
        return f"set:{self.package_name}.json image:{frame}" if frame else None

    def props(self, node: dict[str, Any], ctrl_type: str) -> list[dict[str, str]]:
        props = node.get("text") or {}
        result = [{"Name": "Area", "Value": ""}]
        anchor = node.get("anchor") or {}
        result.append({"Name": "HorizontalAlignment", "Value": align_x(anchor.get("parentX"))})
        result.append({"Name": "VerticalAlignment", "Value": align_y(anchor.get("parentY"))})
        if node.get("visible") is False:
            result.append({"Name": "Visible", "Value": "false"})
        if num(node.get("opacity"), 1) < 0.999:
            result.append({"Name": "Alpha", "Value": fmt(num(node.get("opacity"), 1))})
        if props and ctrl_type != "StaticImage":
            result.append({"Name": "Text", "Value": str(props.get("content", ""))})
            result.append({"Name": "Font", "Value": engine_font_name(props.get("fontSize", 16))})
            result.append({"Name": "TextHorzAlignment", "Value": "Centre"})
            result.append({"Name": "TextVertAlignment", "Value": "Centre"})
            text_color = color(props.get("color"))
            if text_color:
                result.append({"Name": "TextColor", "Value": text_color})
        if ctrl_type in ("ProgressBar", "Slider"):
            progress = node.get("progress") or {}
            result.append({"Name": "Progress", "Value": fmt(num(progress.get("value"), 0))})
            if progress.get("direction") == "vertical":
                result.append({"Name": "ProgressIsVertical", "Value": "true"})
        if num(node.get("rotation"), 0):
            result.append({"Name": "Rotate", "Value": fmt(num(node["rotation"]))})
        for slot, binding in (node.get("resources") or {}).items():
            source = (binding or {}).get("sourceNode") or {}
            reference = self.image_ref(source.get("assetPath"))
            if reference:
                result.append({"Name": slot, "Value": reference})
        if ctrl_type == "StaticImage" and not any(item["Name"] == "ImageName" for item in result):
            reference = self.image_ref(node.get("assetPath"))
            if reference:
                result.append({"Name": "ImageName", "Value": reference})
        return result

    def convert(self, node: dict[str, Any], parent: dict[str, float], index: int) -> dict[str, Any]:
        ctrl_type = ((node.get("ctrl") or {}).get("type") or "Layout")
        if ctrl_type == "empty":
            ctrl_type = "Layout"
        rect = node.get("designRect") or {"x": 0, "y": 0, "width": 1, "height": 1}
        props = self.props(node, ctrl_type)
        props[0]["Value"] = area(rect, parent, node.get("anchor") or {})
        children = [self.convert(child, {"width": max(1, num(rect.get("width"), 1)), "height": max(1, num(rect.get("height"), 1))}, child_index)
                    for child_index, child in enumerate(node.get("children") or [])]
        return {"Type": ctrl_type, "Name": str(node.get("name") or f"node_{index}"), "Property": props, **({"Window": children} if children else {})}

    def run(self) -> Path:
        root_rect = {"width": num(self.data.get("designWidth"), 1280), "height": num(self.data.get("designHeight"), 720)}
        nodes = [self.convert(node, root_rect, index) for index, node in enumerate(self.data.get("nodes") or [])]
        engine = {"Dialog": {"Window": nodes[0] if len(nodes) == 1 else {"Type": "Layout", "Name": "root", "Property": [{"Name": "Area", "Value": "{{0,0},{0,0},{0,%s},{0,%s}}" % (fmt(root_rect["width"]), fmt(root_rect["height"]))}], "Window": nodes}}}
        self.output.mkdir(parents=True, exist_ok=True)
        json_path = self.output / "res" / "layout" / f"{self.package_name}.json"
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(engine, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.atlas.write()
        (self.output / "README.txt").write_text(
            "引擎 UIEditor 验证包\n\n"
            f"res/layout/{self.package_name}.json 是给引擎 UIEditor 打开的引擎 JSON。\n"
            f"res/imageset/{self.package_name}.json 与 {self.package_name}.png 是该 JSON 使用的图集资源。\n"
            "请将本包内的 res/layout 和 res/imageset 内容复制到目标引擎已登记的对应资源目录，重启引擎 UIEditor 后再打开 JSON；不要覆盖同名文件。\n",
            encoding="utf-8",
        )
        return json_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    exporter = Exporter(args.project, args.output)
    path = exporter.run()
    print(path)
    print(args.output / "res" / "imageset" / f"{exporter.package_name}.json")
    print(args.output / "res" / "imageset" / f"{exporter.package_name}.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
