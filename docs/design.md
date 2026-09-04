# UI2HTML — PSD → 自研引擎 UI 资源工具 设计文档

> 状态:讨论稿 v1 · 2026-08-22 · 蓝图已与需求方确认,**尚未开工实施**
> 关联代码:`E:\ui2html\ui-editor\`(Vite + React + TS 前端)

---

## 1. 项目概述

一个本地网页工具:读取 PSD 源文件,通过一系列便捷操作补足将其转换为**自研游戏引擎可用的 UI 文件**所需的附加数据(适配、控件类型、动画、资源读取、数据保存等),并支持导出。

- 工具形态:本地工具(`start.bat` + Vite dev server),不做部署/账号/协作
- 引擎约束:自研引擎 UI 用 JSON 保存;图片**必须图集**(读不了散图);单图集上限 **1024×1024**,大图需拆多个图集;引擎侧用 texture packer 打包
- 引擎运行时语言:程序员写 **Lua**(运行时本体语言未确认)

## 2. 现状盘点(已有能力)

来源:源码阅读(ui-editor/src),详见各处行号。

| 能力 | 现状 |
|---|---|
| PSD 解析 | `psdImport.ts`,ag-psd `readPsd`;图层树、文本图层、图层样式(投影/描边)裁剪位图、矢量 shape 兜底栅格化、"9" 文件夹九宫格约定；文件夹导入为 Layout，不按名称推断控件类型 |
| 数据模型 | `types.ts`:`UIScene`/`UINode`(designRect、anchor、adaptation.mode、slice、ctrl 12 种、text 三模式、list、psd 溯源、locked)、`InteractionTemplate`、`LayoutContext/Result` |
| 布局引擎 | `layoutEngine.ts`(编辑器预览用):5 种整体缩放、anchor/scale/stretch 三种适配、list 重排、组内锚点参照 |
| 导出 | `exportHtml.ts`:单文件自包含 HTML(数据 + base64 图 + 内联精简布局引擎)。**不导出工程 JSON / 交互 / 动画 / 九宫格** |
| 工作流 | `WorkspaceTabs.tsx`:层级 → 九宫格 → 布局适配 → 动画(占位)→ 导出(占位);未标完控件类型时锁定后续工作区 |
| 数据保存 | Ctrl+S / "导出配置" 写 `<psd名>.json`(锚点+九宫格+控件+模板)到 public/psd,打开时读回;九宫格编辑自动存 localStorage |
| 交互模板 | 仅数据定义 + Inspector 编辑,无运行时应用 |

**空白/占位**:动画工作区(占位)、导出工作区(占位)、验收预览、自研引擎侧一切(适配器/格式/导出)。

## 3. 目标需求

1. PSD 导入后,通过便捷操作补足:适配、控件类型、动画、资源(图集)、数据保存
2. **完整关键帧动画编辑器**:位置/缩放/旋转/透明度四属性,关键帧插值
3. 图片输出为**图集**(TexturePacker 兼容 JSON+PNG),自动拆分(≤1024×1024,超大图独占)
4. 文本图层**运行时渲染**(不进图集)
5. **验收预览**:补齐数据后按"引擎模拟"效果预览自查,满意才导出
6. 导出 zip:UI JSON + 图集 PNG/JSON + Lua 动画文件
7. 优先自研引擎;主流引擎留扩展位,本轮不实现

## 4. 已确认决策(需求盘问结论)

| # | 主题 | 结论 |
|---|---|---|
| Q1 | 数据格式 | 中间格式 JSON 为事实标准(引擎吃 JSON,但暂无线索样例) |
| Q2 | 引擎优先级 | 自研优先;主流引擎留扩展位,本轮不做 |
| Q3 | 动画粒度 | 完整关键帧编辑器(四属性 + 插值) |
| Q6/Q14 | 动画交付 | **Lua 单文件**(数据表 + 驱动函数,`playAnim(node, name)`),引擎零改动;美术改动画 → 重导出 Lua → 替换文件 |
| Q7 | 动画模型 | 每节点多命名动画(appear/idle/hide…);插值 linear/ease-in/ease-out/ease-in-out;循环/延迟/自动播放;自定义贝塞尔留扩展位 |
| Q4/Q8/Q11 | 图集 | 必须图集;工具**内置打包**(浏览器内 JS),输出 **TexturePacker 兼容** JSON+PNG;单图集 ≤1024×1024 |
| Q12 | 多图集 | **自动拆分**(超大图独占图集) |
| Q13 | 文本 | 运行时渲染:JSON 存内容/字号/颜色/对齐/字体 |
| Q15 | 导出形态 | 浏览器内下载 **zip**(UI JSON + 图集 PNG/JSON + 可选 Lua) |
| Q5 | 工具形态 | 本地工具,不部署 |
| Q9 | 导出边界 | 中间格式 + **薄适配层**(可替换映射);当前输出与中间格式同构的 JSON,拿到引擎样例后只改映射层 |

## 5. 中间格式草案(UI JSON)

```jsonc
{
  "version": 1,
  "name": "签到",
  "designWidth": 1280,
  "designHeight": 720,
  "atlas": ["签到_atlas_1"],          // 引用的图集名
  "nodes": [
    {
      "name": "btn_start",
      "type": "button",               // 12 种控件类型之一
      "rect": { "x": 0, "y": 0, "w": 200, "h": 80 },
      "anchor": { "parentX": 0.5, "parentY": 1, "selfX": 0.5, "selfY": 1, "offsetX": 0, "offsetY": -20, "safeArea": false },
      "adaptation": { "mode": "anchor" },   // anchor | scale | stretch
      "slice": { "l": 10, "r": 10, "t": 10, "b": 10 },  // 九宫格
      "image": { "atlas": "签到_atlas_1", "sprite": "btn_start" },
      "text": { "content": "开始", "fontSize": 28, "color": "#FFFFFF", "align": "center" },  // 运行时渲染
      "animations": {
        "appear": {
          "tracks": {
            "position": [ { "t": 0, "v": [0, -20], "ease": "ease-out" }, { "t": 0.3, "v": [0, 0], "ease": "ease-out" } ],
            "opacity":  [ { "t": 0, "v": 0, "ease": "linear" }, { "t": 0.3, "v": 1, "ease": "linear" } ]
          },
          "loop": false, "delay": 0, "autoPlay": false, "duration": 0.3
        }
      }
    }
  ],
  "interactionTemplates": { /* 现有 pressScale/pressOpacity/... 保留 */ }
}
```

> 注:该格式为**中间格式草案**,非引擎最终格式。引擎适配层将来把此结构映射到引擎 UI JSON。

## 6. 工作区流程(修订版)

```
层级 → 九宫格 → 布局适配 → 动画 → 验收预览 → 导出
```

- 层级:游戏引擎式层级树，负责选择、展开/折叠、显隐、锁定，并显示节点当前控件类型图标
- 控件类型:在右侧 Inspector 指定 12 种类型；未标完时锁定后续工作区
- 动画:时间轴编辑器(见 §7)
- 验收预览:引擎模拟视图(见 §8)
- 导出:zip 下载(见 §9)

## 7. 动画编辑器(P2)

- 动画 tab 由占位变为时间轴编辑器
- 能力:命名动画管理(增/删/重命名)、四属性轨道(position/scale/rotation/opacity)、关键帧增删拖拽、缓动选择(linear/ease-in/ease-out/ease-in-out)、循环/延迟/自动播放参数、编辑器内预览播放
- 数据落在 `UINode.animations`,随 Ctrl+S 的 `<psd名>.json` 保存

## 8. 验收预览工作区(P4)

引擎模拟模式,渲染"最终导出效果"而非加工视图:

- **图集渲染**:节点图片从打包后的图集加载(复用 P3 打包器),而非 PSD 原图;校验图集引用、九宫格 slice、大图拆分正确性;缺失/未进图集的资源高亮提示
- **动画播放**:自动播放 `autoPlay` 动画;可手动触发任意命名动画(= 模拟 `playAnim`)
- **文本引擎渲染**:字号/颜色/对齐/换行按引擎规则绘制
- **多分辨率模拟**:切换设计分辨率与若干目标分辨率,检查锚点/适配结果
- 满意 → 进入导出;不满意 → 返回对应工作区修改

## 9. 导出管线(P5/P6)

导出 zip 内容:

```
<name>.ui.json        // 中间格式 UI 数据
<name>_atlas_1.png    // 图集(自动拆分,TexturePacker 兼容)
<name>_atlas_1.json
<name>_atlas_2.png    // 如需
<name>_atlas_2.json
<name>_anim.lua       // Lua 动画模块:数据表 + playAnim 驱动函数
```

- P3 图集打包器:浏览器内矩形排布(maxrects-packer 类库)+ 1024×1024 自动拆分 + TexturePacker 兼容 JSON 输出
- P6 Lua 生成器:`playAnim(node, "appear")` 驱动函数 + 动画数据表;引擎零改动

## 10. 实施阶段计划

| 阶段 | 内容 | 依赖 |
|---|---|---|
| P1 | 数据模型扩展:`types.ts` 加 animations/图集引用;JSON 读写兼容 | — |
| P2 | 动画编辑器:时间轴 UI + 关键帧编辑 + 预览播放 | P1 |
| P3 | 图集打包器:排布打包 + 1024 自动拆分 + TexturePacker 输出 | — |
| P4 | 验收预览工作区:图集渲染 + 动画播放 + 多分辨率模拟 + 缺失提示 | P2、P3 |
| P5 | 导出管线:UI JSON 序列化 + 图集 + zip 下载 | P3、P4 |
| P6 | Lua 动画模块生成器 | P2 |

> 当前状态:**P1–P6 均未开工**。需求方先继续试用现有功能,收集调整意见后再启动。

## 11. 开放问题 / 待议

1. **控件类型手动标记交互**:已确定在右侧 Inspector 指定，左侧“层级”面板仅显示类型图标并负责层级管理
2. **引擎侧样例缺失**:引擎 UI JSON / 图集 JSON 样例暂缺,适配层暂输出中间格式同构 JSON,拿到样例后只改映射层
3. **引擎运行时本体语言未确认**:已知程序员写 Lua;若运行时是 C++/C# 等,适配层与 Lua 生成器需再评估
4. **控件行为(按钮态等)**:12 种控件类型目前只是标签,引擎侧控件系统对应关系待确认
5. **图集自动拆分策略细节**:超大图独占图集、命名规则(`<name>_atlas_N`)、是否允许手动指定分组(留扩展位)
6. **交互模板(pressScale 等)运行时应用**:数据已定义,是否进入最终导出/预览待定
7. **控件类型扩展——特效与模型(需求方补充)**:引擎 UI 编辑器还支持**特效(effect)**与**模型(model)**两种控件类型,现有 `CTRL_TYPES` 12 种(empty/button/toggle/image/text/panel/list/listitem/progress/slider/scrollbar/input)不含;需评估:是否纳入中间格式 `CtrlType`、各自的数据字段(特效:资源引用/播放参数/循环;模型:模型资源引用/相机/朝向等)以及导出映射
