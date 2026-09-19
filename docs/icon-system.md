# UI2HTML 图标系统

编辑器内的功能图标统一通过 `ui-editor/src/components/Icon.tsx` 输出。默认规格为：

- 16px 基准尺寸；
- 1.75px 线宽；
- 圆角端点和连接；
- 单色 `currentColor`，颜色由所在控件的状态控制；
- 控件类型和工作区语义只保留在中央映射中，不再在组件里写 Unicode 字符图标。

## 素材来源

控件类型图标直接采用 Figma 官方 `figma/sds` 仓库公开的图标路径（MIT）；没有一一对应的控件时，在相同的 16×16、1.6px、round line 规格上做最小补充。其他编辑器操作图标继续使用 Lucide 开源图标作为 fallback（ISC）。项目不依赖 Figma Community 资源文件，因此不会把仅限 Figma 平台使用的社区资源重新分发到应用中。

参考：

- [Figma Open Source Libraries](https://www.figma.com/open-source/)
- [Figma Simple Design System（图标源码）](https://github.com/figma/sds/tree/main/src/ui/icons)
- [Figma Learn：icon-styling workflow（示例使用 Lucide）](https://help.figma.com/hc/en-us/articles/41159704839831-AI-workflows-collection-Build-your-own-plugins-inside-Figma-Design)
- [Lucide source repository](https://github.com/lucide-icons/lucide)

## 控件类型映射

| 控件类型 | 图标语义 |
| --- | --- |
| 布局 | Frame |
| 静态图片 | Image |
| 静态文本 | Type |
| 按钮 | SquareMousePointer |
| 复选框 | SquareCheck |
| 单选框 | CircleDot |
| 进度条 | ProgressTrack（同滑动条轨道，无滑块头） |
| 滑动条 | SliderTrack（同轨道，带滑块头） |
| 输入框 | RectangleEllipsis |
| 列表 / 横向列表 | List / Columns3 |
| 网格 | Grid2X2 |
| 空节点 | SquareDashed |

没有一一对应的控件图标时，使用同一套 16px 线性图标补充，不再回退到 `▦`、`◉`、`＋` 等字体字符，避免不同系统字体导致视觉和尺寸不一致。

层级工具栏的“切换工程名称 / PSD 原名”使用 `Tags`，表达名称标签切换，不再使用容易误解为图片资源的文件图标。
