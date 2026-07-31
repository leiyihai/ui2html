// 导出自包含的自适应网页 HTML：场景数据 + 图片(base64) + 布局引擎(JS) 全部内联
import type { ScaleMode, UIScene } from "./types";

export function buildExportHtml(scene: UIScene, scaleMode: ScaleMode,
  safeArea: { left: number; right: number; top: number; bottom: number }): string {
  const nodes = scene.nodes.map((n) => ({
    name: n.name,
    img: n.image ? n.image.toDataURL("image/png") : "",
    w: n.designRect.width, h: n.designRect.height,
    dx: n.designRect.x, dy: n.designRect.y,
    a: n.anchor, mode: n.adaptation.mode,
    opacity: n.opacity, visible: n.visible, z: n.zIndex,
  }));
  const data = JSON.stringify({
    width: scene.designWidth, height: scene.designHeight,
    scaleMode, safeArea, nodes,
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>UI 预览</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #15181d; overflow: hidden; }
  #wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  canvas { box-shadow: 0 0 0 1px #3a4150; }
</style>
</head>
<body>
<div id="wrap"><canvas id="c"></canvas></div>
<script>
var SCENE = ${data};

// ---- 布局引擎（与编辑器 LayoutEngine 一致）----
var IMGS = {};
var READY = 0;
SCENE.nodes.forEach(function (n) {
  if (!n.img) return;
  var im = new Image();
  im.src = n.img;
  IMGS[n.name] = im;
  im.onload = function () { READY++; draw(); };
});

function layout(vw, vh) {
  var dw = SCENE.width, dh = SCENE.height;
  var sx, sy;
  switch (SCENE.scaleMode) {
    case "width": sx = sy = vw / dw; break;
    case "height": sx = sy = vh / dh; break;
    case "fill": sx = vw / dw; sy = vh / dh; break;
    case "cover": sx = sy = Math.min(vw / dw, vh / dh); break;
    default: sx = sy = Math.min(vw / dw, vh / dh);
  }
  var lx = (vw - dw * sx) / 2, ly = (vh - dh * sy) / 2;
  var sa = SCENE.safeArea;
  return SCENE.nodes.map(function (n) {
    if (n.mode === "stretch") {
      var bx = n.a.safeArea ? sa.left : 0, by = n.a.safeArea ? sa.top : 0;
      var bw = n.a.safeArea ? vw - sa.left - sa.right : vw;
      var bh = n.a.safeArea ? vh - sa.top - sa.bottom : vh;
      return { n: n, x: bx, y: by, w: bw, h: bh };
    }
    var w = n.w * sx, h = n.h * sy;
    var x, y;
    if (n.mode === "scale") { x = lx + n.dx * sx; y = ly + n.dy * sy; }
    else if (n.a.safeArea) {
      x = sa.left + n.a.parentX * (vw - sa.left - sa.right) + n.a.offsetX * sx - n.a.selfX * w;
      y = sa.top + n.a.parentY * (vh - sa.top - sa.bottom) + n.a.offsetY * sy - n.a.selfY * h;
    } else if (SCENE.scaleMode === "cover") {
      x = n.a.parentX * vw + n.a.offsetX * sx - n.a.selfX * w;
      y = n.a.parentY * vh + n.a.offsetY * sy - n.a.selfY * h;
    } else {
      x = lx + n.a.parentX * dw * sx + n.a.offsetX * sx - n.a.selfX * w;
      y = ly + n.a.parentY * dh * sy + n.a.offsetY * sy - n.a.selfY * h;
    }
    return { n: n, x: x, y: y, w: w, h: h };
  });
}

function draw() {
  var vw = window.innerWidth, vh = window.innerHeight;
  var dpr = window.devicePixelRatio || 1;
  var c = document.getElementById("c");
  var out = layout(vw, vh);
  c.width = vw * dpr; c.height = vh * dpr;
  c.style.width = vw + "px"; c.style.height = vh + "px";
  var ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  out.slice().sort(function (a, b) { return a.n.z - b.n.z; }).forEach(function (r) {
    if (!r.n.visible) return;
    var im = IMGS[r.n.name];
    if (!im || !im.complete) return;
    ctx.save();
    ctx.globalAlpha = r.n.opacity;
    ctx.drawImage(im, r.x, r.y, r.w, r.h);
    ctx.restore();
  });
}

window.addEventListener("resize", draw);
draw();
</script>
</body>
</html>
`;
}
