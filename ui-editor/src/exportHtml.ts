// 导出自包含的自适应网页 HTML：场景数据 + 图片(base64) + 布局引擎(JS) 全部内联
import type { ScaleMode, UINode, UIScene } from "./types";

interface FlatNode {
  name: string;
  img: string;
  txt?: { t: string; fs: number; c: string; f?: string; m?: string; mfs?: number } | null;
  w: number; h: number;
  dx: number; dy: number;
  a: UINode["anchor"];
  mode: UINode["adaptation"]["mode"];
  opacity: number; visible: boolean; z: number;
  p: number; // 父组在数组中的下标（-1 = 根级）
  li?: boolean; // 是父 list 的 li 项（由 list 重排）
  l?: UINode["list"] | null; // list 配置
}

/** DFS 平铺：组节点在前（父下标 < 子下标），子节点带父组下标 */
function flatten(nodes: UINode[], out: FlatNode[] = [], parentIdx = -1): FlatNode[] {
  for (const n of nodes) {
    const idx = out.length;
    const parentIsList = parentIdx >= 0 && !!(out[parentIdx] as any)?.l;
    const isLi = parentIsList && !!n.children && n.name.toLowerCase() !== "list";
    out.push({
      name: n.name,
      img: n.image ? n.image.toDataURL("image/png") : "",
      txt: n.text ? { t: n.text.content, fs: n.text.fontSize, c: n.text.color, f: n.text.font, m: n.text.mode, mfs: n.text.minFontSize } : null,
      w: n.designRect.width, h: n.designRect.height,
      dx: n.designRect.x, dy: n.designRect.y,
      a: n.anchor, mode: n.adaptation.mode,
      opacity: n.opacity, visible: n.visible, z: n.zIndex,
      p: parentIdx,
      ...(isLi ? { li: true } : {}),
      ...(n.list ? { l: n.list } : {}),
    });
    if (n.children) flatten(n.children, out, idx);
  }
  return out;
}

