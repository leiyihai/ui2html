#!/usr/bin/env python3
"""Import selected BlockMango engine layout JSON files into standalone UI Editor projects.

This is intentionally a comparison-oriented importer.  It preserves the engine's
raw properties in a sidecar report while producing a normal schemaVersion=3
`.ui.json` plus a sibling `.assets` directory containing cropped atlas images.

The engine's Area is a URect: {min-x, min-y, max-x, max-y}.  The third and
fourth values are not width and height.  Alignment is applied after resolving
the Area position and size, matching GUICoordConverter.cpp.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from PIL import Image


DESIGN_WIDTH = 1280
DESIGN_HEIGHT = 720
SCHEMA_VERSION = 3
TYPE_MAP = {
    "Layout": "Layout",
    "Button": "Button",
    "CheckBox": "CheckBox",
    "Edit": "Edit",
    "GridView": "GridView",
    "List": "List",
    "ListHorizontal": "ListHorizontal",
    "ProgressBar": "ProgressBar",
    "RadioButton": "RadioButton",
    "Slider": "Slider",
    "StaticImage": "StaticImage",
    "StaticText": "StaticText",
    "UrlImage": "StaticImage",
}
RESOURCE_SLOTS = (
    "LayoutBackImage",
    "ImageName",
    "NormalImage",
    "PushedImage",
    "ProgressBackImage",
    "ProgressImage",
    "ProgressHeaderImage",
    "EditBackImage",
    "ListItemSelectImage",
)
AREA_PAIR_RE = re.compile(r"\{\s*([^{}]+?)\s*\}")
RESOURCE_RE = re.compile(r"set\s*:\s*([^\s]+?)\s+image\s*:\s*(.+?)\s*$", re.I)


def number(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def clean_number(value: float) -> int | float:
    if abs(value - round(value)) < 1e-6:
        return int(round(value))
    return round(value, 6)


def safe_name(value: str) -> str:
    value = re.sub(r"[^0-9A-Za-z_.-]+", "_", value).strip("._")
    return value or "asset"


def properties(window: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in window.get("Property", []) or []:
        if isinstance(item, dict) and item.get("Name") is not None:
            result[str(item["Name"])] = str(item.get("Value", ""))
    return result


def parse_area(value: str | None) -> tuple[tuple[float, float], tuple[float, float]] | None:
    if not value:
        return None
    pairs: list[tuple[float, float]] = []
    for pair in AREA_PAIR_RE.findall(value):
        parts = [p.strip() for p in pair.split(",")]
        if len(parts) != 2:
            continue
        pairs.append((number(parts[0]), number(parts[1])))
    if len(pairs) != 4:
        return None
    return (pairs[0], pairs[1]), (pairs[2], pairs[3])


def parse_resource(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    match = RESOURCE_RE.match(value.strip())
    if not match:
        return None
    return match.group(1).removesuffix(".json"), match.group(2).strip()


def alignment_factor(value: str | None, axis: str) -> float:
    value = (value or "").lower()
    if axis == "x":
        return 1.0 if value == "right" else 0.5 if value in ("centre", "center") else 0.0
    return 1.0 if value == "bottom" else 0.5 if value in ("centre", "center") else 0.0


def rgba_to_css(value: str | None) -> str:
    if not value:
        return "#ffffff"
    values = [number(part) for part in value.replace(",", " ").split()]
    if len(values) < 3:
        return "#ffffff"
    channels = [max(0, min(255, round(v * 255 if v <= 1 else v))) for v in values[:3]]
    if len(values) >= 4:
        alpha = max(0, min(1, values[3] if values[3] <= 1 else values[3] / 255))
        return f"rgba({channels[0]}, {channels[1]}, {channels[2]}, {alpha:.3f})"
    return f"rgb({channels[0]}, {channels[1]}, {channels[2]})"


@dataclass
class Rect:
    x: float
    y: float
    width: float
    height: float


class AtlasCatalog:
    def __init__(self, game_root: Path, output_assets: Path, warnings: list[str]):
        self.game_root = game_root
        self.search_roots = [game_root]
        for parent in game_root.parents:
            if parent.name.lower() == "media":
                self.search_roots.append(parent)
                break
        self.output_assets = output_assets
        self.warnings = warnings
        self.json_cache: dict[str, dict[str, Any] | None] = {}
        self.image_cache: dict[str, Image.Image | None] = {}
        self.asset_cache: dict[tuple[str, str], str | None] = {}
        self.asset_sizes: dict[str, tuple[int, int]] = {}

    def _imageset_json(self, set_name: str) -> Path | None:
        if set_name in self.json_cache:
            return Path("__missing__") if self.json_cache[set_name] is None else self._json_path(set_name)
        candidates: list[Path] = []
        for root in self.search_roots:
            candidates.extend([
                root / "res" / "imageset" / f"{set_name}.json",
                root / "res" / "imageset" / set_name,
                root / "GUI" / "imageset" / f"{set_name}.json",
                root / "GUI" / "imageset" / set_name,
            ])
            candidates.extend(root.rglob(f"{set_name}.json"))
        for candidate in candidates:
            if candidate.is_file():
                try:
                    self.json_cache[set_name] = json.loads(candidate.read_text(encoding="utf-8-sig"))
                    self._json_paths[set_name] = candidate
                    return candidate
                except (OSError, json.JSONDecodeError) as exc:
                    self.warnings.append(f"图集索引读取失败 {candidate}: {exc}")
                    break
        self.json_cache[set_name] = None
        return None

    _json_paths: dict[str, Path] = {}

    def _json_path(self, set_name: str) -> Path:
        return self._json_paths[set_name]

    def _atlas_image(self, set_name: str, index_path: Path) -> Image.Image | None:
        if set_name in self.image_cache:
            return self.image_cache[set_name]
        meta = self.json_cache.get(set_name) or {}
        image_name = ((meta.get("meta") or {}).get("image") if isinstance(meta, dict) else None) or f"{set_name}.png"
        candidates = [index_path.parent / image_name, index_path.parent / f"{set_name}.png"]
        candidates.extend(index_path.parent.rglob(image_name))
        image_path = next((p for p in candidates if p.is_file()), None)
        if not image_path:
            self.warnings.append(f"找不到图集图片：{set_name} ({image_name})")
            self.image_cache[set_name] = None
            return None
        try:
            image = Image.open(image_path).convert("RGBA")
            self.image_cache[set_name] = image
            return image
        except OSError as exc:
            self.warnings.append(f"图集图片读取失败 {image_path}: {exc}")
            self.image_cache[set_name] = None
            return None

    def extract(self, reference: str, prefix: str) -> tuple[str, tuple[int, int]] | None:
        parsed = parse_resource(reference)
        if not parsed:
            return None
        set_name, image_name = parsed
        key = (set_name, image_name)
        if key in self.asset_cache:
            path = self.asset_cache[key]
            return (path, self.asset_sizes[path]) if path else None
        index_path = self._imageset_json(set_name)
        meta = self.json_cache.get(set_name)
        frames = meta.get("frames", {}) if isinstance(meta, dict) else {}
        frame_info = frames.get(image_name) if isinstance(frames, dict) else None
        frame = frame_info.get("frame") if isinstance(frame_info, dict) else None
        if not index_path or not frame:
            self.warnings.append(f"图集资源未找到：{reference}")
            self.asset_cache[key] = None
            return None
        atlas = self._atlas_image(set_name, index_path)
        if atlas is None:
            self.asset_cache[key] = None
            return None
        x, y = int(number(frame.get("x"))), int(number(frame.get("y")))
        width, height = int(number(frame.get("w"))), int(number(frame.get("h")))
        if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > atlas.width or y + height > atlas.height:
            self.warnings.append(f"图集裁切范围非法：{reference} frame={frame}")
            self.asset_cache[key] = None
            return None
        output_name = f"{safe_name(set_name)}__{safe_name(image_name)}.png"
        output_path = self.output_assets / output_name
        if not output_path.exists():
            atlas.crop((x, y, x + width, y + height)).save(output_path)
        self.asset_cache[key] = output_name
        self.asset_sizes[output_name] = (width, height)
        return output_name, (width, height)


class Importer:
    def __init__(self, source: Path, output_root: Path, design_width: int, design_height: int):
        self.source = source
        self.output_root = output_root
        self.design_width = design_width
        self.design_height = design_height
        self.project_dir = output_root / source.stem
        self.assets_dir = self.project_dir / f"{source.stem}.assets"
        self.warnings: list[str] = []
        self.catalog = AtlasCatalog(source.parent.parent, self.assets_dir, self.warnings)
        self.node_counter = 0
        self.asset_counter = 0
        self.raw_nodes: list[dict[str, Any]] = []

    def new_id(self, prefix: str) -> str:
        self.node_counter += 1
        return f"{safe_name(prefix).lower()}-{self.node_counter:04d}"

    def source_node(self, asset_path: str, asset_name: str, width: int, height: int) -> dict[str, Any]:
        node_id = self.new_id(asset_name)
        return {
            "id": node_id,
            "name": asset_name,
            "assetPath": asset_path,
            "assetName": asset_name,
            "ctrl": {"type": "StaticImage"},
            "designRect": {"x": 0, "y": 0, "width": width, "height": height},
            "anchor": {"parentX": 0, "parentY": 0, "selfX": 0, "selfY": 0, "offsetX": 0, "offsetY": 0, "safeArea": False},
            "scale": {"x": 1, "y": 1},
            "rotation": 0,
            "opacity": 1,
            "visible": True,
            "zIndex": 0,
            "adaptation": {"mode": "anchor"},
        }

    def resolve_rect(self, props: dict[str, str], parent: Rect, natural: tuple[int, int] | None = None) -> tuple[Rect, float, float, float, float]:
        parsed = parse_area(props.get("Area"))
        if parsed is None:
            width, height = natural or (100, 30)
            return Rect(0, 0, float(width), float(height)), 0, 0, 0, 0
        (min_x, min_y), (max_x, max_y) = parsed
        base_x = min_x[0] * parent.width + min_x[1]
        base_y = min_y[0] * parent.height + min_y[1]
        width = (max_x[0] - min_x[0]) * parent.width + max_x[1] - min_x[1]
        height = (max_y[0] - min_y[0]) * parent.height + max_y[1] - min_y[1]
        if width <= 0:
            width = float((natural or (100, 30))[0])
            self.warnings.append(f"{props.get('Area')} 解析出非正宽度，已使用估算宽度 {width}")
        if height <= 0:
            height = float((natural or (100, 30))[1])
            self.warnings.append(f"{props.get('Area')} 解析出非正高度，已使用估算高度 {height}")
        px = alignment_factor(props.get("HorizontalAlignment"), "x")
        py = alignment_factor(props.get("VerticalAlignment"), "y")
        x = base_x + px * (parent.width - width)
        y = base_y + py * (parent.height - height)
        return Rect(x, y, width, height), base_x, base_y, px, py

    def make_resource(self, node_id: str, slot: str, reference: str) -> tuple[dict[str, Any], tuple[int, int]] | None:
        extracted = self.catalog.extract(reference, self.source.stem)
        if not extracted:
            return None
        asset_path, size = extracted
        asset_name = f"img_{safe_name(parse_resource(reference)[1])}"
        source = self.source_node(asset_path, asset_name, size[0], size[1])
        binding = {
            "id": source["id"],
            "name": asset_name,
            "sourceParentId": node_id,
            "sourceIndex": self.asset_counter,
            "sourceNode": source,
        }
        self.asset_counter += 1
        return binding, size

    def convert_window(self, window: dict[str, Any], parent: Rect, parent_id: str | None, index: int) -> dict[str, Any]:
        original_type = str(window.get("Type", "Layout"))
        props = properties(window)
        ctrl_type = TYPE_MAP.get(original_type, "Layout")
        if original_type not in TYPE_MAP:
            self.warnings.append(f"{window.get('Name', 'unnamed')}：暂不支持引擎类型 {original_type}，按 Layout 导入")
        refs: dict[str, str] = {
            slot: props[slot] for slot in RESOURCE_SLOTS if props.get(slot) and props[slot].strip()
        }
        natural: tuple[int, int] | None = None
        for reference in refs.values():
            parsed = parse_resource(reference)
            if parsed:
                found = self.catalog.extract(reference, self.source.stem)
                if found:
                    natural = found[1]
                    break
        rect, base_x, base_y, px, py = self.resolve_rect(props, parent, natural)
        node_id = self.new_id(str(window.get("Name", original_type)))
        name = str(window.get("Name") or f"{ctrl_type}_{index}")
        node: dict[str, Any] = {
            "id": node_id,
            "name": name,
            "designRect": {"x": clean_number(rect.x), "y": clean_number(rect.y), "width": clean_number(rect.width), "height": clean_number(rect.height)},
            "anchor": {
                "parentX": px,
                "parentY": py,
                "selfX": 0,
                "selfY": 0,
                "offsetX": clean_number(base_x - px * rect.width),
                "offsetY": clean_number(base_y - py * rect.height),
                "safeArea": False,
            },
            "scale": {"x": 1, "y": 1},
            "rotation": number(props.get("Rotate", 0)),
            "opacity": max(0, min(1, number(props.get("Alpha", 1), 1))),
            "visible": props.get("Visible", "true").lower() != "false",
            "zIndex": index,
            "adaptation": {"mode": "anchor"},
            "ctrl": {"type": ctrl_type},
        }
        if props.get("Text") is not None and ctrl_type not in ("StaticImage",):
            font_size = max(8, min(96, round(rect.height * 0.72)))
            node["text"] = {
                "content": props.get("Text", ""),
                "fontSize": font_size,
                "color": rgba_to_css(props.get("TextColor")),
                "font": props.get("Font") or undefined_font(),
                "mode": "fixed",
                "minFontSize": max(8, font_size // 2),
            }
        if ctrl_type in ("ProgressBar", "Slider"):
            node["progress"] = {
                "value": max(0, min(1, number(props.get("Progress"), 0))),
                "direction": "vertical" if props.get("ProgressIsVertical", "false").lower() == "true" else "horizontal",
                "reverse": False,
            }
        if ctrl_type in ("List", "ListHorizontal", "GridView"):
            node["list"] = {
                "type": "horizontal" if ctrl_type == "ListHorizontal" else "grid" if ctrl_type == "GridView" else "vertical",
                "spacing": 0,
                "padding": {"left": 0, "right": 0, "top": 0, "bottom": 0},
                "columns": 3,
            }
        resources: dict[str, Any] = {}
        all_found = True
        for slot, reference in refs.items():
            binding = self.make_resource(node_id, slot, reference)
            if not binding:
                all_found = False
                continue
            resources[slot] = binding[0]
        if resources:
            node["resources"] = resources
            if all_found:
                node["resourceBindingComplete"] = True
        children = [self.convert_window(child, rect, node_id, child_index) for child_index, child in enumerate(window.get("Window", []) or [])]
        if children:
            node["children"] = children
        self.raw_nodes.append({
            "id": node_id,
            "name": name,
            "type": original_type,
            "properties": props,
            "computedRect": node["designRect"],
            "parentId": parent_id,
        })
        return node

    def run(self) -> dict[str, Any]:
        self.project_dir.mkdir(parents=True, exist_ok=True)
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        try:
            source_data = json.loads(self.source.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"读取引擎 JSON 失败 {self.source}: {exc}") from exc
        root = ((source_data.get("Dialog") or {}).get("Window") or {})
        if not isinstance(root, dict):
            raise RuntimeError("引擎 JSON 缺少 Dialog.Window 根节点")
        canvas = Rect(0, 0, float(self.design_width), float(self.design_height))
        root_node = self.convert_window(root, canvas, None, 0)
        project = {
            "schemaVersion": SCHEMA_VERSION,
            "designWidth": self.design_width,
            "designHeight": self.design_height,
            "nodes": [root_node],
            "templates": [],
            "view": {
                "viewport": {"width": self.design_width, "height": self.design_height},
                "safeArea": {"left": 0, "right": 0, "top": 0, "bottom": 0},
                "scaleMode": "cover",
                "showSafeArea": False,
                "showDesignBorder": True,
            },
        }
        ui_path = self.project_dir / f"{self.source.stem}.ui.json"
        report_path = self.project_dir / f"{self.source.stem}.reverse-report.json"
        ui_path.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report = {
            "version": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": str(self.source),
            "outputProject": str(ui_path),
            "assetDirectory": str(self.assets_dir),
            "areaRule": "Area = URect(minX, minY, maxX, maxY); size = max - min; alignment is applied after resolving min position.",
            "nodeCount": len(self.raw_nodes),
            "assetCount": len(self.catalog.asset_cache) - sum(1 for v in self.catalog.asset_cache.values() if v is None),
            "warnings": self.warnings,
            "nodes": self.raw_nodes,
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {"source": str(self.source), "project": str(ui_path), "assets": str(self.assets_dir), "report": str(report_path), "nodes": len(self.raw_nodes), "assetsCount": report["assetCount"], "warnings": len(self.warnings)}


def undefined_font() -> str:
    return "DEFAULT_HT16"


def main() -> int:
    parser = argparse.ArgumentParser(description="Reverse import engine layout JSON into UI Editor .ui.json projects")
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--width", type=int, default=DESIGN_WIDTH)
    parser.add_argument("--height", type=int, default=DESIGN_HEIGHT)
    parser.add_argument("sources", nargs="+", type=Path)
    args = parser.parse_args()
    summaries = []
    for source in args.sources:
        if not source.is_file():
            print(f"SKIP missing: {source}", file=sys.stderr)
            continue
        try:
            summaries.append(Importer(source, args.output_root, args.width, args.height).run())
        except Exception as exc:
            print(f"FAILED {source}: {exc}", file=sys.stderr)
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "design": {"width": args.width, "height": args.height},
        "projects": summaries,
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    (args.output_root / "README.txt").write_text(
        "反向导入测试结果\n\n"
        "这些工程由真实项目引擎 JSON 反向生成，供 UI Editor 打开后与原始引擎编辑器逐项对照。\n"
        "每个子目录包含：.ui.json、同名 .assets 资源目录、reverse-report.json 原始属性与转换警告。\n"
        "重要规则：引擎 Area 是 URect 的左上角与右下角坐标，宽高由 max-min 得到。\n",
        encoding="utf-8",
    )
    (args.output_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in summaries:
        print(json.dumps(item, ensure_ascii=False))
    return 0 if summaries else 1


if __name__ == "__main__":
    raise SystemExit(main())
