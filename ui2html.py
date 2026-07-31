#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PSD → HTML 转换脚本（锚点贴边自适应布局）

布局（自适应，无黑边）：
  - 页面铺满视口；scale = min(视口宽/设计宽, 视口高/设计高)
  - 所有 UI 元素按锚点贴视口边缘/中心，尺寸与锚点距离均 ×scale 等比缩放：
    * ui.psd 背景图层：按图层名锚点（右上/右下/底部居中/左下/左上）贴对应边缘
    * "按钮*"图层：锚定右侧中间（right / 相对垂直中心偏移）
    * "宝箱"/"宝箱列表"：锚定底部中间（left/bottom 百分比）
    任意宽高比（含 18:9）下角落 UI 始终贴屏幕角，不会出现居中留空

交互：
  - 左上角开关：打开可调整按钮位置并保存（localStorage），关闭时拖动松手回弹
  - 按住按钮/宝箱高亮；按住按钮显示 images/取消.png
  - 点击宝箱：宝箱列表在遮罩容器内左->右滑入 / 右->左滑出（默认显示 2s 后自动隐藏）

用法：
  python ui2html.py 测试.psd
  python ui2html.py 测试.psd --scale 3 --bg white --out dist --inline
"""
import argparse
import base64
import html as html_mod
import json
import re
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

DEFAULT_BG = "#b2cefb"

DRAG_PREFIX = "按钮"        # 名字以此开头的图层：左下角锚定 + 可拖动
CHEST_NAME = "宝箱"         # 点击此图层触发列表动画
LIST_NAME = "宝箱列表"      # 被动画的图层
CANCEL_POS = (210, 234)     # 取消.png 显示位置（视口坐标，固定不缩放）
UI_PSD = "ui.psd"           # 背景设计稿（存在才读取）
CANCEL_IMG = "取消.png"     # 按住按钮时显示的反馈图（存在才加入）

# 按钮在设计分辨率（1280x720）下相对右下角的坐标 (right, bottom)
BUTTON_ANCHOR = {
    "按钮1": (303, 478),
    "按钮2": (158, 385),
}

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str) -> str:
    """把图层名转成安全文件名（保留中文），空名回退为 layer。"""
    s = _ILLEGAL.sub("_", name).strip().rstrip(".")
    return s or "layer"


def collect_layers(container):
    """深度优先收集可见像素图层，保持 PSD 叠放顺序（index 0 = 最底层，越靠后越靠上）。"""
    out = []
    for layer in container:
        if layer.kind == "group":
            out.extend(collect_layers(layer))
        elif layer.kind == "pixel" and layer.visible:
            out.append(layer)
    return out


def crop_export(layer, scale, img_dir, name=None):
    """裁掉透明像素 -> 按 scale 放大导出 PNG。返回 dict 或 None（全透明）。"""
    img = layer.topil()  # RGBA，大小为 layer.bbox
    bbox = img.getchannel("A").getbbox()  # 有效像素区域（图层本地坐标）
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    cropped = img.crop(bbox)
    if scale != 1:
        cropped = cropped.resize((w * scale, h * scale), Image.LANCZOS)
    filename = sanitize_filename(name if name is not None else layer.name) + ".png"
    cropped.save(img_dir / filename)
    return {
        "file": filename,
        "name": layer.name,
        "left": layer.bbox[0] + x0,   # 文档坐标（有效像素左上角）
        "top": layer.bbox[1] + y0,
        "width": w,
        "height": h,
        "doc_bbox": tuple(layer.bbox),
    }


def anchor_spec(name, W, H, doc_bbox):
    """按图层名关键词返回锚点规格 (x, y, dx, dy)：
    x = 'left'|'right'|'centerx'，y = 'top'|'bottom'；dx/dy 为设计稿中到锚点边的距离。"""
    x0, y0, x1, y1 = doc_bbox
    if "上" in name:
        y, dy = "top", y0
    else:
        y, dy = "bottom", H - y1
    if "居中" in name:
        x, dx = "centerx", 0
    elif "左" in name:
        x, dx = "left", x0
    else:
        x, dx = "right", W - x1
    return x, y, dx, dy


def export_background(psd, img_dir, scale):
    """读取 ui.psd：每个图层切图，按图层名锚点生成布局规格。"""
    slices = []
    for i, layer in enumerate(collect_layers(psd)):
        s = crop_export(layer, scale, img_dir)
        if s is None:
            continue
        x, y, dx, dy = anchor_spec(layer.name, psd.width, psd.height, layer.bbox)
        s["spec"] = {"k": "corner" if x != "centerx" else "centerx",
                     "x": x, "y": y, "dx": dx, "dy": dy,
                     "w": s["width"], "h": s["height"]}
        slices.append(s)
    return slices


def interaction_spec(s, W, H):
    """
    交互图层锚定规格：
    - 按钮*：k='button'（右中：right / topOffset 逻辑值，应用时 ×scale）
    - 宝箱/宝箱列表：k='bottomrel'（left/bottom 百分比，随视口比例）
    返回 (spec | None)
    """
    name = s["name"]
    if name.startswith(DRAG_PREFIX):
        # 右下角锚点：设计分辨率坐标 (right, bottom)，未配置则回退到 PSD 原位置
        if name in BUTTON_ANCHOR:
            right, bottom = BUTTON_ANCHOR[name]
        else:
            right = W - (s["left"] + s["width"])
            bottom = H - (s["top"] + s["height"])
        return {"k": "button", "right": round(right, 1), "bottom": round(bottom, 1)}
    if name in (CHEST_NAME, LIST_NAME):
        # 锚定"底部中间"：相对视口底边中心的逻辑偏移（×scale 等比），任意宽高比不变
        off_x = s["left"] - W / 2 - 50   # 整体左移 50px
        bottom = H - (s["top"] + s["height"])
        return {"k": "bottomcenter", "offX": round(off_x, 1), "bottom": round(bottom, 1)}
    return {"k": "abs", "left": s["left"], "top": s["top"]}


def load_data_uris(img_dir, filenames):
    """把图片文件读成 data URI（--inline 用），返回 {文件名: data:image/png;base64,...}。"""
    out = {}
    for f in filenames:
        p = img_dir / f
        if p.exists():
            out[f] = "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode("ascii")
    return out


# 页面交互 JS 模板（__XXX__ 占位符在 build_html 中替换）
JS_TEMPLATE = r"""
(function () {
  var stage = document.getElementById("stage");
  var W = __W__, H = __H__;
  var vv = window.visualViewport || window;
  var scale = 1;
  var ELEMS = __ELEMS__;   // [{id, k, ...}]

  function fit() {
    // 等比缩放：所有元素尺寸与锚点距离 ×scale，锚点贴视口边缘/中心（无黑边）
    scale = Math.min(vv.width / W, vv.height / H);
    ELEMS.forEach(function (e) {
      var el = document.getElementById(e.id);
      if (!el) return;
      if (e.k === "fixed") return;              // 固定像素，不缩放
      el.style.width = (e.w * scale) + "px";
      el.style.height = (e.h * scale) + "px";
      if (e.k === "corner") {
        if (e.x === "left") el.style.left = (e.dx * scale) + "px";
        else el.style.right = (e.dx * scale) + "px";
        if (e.y === "top") el.style.top = (e.dy * scale) + "px";
        else el.style.bottom = (e.dy * scale) + "px";
      } else if (e.k === "centerx") {
        el.style.left = "50%";
        el.style.transform = "translateX(-50%)";
        el.style.bottom = (e.dy * scale) + "px";
      } else if (e.k === "bottomcenter") {
        // 锚定视口底部中心，偏移为设计稿逻辑值 ×scale（相对底部中间位置始终不变）
        el.style.left = "calc(50% + " + (e.offX * scale) + "px)";
        el.style.bottom = (e.bottom * scale) + "px";
      } else if (e.k === "button") {
        var c = curState[e.name];
        if (c) {
          el.style.right = (c.right * scale) + "px";
          el.style.bottom = (c.bottom * scale) + "px";
        }
      }
    });
  }
  vv.addEventListener && vv.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);

  // ---- 按钮位置保存（localStorage，关闭开关时保存/页面加载时恢复）----
  var SAVE_KEY = "ui2html.positions.v5";
  var dragLayers = __DRAG_LAYERS__;   // [{id, name, right, bottom}, ...]（逻辑值）
  var curState = {};                  // name -> 当前拖动状态（逻辑值，供保存/渲染）
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") || {}; } catch (e) {}
  function posOf(d) {
    var p = saved[d.name];
    return (p && typeof p.right === "number") ? p : { right: d.right, bottom: d.bottom };
  }
  function savePos() {
    dragLayers.forEach(function (d) {
      var c = curState[d.name];
      if (c) saved[d.name] = { right: c.right, bottom: c.bottom };
    });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch (e) {}
  }

  // ---- 左上角开关 ----
  var editMode = false;
  var toggle = document.getElementById("toggle");
  var tlabel = document.getElementById("toggle-label");
  toggle.addEventListener("click", function () {
    editMode = !editMode;
    toggle.classList.toggle("on", editMode);
    tlabel.textContent = editMode ? "编辑 ON" : "编辑 OFF";
    if (!editMode) savePos();          // 关闭时保存两个按钮的位置
  });

  // ---- 按住按钮时显示取消.png ----
  var cancel = document.getElementById("cancel");
  function showCancel() { if (cancel && !editMode) cancel.style.display = "block"; }
  function hideCancel() { if (cancel) cancel.style.display = "none"; }

  // ---- 按钮拖动（右下角锚定：right/bottom 为设计稿逻辑值，渲染时 ×scale）----
  dragLayers.forEach(function (d) {
    var el = document.getElementById("layer-" + d.id);
    if (!el) return;
    var p = posOf(d);
    var cur = { right: p.right, bottom: p.bottom };   // 初始位置 = 保存值（无则默认）
    curState[d.name] = cur;
    function applyB() {
      el.style.right = (cur.right * scale) + "px";
      el.style.bottom = (cur.bottom * scale) + "px";
    }
    var dragging = false, sx = 0, sy = 0, br = 0, bb = 0;
    applyB();
    el.addEventListener("pointerdown", function (e) {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      br = cur.right; bb = cur.bottom;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.style.transition = "none";
      el.classList.add("pressed");   // 按住高亮
      showCancel();
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      cur.right = br + (sx - e.clientX) / scale;   // 向左拖 right 增大
      cur.bottom = bb - (e.clientY - sy) / scale;  // 向下拖 bottom 减小
      applyB();
    });
    function stop() {
      if (!dragging) return;
      dragging = false;
      hideCancel();
      el.classList.remove("pressed");   // 松开取消高亮
      if (!editMode) {
        // 关闭状态：松手回弹到保存的位置
        var p = posOf(d);
        el.style.transition = "right .25s ease, bottom .25s ease";
        cur.right = p.right; cur.bottom = p.bottom;
        applyB();
      }
      // 打开状态：停留在新位置，待关闭开关时统一保存
    }
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  });

__CHEST_JS__
  fit();
})();
"""

CHEST_JS_TEMPLATE = r"""  // ---- 点击宝箱：遮罩裁切，宝箱列表左->右滑入 / 右->左滑出 ----
  var chestEl = document.getElementById("layer-__CHEST_ID__");
  var listEl = document.getElementById("layer-__LIST_ID__");
  var listShown = true, userToggled = false, autoTimer = null;
  if (chestEl && listEl) {
    // 打开页面默认显示，2s 后自动收缩隐藏（用户点击过则取消自动行为）
    listEl.style.transform = "translateX(0px)";
    autoTimer = setTimeout(function () {
      if (!userToggled) {
        listShown = false;
        listEl.style.transition = "transform .4s ease";   // 与点击隐藏相同的右->左位移动画
        listEl.style.transform = "translateX(-100%)";
      }
    }, 2000);
    // 按住宝箱高亮
    chestEl.addEventListener("pointerdown", function () { chestEl.classList.add("pressed"); });
    function chestUp() { chestEl.classList.remove("pressed"); }
    chestEl.addEventListener("pointerup", chestUp);
    chestEl.addEventListener("pointercancel", chestUp);
    chestEl.addEventListener("click", function () {
      userToggled = true;
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      listShown = !listShown;
      listEl.style.transition = "transform .4s ease";
      listEl.style.transform = listShown ? "translateX(0px)" : "translateX(-100%)";
    });
  }"""


def build_html(psd, slices, bg_slices, bg, out_html, title, inline=False):
    """生成 HTML：锚点贴边自适应布局 + JS 交互。"""
    W, H = psd.width, psd.height
    img_dir = out_html.parent / "images"
    by_name = {s["name"]: s for s in slices}

    all_files = [CANCEL_IMG] + [s["file"] for s in bg_slices] + [s["file"] for s in slices]
    srcs = load_data_uris(img_dir, all_files) if inline else {}

    def src_for(f):
        return srcs.get(f) or f"images/{f}"

    cancel_size = None
    if (img_dir / CANCEL_IMG).exists():
        with Image.open(img_dir / CANCEL_IMG) as im:
            cancel_size = im.size

    elems = []
    items = []

    # 1) 背景层：ui.psd 切图按锚点贴边（z-index 0，其他 UI 均高于它）
    for i, s in enumerate(bg_slices):
        eid = f"bg-{i}"
        s["spec"]["id"] = eid
        elems.append(s["spec"])
        items.append(
            f'    <img id="{eid}" src="{src_for(s["file"])}" alt="{html_mod.escape(s["name"])}" '
            f'style="position:absolute;z-index:0;">'
        )

    # 2) 交互图层切图（z-index 从 1 起，遮挡关系与 PSD 一致）；宝箱列表包一层遮罩容器
    drag_layers = []
    for i, s in enumerate(slices):
        z = i + 1
        spec = interaction_spec(s, W, H)
        eid = f"layer-{i}"
        spec["id"] = eid
        spec["name"] = s["name"]
        spec["w"] = s["width"]
        spec["h"] = s["height"]
        dragable = s["name"].startswith(DRAG_PREFIX)
        if spec["k"] == "button":
            drag_layers.append({"id": i, "name": s["name"],
                                "right": spec["right"], "bottom": spec["bottom"]})
        if s["name"] == LIST_NAME:
            # 遮罩容器承载锚点定位与缩放，内部 img 用百分比尺寸跟随
            items.append(
                f'    <div id="mask-list" style="position:absolute;overflow:hidden;z-index:{z};">'
            )
            items.append(
                f'      <img id="{eid}" src="{src_for(s["file"])}" alt="{html_mod.escape(s["name"])}" '
                f'style="position:absolute;left:0;top:0;width:100%;height:100%;'
                f'transform:translateX(0px);">'
            )
            items.append('    </div>')
            spec["id"] = "mask-list"      # 容器参与锚点定位/缩放
            elems.append(spec)
        else:
            touch = 'touch-action:none;cursor:grab;' if dragable else ''
            items.append(
                f'    <img id="{eid}" src="{src_for(s["file"])}" alt="{html_mod.escape(s["name"])}" '
                f'style="position:absolute;z-index:{z};{touch}">'
            )
            elems.append(spec)

    # 3) 取消.png（按住按钮时显示，固定像素不缩放）
    if cancel_size:
        cw, ch = cancel_size
        items.append(
            f'    <img id="cancel" src="{src_for(CANCEL_IMG)}" alt="取消" '
            f'style="position:absolute;left:{CANCEL_POS[0]}px;top:{CANCEL_POS[1]}px;'
            f'width:{cw}px;height:{ch}px;z-index:99;display:none;">'
        )

    # 4) 左上角开关按钮（固定像素）
    items.append(
        '    <div id="toggle" class="off"><span id="toggle-label">编辑 OFF</span></div>'
    )
    body = "\n".join(items)

    chest_js = ""
    if CHEST_NAME in by_name and LIST_NAME in by_name:
        chest_js = (
            CHEST_JS_TEMPLATE
            .replace("__CHEST_ID__", str(slices.index(by_name[CHEST_NAME])))
            .replace("__LIST_ID__", str(slices.index(by_name[LIST_NAME])))
        )
    js = (
        JS_TEMPLATE
        .replace("__W__", str(W))
        .replace("__H__", str(H))
        .replace("__ELEMS__", json.dumps(elems, ensure_ascii=False))
        .replace("__DRAG_LAYERS__", json.dumps(drag_layers, ensure_ascii=False))
        .replace("__CHEST_JS__", chest_js)
    )

    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>{html_mod.escape(title)}</title>
<style>
  html, body {{ margin: 0; padding: 0; width: 100%; height: 100%;
                background: {bg}; overflow: hidden; }}
  #stage {{ position: absolute; left: 0; top: 0; width: 100%; height: 100%; }}
  #stage img {{ position: absolute; transition: filter .1s ease; }}
  #stage img.pressed {{ filter: brightness(1.35); }}
  #toggle {{ position: absolute; left: 12px; top: 12px; z-index: 100;
             width: 88px; height: 36px; border-radius: 18px; background: #9aa5b1;
             color: #fff; font-size: 14px; line-height: 36px; text-align: center;
             cursor: pointer; user-select: none; -webkit-user-select: none; }}
  #toggle.on {{ background: #4a90d9; }}
</style>
</head>
<body>
<div id="stage">
{body}
</div>
<script>
{js}
</script>
</body>
</html>
"""
    out_html.write_text(page, encoding="utf-8")


