# UI 控件字段对齐记录

## 1. 文档目的

本文记录真实游戏项目中自研引擎 UI 控件字段的含义，以及它们与 UI 编辑器内部模型之间的对应关系。

必须区分两套模型：

- **自研引擎字段**：真实游戏 JSON 使用的字段，最终导出目标。
- **UI 编辑器字段**：编辑器内部用于 PSD 导入、画布编辑、预览和工程保存的字段。

编辑器内部可以适当统一字段；导出自研引擎 JSON 时，必须按控件类型转换成引擎真实字段名，不能混用两套字段。

## 2. 自研引擎 JSON 结构

典型结构：

```json
{
  "Dialog": {
    "Window": {
      "Type": "Layout",
      "Name": "root",
      "Property": [],
      "Window": []
    }
  }
}
```

属性通常以 `Property[].Name` 和 `Property[].Value` 保存。

真实项目表现为“属性覆盖保存”模式：未修改的属性通常不写入 JSON，只有被设置或修改过的属性才记录。

## 3. 已确认的通用引擎字段

### 3.1 `Area`

`Area` 同时包含位置和尺寸，四组数据彼此独立：

```text
Area = {{X相对值,X绝对值},
        {Y相对值,Y绝对值},
        {宽度相对值,宽度绝对值},
        {高度相对值,高度绝对值}}
```

计算基于父控件尺寸：

```text
实际 X = 父控件宽度 × X相对值 + X绝对值
实际 Y = 父控件高度 × Y相对值 + Y绝对值
实际宽度 = 父控件宽度 × 宽度相对值 + 宽度绝对值
实际高度 = 父控件高度 × 高度相对值 + 高度绝对值
```

规则：

- 参照父控件尺寸，不是固定参照整个屏幕。
- 相对值允许大于 `1`。
- 相对值允许为负数，但负数效果等同于 `0`。
- 位置和宽高不互相计算边界，宽高是独立属性。

编辑器的 `designRect`、`anchor`、`adaptation` 不能直接当作引擎 `Area`。导出时需要根据编辑器布局结果重新生成四组值。

### 3.2 `HorizontalAlignment`

控件整体的水平对齐：

```text
Left
Centre
Right
```

它不是文字水平对齐；文字使用 `TextHorzAlignment`。

### 3.3 `VerticalAlignment`

控件整体的垂直对齐：

```text
Top
Centre
Bottom
```

它不是文字垂直对齐；文字使用 `TextVertAlignment`。

当位置为 `0,0` 且水平、垂直对齐都为 `Centre` 时，控件以自身尺寸为基准整体居中。之后修改位置坐标，是相对这个居中位置进行偏移。

### 3.4 `StretchType`

当前确认并保留的选项：

```text
None
NineGrid
MirrorHorizontal
MirrorVertical
```

含义：

| 值 | 含义 |
|---|---|
| `None` | 正常显示图片 |
| `NineGrid` | 九宫格拉伸 |
| `MirrorHorizontal` | 水平翻转图片 |
| `MirrorVertical` | 垂直翻转图片 |

以下选项暂时忽略，不作为当前美术编辑器的必要能力：

```text
RepeatFill
TopBottom
LeftRight
Sector
```

实际项目中：

- `NineGrid` 在 Layout、StaticImage、Button、CheckBox、RadioButton、Edit、ProgressBar、Slider 等类型中出现。
- `MirrorHorizontal`、`MirrorVertical` 主要在 Layout、StaticImage、Button 中出现。
- `None` 未发现显式 JSON 记录，推测为默认状态。

### 3.5 `StretchOffset`

只有 `StretchType = NineGrid` 时生效。

顺序是：

```text
左 右 上 下
```

例如：

```text
2 3 4 5
```

表示左边距 2、右边距 3、顶边距 4、底边距 5。

默认值：

```text
0 0 0 0
```

### 3.6 `DrawColor`

给控件绘制的图片进行颜色修改，使用正片叠底式颜色乘算。白色图片可以被染成指定颜色。

格式：

```text
R G B A
```

数值范围为 `0～1`，例如：

```json
{
  "Name": "DrawColor",
  "Value": "0.541176 0.541176 1 1"
}
```

这是控件级属性，一个控件只有一个 `DrawColor`，不是每个图片资源槽位分别设置。未设置时不写入 JSON。

如果同一控件需要不同图片颜色，应拆分成多个子控件，分别设置颜色。

### 3.7 `BackgroundColor`

控件背景填充色，格式也是 RGBA，范围为 `0～1`。

默认值：

```text
0 0 0 0
```

所有控件都有该属性，但真实项目中只有主动修改后才会记录，默认透明状态不写入 JSON。

## 4. 不纳入当前美术编辑器的引擎字段

以下字段属于引擎或程序运行时能力，当前不作为美术 UI 编辑器的必要属性：

