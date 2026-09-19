import type { ComponentProps, ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  CircleHelp,
  createLucideIcon,
  Columns3,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FilePlus2,
  FolderOpen,
  Frame,
  Grid2X2,
  Grid3X3,
  Image,
  Keyboard,
  Layers3,
  Link2,
  List,
  LockKeyhole,
  Maximize2,
  Minus,
  Monitor,
  MousePointer2,
  MoveHorizontal,
  MoveDownLeft,
  MoveDownRight,
  MoveUpLeft,
  MoveUpRight,
  Palette,
  Pause,
  Plus,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  Search,
  Settings2,
  Sparkles,
  SquareMousePointer,
  SquareCheck,
  SquareDashed,
  Tags,
  TextCursorInput,
  Trash2,
  Type,
  UnlockKeyhole,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

const ProgressTrackIcon = createLucideIcon("ProgressTrack", [
  ["path", { d: "M4 12h16" }],
  ["path", { d: "M4 9v6M20 9v6" }],
  ["path", { d: "M4 12h10" }],
]);

const SliderTrackIcon = createLucideIcon("SliderTrack", [
  ["path", { d: "M4 12h16" }],
  ["path", { d: "M4 9v6M20 9v6" }],
  ["circle", { cx: "14", cy: "12", r: "2.5" }],
]);

/**
 * Figma SDS 的公开图标组件使用 16×16、1.6px、round line 作为基础规格。
 * 控件类型优先复用这些官方公开路径；没有一一对应的控件时，在同一规格上做最小补充。
 */
const FIGMA_CONTROL_PATHS: Partial<Record<IconName, ReactNode>> = {
  layout: <path d="M2 6H14M6 14V6M3.33333 2H12.6667C13.403 2 14 2.59695 14 3.33333V12.6667C14 13.403 13.403 14 12.6667 14H3.33333C2.59695 14 2 13.403 2 12.6667V3.33333C2 2.59695 2.59695 2 3.33333 2Z" />,
  "static-image": <path d="M3.33333 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V12.6667C2 13.403 2.59695 14 3.33333 14ZM3.33333 14L10.6667 6.66667L14 10M6.66667 5.66667C6.66667 6.21895 6.21895 6.66667 5.66667 6.66667C5.11438 6.66667 4.66667 6.21895 4.66667 5.66667C4.66667 5.11438 5.11438 4.66667 5.66667 4.66667C6.21895 4.66667 6.66667 5.11438 6.66667 5.66667Z" />,
  "static-text": <path d="M2.66663 4.66675V2.66675H13.3333V4.66675M5.99996 13.3334H9.99996M7.99996 2.66675V13.3334" />,
  checkbox: <path d="M6 7.33333L8 9.33333L14.6667 2.66667M14 8V12.6667C14 13.0203 13.8595 13.3594 13.6095 13.6095C13.3594 13.8594 13.0203 14 12.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V3.33333C2 2.97971 2.14048 2.64057 2.39052 2.39052C2.64057 2.14048 2.97971 2 3.33333 2H10.6667" />,
  progress: <><path d="M2.66667 8H13.3333" /><path d="M2.66667 5.33333V10.6667M13.3333 5.33333V10.6667" /><path d="M2.66667 8H8.66667" /></>,
  slider: <><path d="M2.66667 8H13.3333" /><circle cx="9.33333" cy="8" r="2" /></>,
  list: <path d="M5.33333 4H14M5.33333 8H14M5.33333 12H14M2 4H2.00667M2 8H2.00667M2 12H2.00667" />,
  "list-horizontal": <path d="M8 2H12.6667C13.0203 2 13.3595 2.14048 13.6095 2.39052C13.8595 2.64057 14 2.97971 14 3.33333V12.6667C14 13.0203 13.8595 13.3595 13.6095 13.6095C13.3595 13.8595 13.0203 14 12.6667 14H8M8 2H3.33333C2.97971 2 2.64048 2.14048 2.39043 2.39052C2.14038 2.64057 2 2.97971 2 3.33333V12.6667C2 13.0203 2.14048 13.3595 2.39052 13.6095C2.64057 13.8595 2.97971 14 3.33333 14H8M8 2V14" />,
  grid: <><path d="M6.66667 2H2V6.66667H6.66667V2Z" /><path d="M14 2H9.33333V6.66667H14V2Z" /><path d="M14 9.33333H9.33333V14H14V9.33333Z" /><path d="M6.66667 9.33333H2V14H6.66667V9.33333Z" /></>,
  empty: <path d="M12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V12.6667C2 13.403 2.59695 14 3.33333 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2Z" />,
  "name-toggle": <path d="M4.66671 4.66659H4.67337M13.7267 8.93992L8.94671 13.7199C8.82288 13.8439 8.67583 13.9422 8.51396 14.0093C8.3521 14.0764 8.17859 14.111 8.00337 14.111C7.82815 14.111 7.65465 14.0764 7.49279 14.0093C7.33092 13.9422 7.18387 13.8439 7.06004 13.7199L1.33337 7.99992V1.33325H8.00004L13.7267 7.05992C13.975 7.30974 14.1144 7.64767 14.1144 7.99992C14.1144 8.35217 13.975 8.6901 13.7267 8.93992Z" />,
  // Keep the two-arrow form, but give it a little breathing room so it reads
  // as a centered icon instead of touching the 16px viewBox edges.
  refresh: <g transform="translate(1.3333 1.3333) scale(0.8333)"><path d="M15.3333 2.66655V6.66655M15.3333 6.66655H11.3333M15.3333 6.66655L12.24 3.75989C11.5235 3.04303 10.637 2.51936 9.66342 2.23774C8.68979 1.95612 7.6607 1.92572 6.67215 2.14939C5.6836 2.37306 4.76783 2.84351 4.01027 3.51683C3.25271 4.19016 2.67807 5.04441 2.33996 5.99989M0.666626 13.3332V9.33322M0.666626 9.33322H4.66663M0.666626 9.33322L3.75996 12.2399C4.47646 12.9567 5.36287 13.4804 6.3365 13.762C7.31012 14.0437 8.33922 14.0741 9.32777 13.8504C10.3163 13.6267 11.2321 13.1563 11.9896 12.4829C12.7472 11.8096 13.3218 10.9554 13.66 9.99989" /></g>,
};

export type IconName =
  | "alert"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "back"
  | "binding"
  | "button"
  | "canvas"
  | "check"
  | "checkbox"
  | "circle"
  | "close"
  | "collapse"
  | "columns"
  | "device"
  | "download"
  | "edit"
  | "empty"
  | "expand"
  | "eye"
  | "eye-off"
  | "file-image"
  | "file-plus"
  | "folder-open"
  | "frame"
  | "grid"
  | "grid-slice"
  | "image"
  | "info"
  | "keyboard"
  | "layers"
  | "list"
  | "lock"
  | "minus"
  | "monitor"
  | "move-horizontal"
  | "move-down-left"
  | "move-down-right"
  | "move-up-left"
  | "move-up-right"
  | "palette"
  | "pause"
  | "plus"
  | "play"
  | "preview"
  | "redo"
  | "refresh"
  | "save"
  | "search"
  | "settings"
  | "slider"
  | "sparkles"
  | "static-text"
  | "text"
  | "trash"
  | "unlock"
  | "zoom-in"
  | "zoom-out"
  | "radio"
  | "progress"
  | "layout"
  | "list-horizontal"
  | "static-image"
  | "mouse"
  | "name-toggle";

const ICONS: Record<IconName, LucideIcon> = {
  alert: AlertTriangle,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  back: ChevronLeft,
  binding: Link2,
  button: SquareMousePointer,
  canvas: Scan,
  check: Check,
  checkbox: SquareCheck,
  circle: Circle,
  close: X,
  collapse: ChevronRight,
  columns: Columns3,
  device: Monitor,
  download: Download,
  edit: TextCursorInput,
  empty: SquareDashed,
  expand: ChevronDown,
  eye: Eye,
  "eye-off": EyeOff,
  "file-image": FileImage,
  "file-plus": FilePlus2,
  "folder-open": FolderOpen,
  frame: Frame,
  grid: Grid2X2,
  "grid-slice": Grid3X3,
  image: Image,
  info: CircleHelp,
  keyboard: Keyboard,
  layers: Layers3,
  list: List,
  lock: LockKeyhole,
  minus: Minus,
  monitor: Monitor,
  "move-horizontal": MoveHorizontal,
  "move-down-left": MoveDownLeft,
  "move-down-right": MoveDownRight,
  "move-up-left": MoveUpLeft,
  "move-up-right": MoveUpRight,
  palette: Palette,
  pause: Pause,
  plus: Plus,
  play: Play,
  preview: Maximize2,
  redo: Redo2,
  refresh: RotateCcw,
  save: Save,
  search: Search,
  settings: Settings2,
  slider: SliderTrackIcon,
  sparkles: Sparkles,
  "static-text": Type,
  text: Type,
  trash: Trash2,
  unlock: UnlockKeyhole,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  radio: CircleDot,
  progress: ProgressTrackIcon,
  layout: Frame,
  "list-horizontal": Columns3,
  "static-image": Image,
  mouse: MousePointer2,
  "name-toggle": Tags,
};

export type IconProps = Omit<ComponentProps<LucideIcon>, "name"> & { name: IconName };

/**
 * UI2HTML 的统一图标入口：默认 16px、1.75px 线宽、圆角端点。
 * 图标形状来自 Lucide（ISC），控件语义只在这里做映射，避免各组件自行画 glyph。
 */
export function Icon({ name, size = 16, strokeWidth = 1.75, ...props }: IconProps) {
  const figmaPath = FIGMA_CONTROL_PATHS[name];
  if (figmaPath) {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{figmaPath}</svg>;
  }
  const Component = ICONS[name];
  return <Component size={size} strokeWidth={strokeWidth} aria-hidden="true" {...props} />;
}

export function IconChevron({ open, ...props }: Omit<IconProps, "name"> & { open: boolean }) {
  return <Icon name={open ? "expand" : "collapse"} {...props} />;
}

export function iconNameForControl(type?: string): IconName {
  switch (type) {
    case "Layout": return "layout";
    case "StaticImage": return "static-image";
    case "StaticText": return "static-text";
    case "Button": return "button";
    case "CheckBox": return "checkbox";
    case "RadioButton": return "radio";
    case "ProgressBar": return "progress";
    case "Slider": return "slider";
    case "Edit": return "edit";
    case "List": return "list";
    case "ListHorizontal": return "list-horizontal";
    case "GridView": return "grid";
    default: return "empty";
  }
}
