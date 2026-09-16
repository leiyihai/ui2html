import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DeviceShell } from "../devicePreview";
import { deviceMockupMetrics } from "../deviceMockups";

interface Props {
  deviceShell: DeviceShell;
  showDeviceShell: boolean;
  portrait: boolean;
  children: ReactNode;
}

/**
 * 预览样机只负责包裹画布：移动端壳用纯 CSS 绘制机身（比例见 deviceMockups），
 * 桌面 / 平板壳沿用基础边框样式。开关变化时保持 canvas DOM 不变，避免丢失绘制内容。
 */
export default function PreviewDeviceFrame({ deviceShell, showDeviceShell, portrait, children }: Props) {
  const screenRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const target = screen.querySelector<HTMLElement>(".canvas-stack") ?? screen.querySelector<HTMLElement>("canvas");
    if (!target) return;
    const sync = () => {
      const width = target.offsetWidth;
      const height = target.offsetHeight;
      if (!width || !height) return;
      setCanvasSize((previous) => previous && previous.width === width && previous.height === height
        ? previous
        : { width, height });
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(target);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [deviceShell]);

  const metrics = canvasSize ? deviceMockupMetrics(deviceShell, canvasSize.width, canvasSize.height) : null;
  const cutoutVars: Record<string, string> = metrics?.cutout
    ? {
      "--cutout-w": `${metrics.cutout.width}px`,
      "--cutout-h": `${metrics.cutout.height}px`,
      "--cutout-radius": `${metrics.cutout.radius}px`,
      "--cutout-offset": `${metrics.cutout.offsetTop}px`,
      "--cutout-right": `${metrics.cutout.offsetRight ?? 0}px`,
      "--cutout-ear": `${metrics.cutout.ear}px`,
    }
    : {};
  const frameStyle: CSSProperties | undefined = metrics
    ? {
      "--mockup-bezel-x": `${metrics.bezelX}px`,
      "--mockup-bezel-y": `${metrics.bezelY}px`,
      "--mockup-radius-outer": `${metrics.outerRadius}px`,
      "--mockup-radius-screen": `${metrics.screenRadius}px`,
      "--mockup-unit": `${metrics.unit}px`,
      ...cutoutVars,
    } as CSSProperties
    : undefined;

  return (
    <div className={`preview-device-mockup preview-device-mockup-${deviceShell}${portrait ? " portrait" : " landscape"}${showDeviceShell ? "" : " is-hidden"}`} style={frameStyle}>
      <div className="preview-device-screen" ref={screenRef}>{children}</div>
      <span className="preview-device-cutout" aria-hidden="true"><span className="preview-device-cutout-inner" aria-hidden="true" /></span>
      <span className="preview-device-home-indicator" aria-hidden="true" />
      <span className="preview-device-button preview-device-button-action" aria-hidden="true" />
      <span className="preview-device-button preview-device-button-volume-up" aria-hidden="true" />
      <span className="preview-device-button preview-device-button-volume-down" aria-hidden="true" />
      <span className="preview-device-button preview-device-button-power" aria-hidden="true" />
    </div>
  );
}
