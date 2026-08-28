# PSD 文件夹使用与命名规则

## 文件夹使用规则

- 文件夹表示一个可包含子节点的 UI 容器。
- 文件夹名使用控件类型缩写作为开头，后面可使用下划线补充业务名称。
- 未使用约定缩写的文件夹，在 PSD 导入后保持为“未标记”。
- `layout` 表示普通布局容器，对应引擎类型 `Layout`。
- 文件夹名不使用 `txt` 判断文本类型；文本图层由 PSD 解析结果直接识别。

## 控件类型命名

| 引擎类型 | 缩写 | 命名示例 |
| --- | --- | --- |
| `Button` | `btn` | `btn_close` |
| `CheckBox` | `chb` | `chb_music` |
| `Edit` | `edit` | `edit_chat` |
| `GridView` | `grid` | `grid_rewards` |
| `Layout` | `layout` | `layout_content` |
| `List` | `listv` | `listv_items` |
| `ListHorizontal` | `listh` | `listh_tabs` |
| `ProgressBar` | `pbar` | `pbar_exp` |
| `RadioButton` | `radio` | `radio_all` |
| `Slider` | `slider` | `slider_volume` |
| `StaticImage` | `img` | `img_background` |
| `StaticText` | 不设置 | 由 PSD 图层类型自动识别 |

## 识别规则

- 按完整缩写或下划线分隔的前缀识别，避免名称误匹配。
- `listh` 必须优先于 `listv` 及其他通用匹配规则。
- 有像素内容的叶子图层默认识别为 `StaticImage`。
- 无像素内容且可读取为文字的叶子图层默认识别为 `StaticText`。
- 未匹配到控件缩写的节点保持“未标记”。
- `listitem` 和 `li` 仅用于兼容旧 PSD/旧配置，导入后迁移为 `Layout`，不再作为可选控件类型。
- `scrollbar` 不再识别，也不再出现在控件类型列表中。

## 推荐缩写汇总

```text
btn  chb  edit  grid  layout  listv  listh  pbar  radio  slider  img
```
