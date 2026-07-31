#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简易游戏 UI 编辑器（阶段一）

流程：
  1. python editor.py test/test.psd
     -> 解析 PSD：切图到 test/images/，生成 test/layout.json（布局数据）和 test/editor.html（编辑器）
  2. 浏览器打开 test/editor.html：
     - 画布还原 PSD 布局，元素可拖拽、点击选中
     - 右侧面板：九宫格锚点、X/Y/W/H（相对锚点的逻辑偏移/尺寸）
     - 顶部：容器尺寸预设（设计/16:9/18:9/竖屏）实时预览自适应效果
     - "保存"：下载 layout.json
  3. python editor.py test/test.psd --preview [--inline]
     -> 读 test/layout.json 生成 test/preview.html（纯预览页，按锚点自适应渲染）

锚点九宫格：tl tc tr / cl cc cr / bl bc br；元素位置 = 锚点坐标 + 逻辑偏移 x/y（×scale）。
"""
import argparse
import base64
import json
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

from ui2html import collect_layers, crop_export, sanitize_filename  # 复用解析/切图

DEFAULT_BG = "#b2cefb"
ANCHOR_GRID = ["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"]
ANCHOR_XY = {k: (i % 3 * 0.5, i // 3 * 0.5) for i, k in enumerate(ANCHOR_GRID)}  # 0,0.5,1

# 编辑器容器尺寸预设（名称, 宽, 高）
PRESETS = [
    ("设计 1280x720", 1280, 720),
    ("16:9", 1280, 720),
    ("18:9", 1280, 640),
    ("iPad 横屏 1024x768", 1024, 768),
    ("iPad 竖屏 768x1024", 768, 1024),
    ("竖屏 9:16", 720, 1280),
    ("自定义分辨率…", 0, 0),
]

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def infer_anchor(x0, y0, x1, y1, W, H):
    """初始锚点推断：贴哪个边缘近就锚哪个（角/边/中）。返回 (anchor, offx, offy)。"""
    ax = "l" if x0 <= W - x1 else "r"
    if x0 > W * 0.3 and W - x1 > W * 0.3:
        ax = "c"
    ay = "t" if y0 <= H - y1 else "b"
    if y0 > H * 0.3 and H - y1 > H * 0.3:
        ay = "c"
    a = ANCHOR_XY[ay + ax]
    return ay + ax, round(x0 - a[0] * W, 1), round(y0 - a[1] * H, 1)


def build_layout(psd, slices):
    """slices -> layout dict（elements 带 idx 供 DOM 定位）。全屏图层自动 stretch。"""
    elems = []
    for i, s in enumerate(slices):
        if (s["left"] <= 0 and s["top"] <= 0
                and s["left"] + s["width"] >= psd.width
                and s["top"] + s["height"] >= psd.height):
            elems.append({"idx": i, "name": s["name"], "file": s["file"], "anchor": "stretch",
                          "offL": 0, "offT": 0, "offR": 0, "offB": 0,
                          "w": s["width"], "h": s["height"], "z": i})
            continue
        anchor, ox, oy = infer_anchor(s["left"], s["top"], s["left"] + s["width"],
                                      s["top"] + s["height"], psd.width, psd.height)
        elems.append({
            "idx": i, "name": s["name"], "file": s["file"],
            "anchor": anchor, "x": ox, "y": oy,
            "w": s["width"], "h": s["height"], "z": i,
        })
    return {"width": psd.width, "height": psd.height, "elements": elems}


def load_data_uris(img_dir, filenames):
    out = {}
    for f in filenames:
        p = img_dir / f
        if p.exists():
            out[f] = "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode("ascii")
    return out


# 渲染引擎（editor / preview 共用；__X__ 占位符在生成时替换）
RENDER_JS = r"""
var W = __W__, H = __H__;
var ELEMS = __ELEMS__;
var BG = "__BG__";
var ANCHOR = { tl:[0,0], tc:[.5,0], tr:[1,0], cl:[0,.5], cc:[.5,.5], cr:[1,.5], bl:[0,1], bc:[.5,1], br:[1,1] };
function rectOf(e, cw, ch, s) {
  if (e.anchor === "stretch") {   // 四边贴容器，尺寸随容器变化
    var L = (e.offL||0)*s, T = (e.offT||0)*s, R = (e.offR||0)*s, B = (e.offB||0)*s;
    return { l: L, t: T, w: cw - L - R, h: ch - T - B };
  }
  // 位置：相对锚点的偏移为绝对像素（不随容器缩放）；尺寸：统一等比 s（不变形）
  var a = ANCHOR[e.anchor] || ANCHOR.cc;
  return { l: a[0]*cw + e.x, t: a[1]*ch + e.y, w: e.w*s, h: e.h*s };
}
function render(cw, ch, s) {
  ELEMS.forEach(function (e) {
    var el = document.getElementById("el-" + e.idx);
    if (!el) return;
    var r = rectOf(e, cw, ch, s);
    el.style.left = r.l + "px"; el.style.top = r.t + "px";
    el.style.width = r.w + "px"; el.style.height = r.h + "px";
  });
}
"""

# 预览页（自适应视口 + 缩放）
PREVIEW_JS = RENDER_JS + r"""
(function () {
  var stage = document.getElementById("stage");
  var cw = 0, ch = 0, scale = 1;
  var vv = window.visualViewport || window;
  function fit() {
    // 容器 = 视口，元素按锚点渲染；再整体等比缩放以看清全貌
    scale = Math.min(vv.width / W, vv.height / H);
    cw = W * scale; ch = H * scale;
    stage.style.transform = "scale(" + scale + ")";
    stage.style.left = (vv.width - cw) / 2 + "px";
    stage.style.top = (vv.height - ch) / 2 + "px";
    stage.style.width = W + "px"; stage.style.height = H + "px";
    render(W, H, 1);   // 容器=设计尺寸，锚点偏移按设计稿；缩放交给 stage
  }
  vv.addEventListener && vv.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();
})();
"""

# 编辑器 JS（渲染 + 拖拽 + 选中 + 面板 + 保存）
EDITOR_JS = RENDER_JS + r"""
(function () {
  var stage = document.getElementById("stage");
  var panel = document.getElementById("panel");
  var cw = W, ch = H, scale = 1;
  var vv = window.visualViewport || window;
  var sel = null;
  var PRESETS = __PRESETS__;
  var DESIGN_NAME = Object.keys(PRESETS)[0];   // 第一个预设 = 设计分辨率
  var editing = true;   // 仅设计分辨率下可编辑，其他分辨率只读预览
  var rs = 1;           // 画布内元素等比缩放（min(容器/设计)）

  function fit() {
    // 画布居中显示在限定范围内：不放大超过设计尺寸 1:1，四周留白便于检查
    var pad = 48;
    var view = Math.min((vv.width - pad * 2) / cw, (vv.height - 56 - pad * 2) / ch, 1);
    rs = Math.min(cw / W, ch / H);   // 元素偏移/尺寸 ×rs -> 任何容器下都在画布内
    scale = view;                    // 画布在窗口中的显示缩放（拖拽换算用）
    stage.style.transform = "scale(" + view + ")";
    stage.style.left = (vv.width - cw * view) / 2 + "px";
    stage.style.top = (vv.height - 56 - ch * view) / 2 + 56 + "px";
    stage.style.width = cw + "px"; stage.style.height = ch + "px";
    render(cw, ch, rs);
  }
  function presetChanged(v) {
    if (v === "自定义分辨率…") {
      var w = parseInt(prompt("自定义宽度 (px)", W), 10);
      var h = parseInt(prompt("自定义高度 (px)", H), 10);
      document.getElementById("preset").value = DESIGN_NAME;   // 重置下拉
      if (!(w > 0) || !(h > 0)) return;                        // 取消/非法则保持
      cw = w; ch = h;
      editing = false;   // 自定义分辨率只读
      fit(); fillPanel();
      return;
    }
    var d = PRESETS[v] || [W, H];
    cw = d[0]; ch = d[1];
    editing = (cw === W && ch === H);   // 只有设计分辨率可编辑
    fit();
    fillPanel();
  }

  // ---- 元素交互 ----
  ELEMS.forEach(function (e) {
    var el = document.getElementById("el-" + e.idx);
    el.addEventListener("pointerdown", function (ev) {
      if (!editing) return;   // 仅设计分辨率下允许拖动
      select(e);
      el.style.zIndex = 999;
      var sx = ev.clientX, sy = ev.clientY, ox = e.x, oy = e.y;
      function move(mv) {
        e.x = ox + (mv.clientX - sx) / scale / (cw / W);   // 水平：屏幕位移 -> 设计偏移
        e.y = oy + (mv.clientY - sy) / scale / (ch / H);   // 垂直：按各自方向比例
        render(cw, ch, rs);
        // 拖动中不重建面板，避免卡顿
      }
      function up() {
        el.style.zIndex = e.z;
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        fillPanel();   // 拖动结束刷新面板数值
      }
      // document 级监听：指针移出元素也持续跟手
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
    el.addEventListener("click", function () { select(e); });
  });

  function select(e) {
    sel = e;
    document.querySelectorAll("#stage img").forEach(function (i) { i.style.outline = "none"; });
    var el = document.getElementById("el-" + e.idx);
    el.style.outline = "2px solid #4a90d9";
    fillPanel();
  }
  var ANCHOR_GRID_KEYS = ["tl","tc","tr","cl","cc","cr","bl","bc","br"];
  function gridBtn(anchor) {
    var b = document.createElement("button");
    b.textContent = anchor;
    b.className = "ag" + (sel && sel.anchor === anchor ? " on" : "");
    b.disabled = !editing;
    b.onclick = function () { if (!sel || !editing) return; changeAnchor(anchor); };
    return b;
  }
  function changeAnchor(a) {
    if (a === "stretch") {
      sel.anchor = "stretch"; sel.offL = 0; sel.offT = 0; sel.offR = 0; sel.offB = 0;
      render(cw, ch, rs); fillPanel(); return;
    }
    var old = ANCHOR[sel.anchor] || ANCHOR.cc;
    var nw = ANCHOR[a];
    sel.x += (old[0] - nw[0]) * cw;   // 保持当前位置不变（设计分辨率下绝对位置不变）
    sel.y += (old[1] - nw[1]) * ch;
    sel.anchor = a;
    render(cw, ch, rs); fillPanel();
  }
  function num(label, key) {
    var row = document.createElement("div");
    row.className = "row";
    var inp = document.createElement("input");
    inp.type = "number"; inp.value = sel ? sel[key] : "";
    inp.disabled = !editing;
    inp.onchange = function () {
      if (!sel || !editing) return;
      sel[key] = parseFloat(inp.value) || 0; render(cw, ch, rs); fillPanel();
    };
    row.textContent = label + " ";
    row.appendChild(inp);
    return row;
  }
  function absNum(label, isX) {
    // 设计分辨率下的绝对坐标（左上角原点）：显示值 = 相对锚点偏移 + 锚点在设计画布中的位置
    var a = ANCHOR[sel.anchor] || ANCHOR.cc;
    var base = isX ? a[0] * W : a[1] * H;
    var row = document.createElement("div");
    row.className = "row";
    var inp = document.createElement("input");
    inp.type = "number";
    inp.value = Math.round(sel[isX ? "x" : "y"] + base);
    inp.disabled = !editing;
    inp.onchange = function () {
      if (!sel || !editing) return;
      sel[isX ? "x" : "y"] = parseFloat(inp.value) - base;
      render(cw, ch, rs); fillPanel();
    };
    row.textContent = label + " ";
    row.appendChild(inp);
    return row;
  }
  function fillPanel() {
    panel.innerHTML = "";
    if (!sel) {
      panel.textContent = editing ? "点击画布中的图片选中元素"
                                  : "预览模式：仅设计分辨率下可编辑";
      return;
    }
    panel.appendChild(document.createTextNode(sel.name + (editing ? "" : "（预览只读）")));
    var g = document.createElement("div");
    g.className = "grid";
    ANCHOR_GRID_KEYS.forEach(function (a) { g.appendChild(gridBtn(a)); });
    panel.appendChild(g);
    var st = document.createElement("button");
    st.className = "ag st" + (sel.anchor === "stretch" ? " on" : "");
    st.textContent = "stretch 拉伸铺满";
    st.disabled = !editing;
    st.onclick = function () { if (sel && editing) changeAnchor("stretch"); };
    panel.appendChild(st);
    if (sel.anchor === "stretch") {
      panel.appendChild(num("L", "offL"));
      panel.appendChild(num("T", "offT"));
      panel.appendChild(num("R", "offR"));
      panel.appendChild(num("B", "offB"));
    } else {
      panel.appendChild(absNum("X(绝对)", true));
      panel.appendChild(absNum("Y(绝对)", false));
      panel.appendChild(num("W", "w"));
      panel.appendChild(num("H", "h"));
    }
  }

  // ---- 初始化 ----
  document.getElementById("preset").onchange = function () { presetChanged(this.value); };
  document.getElementById("save").onclick = function () {
    var data = JSON.stringify({ width: W, height: H, elements: ELEMS }, null, 2);
    function msg(t) { document.getElementById("msg").textContent = t; }
    // 服务器模式：POST /save 直接覆盖 test/layout.json；失败（file:// 打开）回退浏览器下载
    fetch("save", { method: "POST", body: data })
      .then(function (r) {
        if (!r.ok) throw 0;
        msg("已保存到 layout.json ✓");
      })
      .catch(function () {
        var blob = new Blob([data], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "layout.json";
        a.click();
        msg("已下载 layout.json（file:// 模式，无法直接覆盖）");
      });
  };
  vv.addEventListener && vv.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();
})();
"""


def gen_editor(psd_path, layout, img_dir, out_html):
    """生成自包含编辑器（图片 base64 内联）。"""
    W, H = layout["width"], layout["height"]
    srcs = load_data_uris(img_dir, [e["file"] for e in layout["elements"]])
    imgs = "\n".join(
        f'<img id="el-{e["idx"]}" src="{srcs[e["file"]]}" style="position:absolute;z-index:{e["z"]};">'
        for e in layout["elements"]
    )
    js = (EDITOR_JS
          .replace("__W__", str(W)).replace("__H__", str(H))
          .replace("__PRESETS__", json.dumps({k: [w, h] for k, w, h in PRESETS}, ensure_ascii=False))
          .replace("__ELEMS__", json.dumps(layout["elements"], ensure_ascii=False))
          .replace("__BG__", DEFAULT_BG))
    options = "\n".join(f"<option>{k}</option>" for k, _, _ in PRESETS)
    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>UI 编辑器 - {psd_path.stem}</title>
<style>
  html,body {{ margin:0; padding:0; width:100%; height:100%; background:#1c2026; overflow:hidden;
               font-family: system-ui, sans-serif; color:#ddd; }}
  #bar {{ position:fixed; left:0; top:0; right:0; height:56px; background:#262b33; z-index:1000;
          display:flex; align-items:center; gap:12px; padding:0 12px; }}
  #bar select, #bar button {{ height:30px; background:#3a4150; color:#eee; border:1px solid #4a5263;
               border-radius:4px; padding:0 8px; font-size:13px; cursor:pointer; }}
  #bar button.primary {{ background:#4a90d9; border-color:#4a90d9; }}
  #stage {{ position:absolute; left:0; top:0; background:{DEFAULT_BG}; transform-origin:0 0;
             box-shadow:0 0 0 1px #3a4150; }}
  #stage img {{ position:absolute; cursor:move; user-select:none; -webkit-user-select:none;
                 touch-action:none; }}
  #panel {{ position:fixed; right:12px; top:68px; width:200px; background:#262b33; z-index:1000;
             border:1px solid #3a4150; border-radius:6px; padding:10px; font-size:12px; }}
  #panel .grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:4px; margin:8px 0; }}
  #panel .ag {{ padding:6px 0; background:#3a4150; border:1px solid #4a5263; color:#ddd;
                 border-radius:4px; cursor:pointer; font-size:10px; }}
  #panel .ag.on {{ background:#4a90d9; border-color:#4a90d9; }}
  #panel .ag.st {{ width:100%; margin-top:4px; }}
  #panel .row {{ margin:4px 0; display:flex; justify-content:space-between; align-items:center; }}
  #panel input {{ width:70px; background:#1c2026; color:#eee; border:1px solid #3a4150;
                   border-radius:4px; padding:3px 6px; font-size:12px; }}
</style>
</head>
<body>
<div id="bar">
  <span>UI 编辑器 · {psd_path.stem}</span>
  <select id="preset">{options}</select>
  <button id="save" class="primary">保存 layout.json</button>
  <span id="msg" style="font-size:12px;color:#8fd08f;"></span>
</div>
<div id="panel"></div>
<div id="stage">
{imgs}
</div>
<script>
{js}
</script>
</body>
</html>
"""
    out_html.write_text(page, encoding="utf-8")


def gen_preview(psd_path, layout, img_dir, out_html, inline):
    """读 layout.json 生成预览页。"""
    W, H = layout["width"], layout["height"]
    srcs = load_data_uris(img_dir, [e["file"] for e in layout["elements"]]) if inline else {}
    imgs = "\n".join(
        f'<img id="el-{e["idx"]}" src="{(srcs.get(e["file"]) or "images/" + e["file"])}" '
        f'style="position:absolute;z-index:{e["z"]};">'
        for e in layout["elements"]
    )
    js = (PREVIEW_JS
          .replace("__W__", str(W)).replace("__H__", str(H))
          .replace("__ELEMS__", json.dumps(layout["elements"], ensure_ascii=False))
          .replace("__BG__", DEFAULT_BG))
    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>预览 - {psd_path.stem}</title>
<style>
  html,body {{ margin:0; padding:0; width:100%; height:100%; background:{DEFAULT_BG}; overflow:hidden; }}
  #stage {{ position:absolute; left:0; top:0; transform-origin:0 0; }}
  #stage img {{ position:absolute; }}
</style>
</head>
<body>
<div id="stage">
{imgs}
</div>
<script>
{js}
</script>
</body>
</html>
"""
    out_html.write_text(page, encoding="utf-8")


def serve(psd_path, port):
    """本地服务器：提供编辑器页面 + POST /save 覆盖 layout.json。"""
    layout_path = psd_path.parent / "layout.json"

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(psd_path.parent), **kw)

        def do_POST(self):
            if self.path != "/save":
                self.send_error(404)
                return
            n = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(n)
            layout_path.write_bytes(data)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"编辑器: http://localhost:{port}/editor.html")
    print(f"保存会直接覆盖: {layout_path}  (Ctrl+C 停止)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    ap = argparse.ArgumentParser(description="简易游戏 UI 编辑器：PSD -> 编辑器 -> 预览")
    ap.add_argument("psd", help="PSD 文件")
    ap.add_argument("--scale", type=int, default=2, help="切图放大倍数（默认 2）")
    ap.add_argument("--preview", action="store_true", help="读 layout.json 生成预览页")
    ap.add_argument("--inline", action="store_true", help="预览页图片内联 base64")
    ap.add_argument("--serve", action="store_true", help="启动本地服务器（保存直接覆盖 layout.json）")
    ap.add_argument("--port", type=int, default=8080, help="服务器端口（默认 8080）")
    ap.add_argument("--only", help="只保留这些图层（逗号分隔，如 背景,头像）")
    ap.add_argument("--center", help="把这些图层居中（逗号分隔，anchor=cc 且偏移=半尺寸）")
    args = ap.parse_args()

    psd_path = Path(args.psd)
    out_dir = psd_path.parent
    img_dir = out_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    layout_path = out_dir / "layout.json"

    if args.serve:
        serve(psd_path, args.port)
        return

    if args.preview:
        layout = json.loads(layout_path.read_text(encoding="utf-8"))
        gen_preview(psd_path, layout, img_dir, out_dir / "preview.html", args.inline)
        print(f"预览: {out_dir / 'preview.html'}")
        return

    psd = PSDImage.open(psd_path)
    layers = collect_layers(psd)
    slices = [s for s in (crop_export(l, args.scale, img_dir) for l in layers) if s]
    if args.only:
        keep = set(args.only.split(","))
        slices = [s for s in slices if s["name"] in keep]
    layout = build_layout(psd, slices)
    if args.center:
        center = set(args.center.split(","))
        for e in layout["elements"]:
            if e["name"] in center:
                e["anchor"] = "cc"
                e["x"] = -e["w"] / 2   # 左上角相对容器中心偏移半尺寸 -> 元素中心=容器中心
                e["y"] = -e["h"] / 2
    layout_path.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8")
    gen_editor(psd_path, layout, img_dir, out_dir / "editor.html")
    print(f"设计尺寸: {psd.width}x{psd.height}  图层: {len(slices)}")
    print(f"布局: {layout_path}")
    print(f"编辑器: {out_dir / 'editor.html'}  (浏览器打开，编辑后点「保存 layout.json」)")


if __name__ == "__main__":
    main()