```text
Enabled
Touchable
Visible
Material
Level
AlwaysOnTop
MaxWidth
MinWidth
MaxHeight
MinHeight
```

已确认的特殊规则：

- `Enabled`、`Touchable`、`Visible` 由下游程序控制，美术拼 UI 时不需要编辑。
- `Material` 更偏图片渲染、抗锯齿或材质处理，同一控件类型中有的记录、有的不记录，暂不加入。
- `Level` 默认值为 `50`；数值越大越靠底层，容易被遮挡；相同 Level 时按节点层级前后决定绘制顺序；不影响触摸。
- `AlwaysOnTop` 暂不加入。
- `MaxWidth`、`MinWidth`、`MaxHeight`、`MinHeight` 美术大概率用不上，暂不加入。
- 尺寸限制必须先设置，或设置后再次修改 `Area`，才会真正限制尺寸。

## 5. 自研引擎图片属性字段

图片字段不是统一名称，而是由控件类型决定。

| 自研引擎控件类型 | 图片属性字段 |
|---|---|
| `Layout` | `LayoutBackImage` |
| `StaticImage` | `ImageName` |
| `Button` | `NormalImage`、`PushedImage` |
| `CheckBox` | `NormalImage`、`PushedImage` |
| `RadioButton` | `NormalImage`、`PushedImage` |
| `Edit` | `EditBackImage` |
| `ProgressBar` | `ProgressBackImage`、`ProgressImage`、`ProgressHeaderImage` |
| `Slider` | `ProgressBackImage`、`ProgressImage`、`ProgressHeaderImage` |
| `ListHorizontal` | `ListItemSelectImage` |

### 暂不支持的特殊图片字段

真实项目还出现过六边形控件相关字段：

```text
HexgonTopImage
HexgonSideImage
HexgonOverlayerImage
```

它们通常还配套：

```text
HexgonTopColor
HexgonSideColor
HexgonOverlayerColor
```

这些属于特殊控件外观，当前不加入普通美术编辑器。

## 6. 编辑器内部资源抽象与导出映射

编辑器内部可以使用统一资源槽位，例如：

```text
background
normal
pressed
progressBackground
progressFill
progressHeader
selected
```

导出自研引擎 JSON 时必须按控件类型映射：

| 编辑器内部槽位 | 自研引擎导出字段 |
|---|---|
| Layout 背景图 | `LayoutBackImage` |
| 普通图片 | `ImageName` |
| 普通状态 | `NormalImage` |
| 按下/选中状态 | `PushedImage` |
| 输入框背景 | `EditBackImage` |
| 进度背景 | `ProgressBackImage` |
| 进度填充 | `ProgressImage` |
| 进度头/滑块头 | `ProgressHeaderImage` |
| 列表选中图 | `ListItemSelectImage` |

`CheckBox` 和 `RadioButton` 的“初始勾选/初始选中”是编辑器预览状态，保存在工程 `.ui.json` 的 `ctrl.selected` 中；真实项目布局 JSON 没有对应字段，因此导出自研引擎 JSON 时忽略该字段。

## 7. 编辑器字段与引擎字段的关系

当前编辑器内部字段仍保持自己的用途：

```text
designRect
anchor
adaptation
scale
rotation
opacity
zIndex
resources
slice
progress
ctrl
```

这些字段不应直接原样当成自研引擎属性导出。

重要区别：

```text
编辑器 zIndex       ≠ 引擎 Level
编辑器 opacity      ≠ 引擎 DrawColor
编辑器 slice        ≠ 引擎完整 StretchType
编辑器 designRect   ≠ 引擎 Area
```

## 8. 属性保存原则

编辑器和导出器都应保留“未设置”和“设置为默认值”的区别。

例如：

```text
DrawColor 未设置
→ 不保存编辑器字段
→ 不导出 DrawColor
```

```text
DrawColor 主动设置为 1 1 1 1
→ 保存编辑器字段
→ 导出 DrawColor = "1 1 1 1"
```

同理，`BackgroundColor`、`StretchType`、`StretchOffset` 等可选属性只有在用户主动设置时才应写入目标 JSON。

## 9. 当前优先支持范围

### 编辑器中需要支持

```text
Area
HorizontalAlignment
VerticalAlignment
StretchType：None、NineGrid、MirrorHorizontal、MirrorVertical
StretchOffset：仅 NineGrid 使用
DrawColor
BackgroundColor
普通图片资源槽位
```

### 当前暂不支持

```text
Enabled
Touchable
Visible
Material
Level
AlwaysOnTop
MaxWidth
MinWidth
MaxHeight
MinHeight
RepeatFill
TopBottom
LeftRight
Sector
HexgonTopImage
HexgonSideImage
HexgonOverlayerImage
```

后续目标是：编辑器内部适当统一，导出阶段准确映射为自研引擎可用 JSON。