def parse_bg(value: str) -> str:
    """把 '132,132,132' / '#848484' / 'white' 等转成 CSS 颜色。"""
    if re.fullmatch(r"\d{1,3}(?:,\s*\d{1,3}){2}", value):
        r, g, b = (int(x) for x in value.split(","))
        return f"rgb({r},{g},{b})"
    return value  # 原样（#hex / 颜色名）


def main():
    ap = argparse.ArgumentParser(description="PSD 转 HTML：切图 + 锚点自适应布局 + 交互")
    ap.add_argument("psd", help="输入的 PSD 文件（交互图层）")
    ap.add_argument("-o", "--out", default=None,
                    help="输出目录（默认与 PSD 同目录）")
    ap.add_argument("--scale", type=int, default=2,
                    help="切图导出放大倍数，保证移动端高 DPR 清晰（默认 2）")
    ap.add_argument("--bg", default=DEFAULT_BG,
                    help=f"页面背景色（默认 {DEFAULT_BG}）")
    ap.add_argument("--inline", action="store_true",
                    help="图片内联为 base64 生成单文件 HTML（方便手机直接打开）")
    args = ap.parse_args()

    psd_path = Path(args.psd)
    psd = PSDImage.open(psd_path)
    out_dir = Path(args.out) if args.out else psd_path.parent
    img_dir = out_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    # 背景：ui.psd（同目录，存在才读取）
    bg_slices = []
    ui_psd_path = psd_path.parent / UI_PSD
    if ui_psd_path.exists():
        ui_psd = PSDImage.open(ui_psd_path)
        bg_slices = export_background(ui_psd, img_dir, args.scale)

    layers = collect_layers(psd)
    slices = []
    for layer in layers:
        s = crop_export(layer, args.scale, img_dir)
        if s is not None:
            slices.append(s)

    out_html = out_dir / (psd_path.stem + ".html")
    build_html(psd, slices, bg_slices, parse_bg(args.bg), out_html, psd_path.stem,
               inline=args.inline)

    print(f"设计尺寸: {psd.width}x{psd.height} (scale={args.scale})")
    if bg_slices:
        print(f"背景(ui.psd)图层: {len(bg_slices)}")
        for s in bg_slices:
            sp = s["spec"]
            print(f"  {s['file']}  {sp['k']} x={sp['x']} y={sp['y']} dx={sp['dx']} dy={sp['dy']} {sp['w']}x{sp['h']}")
    print(f"可见像素图层: {len(layers)}，切图: {len(slices)}")
    for s in slices:
        sp = interaction_spec(s, psd.width, psd.height)
        print(f"  {s['file']}  {sp}")
    print(f"输出: {out_html}")


if __name__ == "__main__":
    main()