export function buildExportHtml(scene: UIScene, scaleMode: ScaleMode,
  safeArea: { left: number; right: number; top: number; bottom: number }): string {
  const data = JSON.stringify({
    width: scene.designWidth, height: scene.designHeight,
    scaleMode, safeArea, nodes: flatten(scene.nodes),
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

var IMGS = {};
var READY = 0;
SCENE.nodes.forEach(function (n) {
  if (!n.img) return;
  var im = new Image();
  im.src = n.img;
  IMGS[n.name] = im;
  im.onload = function () { READY++; draw(); };
});

function origin(n, parent, vw, vh, sx, sy, lx, ly) {
  var sa = SCENE.safeArea;
  if (parent) return { x: parent.x + n.a.parentX * parent.w + n.a.offsetX * sx, y: parent.y + n.a.parentY * parent.h + n.a.offsetY * sy };
  if (n.a.safeArea) return { x: sa.left + n.a.parentX * (vw - sa.left - sa.right) + n.a.offsetX * sx, y: sa.top + n.a.parentY * (vh - sa.top - sa.bottom) + n.a.offsetY * sy };
  if (SCENE.scaleMode === "cover") return { x: n.a.parentX * vw + n.a.offsetX * sx, y: n.a.parentY * vh + n.a.offsetY * sy };
  return { x: lx + n.a.parentX * SCENE.width * sx + n.a.offsetX * sx, y: ly + n.a.parentY * SCENE.height * sy + n.a.offsetY * sy };
}
function max0(arr) { return Math.max.apply(0, arr.length ? arr : [0]); }

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
  var rects = new Array(SCENE.nodes.length);
  var out = [];
  SCENE.nodes.forEach(function (n, i) {
    var r;
    if (n.li) {
      // li 的矩形已由父 list 分支算好（重排结果），复用
      r = rects[i];
      if (!n.img && !n.txt) return;
      out.push({ n: n, r: r });
      return;
    }
    var parent = n.p >= 0 ? rects[n.p] : null;
    if (n.l) {
      // ---- list：li 重排 + 容器自适应 ----
      var lis = [], others = [];
      SCENE.nodes.forEach(function (c, j) { if (c.p === i) { (c.li ? lis : others).push(j); } });
      var liDims = lis.map(function (j) { return { w: SCENE.nodes[j].w * sx, h: SCENE.nodes[j].h * sy }; });
      var pad = n.l.padding, spX = n.l.spacing * sx, spY = n.l.spacing * sy;
      var cw = 0, ch = 0;
      if (n.l.type === "horizontal") {
        cw = liDims.reduce(function (s, d) { return s + d.w; }, 0) + spX * Math.max(0, lis.length - 1);
        ch = max0(liDims.map(function (d) { return d.h; }));
      } else if (n.l.type === "vertical") {
        ch = liDims.reduce(function (s, d) { return s + d.h; }, 0) + spY * Math.max(0, lis.length - 1);
        cw = max0(liDims.map(function (d) { return d.w; }));
      } else {
        var cols = Math.max(1, Math.min(n.l.columns || 3, lis.length));
        var rows = Math.ceil(lis.length / cols);
        var mw = max0(liDims.map(function (d) { return d.w; }));
        var mh = max0(liDims.map(function (d) { return d.h; }));
        cw = cols * mw + (cols - 1) * spX; ch = rows * mh + (rows - 1) * spY;
      }
      var o = origin(n, parent, vw, vh, sx, sy, lx, ly);
      r = { x: o.x, y: o.y, w: cw + (pad.left + pad.right) * sx, h: ch + (pad.top + pad.bottom) * sy };
      rects[i] = r;
      var accX = pad.left * sx, accY = pad.top * sy;
      var cellW = max0(liDims.map(function (d) { return d.w; }));
      var cellH = max0(liDims.map(function (d) { return d.h; }));
      lis.forEach(function (j, k) {
        var d = liDims[k], lx2, ly2;
        if (n.l.type === "horizontal") { lx2 = accX; ly2 = accY; accX += d.w + spX; }
        else if (n.l.type === "vertical") { lx2 = accX; ly2 = accY; accY += d.h + spY; }
        else {
          var cols2 = Math.max(1, Math.min(n.l.columns || 3, lis.length));
          lx2 = pad.left * sx + (k % cols2) * (cellW + spX);
          ly2 = pad.top * sy + Math.floor(k / cols2) * (cellH + spY);
        }
        rects[j] = { x: r.x + lx2, y: r.y + ly2, w: d.w, h: d.h };
      });
      if (!n.img && !n.txt) return;
    } else if (n.mode === "stretch") {
      if (parent) { r = { x: parent.x, y: parent.y, w: parent.w, h: parent.h }; }
      else if (n.a.safeArea) { r = { x: sa.left, y: sa.top, w: vw - sa.left - sa.right, h: vh - sa.top - sa.bottom }; }
      else { r = { x: 0, y: 0, w: vw, h: vh }; }
    } else {
      var w = n.w * sx, h = n.h * sy;
      if (parent) {
        r = { x: parent.x + n.a.parentX * parent.w + n.a.offsetX * sx - n.a.selfX * w,
              y: parent.y + n.a.parentY * parent.h + n.a.offsetY * sy - n.a.selfY * h, w: w, h: h };
      } else if (n.a.safeArea) {
        r = { x: sa.left + n.a.parentX * (vw - sa.left - sa.right) + n.a.offsetX * sx - n.a.selfX * w,
              y: sa.top + n.a.parentY * (vh - sa.top - sa.bottom) + n.a.offsetY * sy - n.a.selfY * h, w: w, h: h };
      } else if (SCENE.scaleMode === "cover") {
        r = { x: n.a.parentX * vw + n.a.offsetX * sx - n.a.selfX * w,
              y: n.a.parentY * vh + n.a.offsetY * sy - n.a.selfY * h, w: w, h: h };
      } else {
        r = { x: lx + n.a.parentX * dw * sx + n.a.offsetX * sx - n.a.selfX * w,
              y: ly + n.a.parentY * dh * sy + n.a.offsetY * sy - n.a.selfY * h, w: w, h: h };
      }
    }
    rects[i] = r;
    if (!n.img && !n.txt) return; // 组：只计算矩形，不绘制
    out.push({ n: n, r: r });
  });
  return out;
}

/** 估算字符宽/文本宽/换行/fit 字号（与编辑器一致） */
function charW(ch, fs) { var c = ch.codePointAt ? ch.codePointAt(0) : ch.charCodeAt(0); return c > 0x2e7f ? fs : (c <= 0x7f ? fs * 0.55 : fs * 0.8); }
function tWidth(t, fs) { var w = 0; for (var i = 0; i < t.length; i++) w += charW(t[i], fs); return w; }
function wrap(t, fs, maxW) {
  var lines = [], line = "";
  for (var i = 0; i < t.length; i++) {
    var ch = t[i];
    if (ch === "
") { lines.push(line); line = ""; continue; }
    if (line && tWidth(line + ch, fs) > maxW) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}
function fitFs(t, maxFs, minFs, boxW, boxH) {
  for (var f = maxFs; f >= minFs; f--) { var ls = wrap(t, f, boxW); if (ls.length * f * 1.2 <= boxH) return f; }
  return minFs;
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
    ctx.save();
    ctx.globalAlpha = r.n.opacity;
    if (r.n.img) {
      var im = IMGS[r.n.name];
      if (im && im.complete) ctx.drawImage(im, r.r.x, r.r.y, r.r.w, r.r.h);
    } else if (r.n.txt) {
      var fsScale = SCENE.scaleMode === "fill" ? vw / SCENE.width : Math.min(vw / SCENE.width, vh / SCENE.height);
      ctx.font = r.n.txt.fs * fsScale + 'px ' + (r.n.txt.f ? '"' + r.n.txt.f + '", ' : '') + '"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = r.n.txt.c;
      ctx.textBaseline = "top";
      ctx.fillText(r.n.txt.t, r.r.x, r.r.y, r.r.w);
    }
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
