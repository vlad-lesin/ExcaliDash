/**
 * Excalidraw zooms on ctrl/cmd+wheel and pans on plain wheel. This project
 * inverts that on the canvas so a plain mouse wheel zooms: intercept plain
 * wheel events over the canvas (not the editor UI chrome) and re-dispatch them
 * as synthetic ctrl+wheel. Touchpad two-finger scrolls pass through untouched
 * so they keep panning (pinch-zoom already arrives as ctrl+wheel). Returns a
 * cleanup that detaches the listener.
 */

// Browsers don't say which device sent a wheel event, so guess: mouse wheels
// move in whole notches (Firefox reports lines, Chromium multiples of 120 in
// the legacy wheelDelta fields); touchpads send arbitrary pixel deltas.
const NOTCH = 120;
// Touchpad scrolls (momentum included) arrive as a continuous stream; once one
// is recognised, keep that stream panning even if a delta looks like a notch.
const TOUCHPAD_STREAM_GAP_MS = 200;
const PIXELS_PER_LINE = 16;

const looksLikeMouseWheel = (event: WheelEvent) => {
  // Must run before any delta is read: Firefox only reports line mode to a
  // listener that checks deltaMode first.
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return true;
  const { wheelDeltaX = 0, wheelDeltaY = 0 } = event as any;
  return (
    (wheelDeltaX !== 0 || wheelDeltaY !== 0) &&
    wheelDeltaX % NOTCH === 0 &&
    wheelDeltaY % NOTCH === 0
  );
};

// Excalidraw sizes zoom steps by pixel deltas, so convert line/page deltas.
const toPixels = (delta: number, deltaMode: number) => {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * PIXELS_PER_LINE;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * window.innerHeight;
  return delta;
};

export const attachCanvasZoomForwarding = (
  container: HTMLElement | null,
): (() => void) => {
  if (!container) return () => {};
  let touchpadStreamUntil = 0;
  const handleWheel = (event: WheelEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const isCanvas = target.tagName?.toLowerCase() === "canvas";
    const isEditorUi =
      target.closest(".layer-ui__wrapper") !== null ||
      target.closest(".App-menu") !== null;
    if (
      isCanvas &&
      !isEditorUi &&
      !event.ctrlKey &&
      !event.metaKey &&
      !(event as any)._isFakeZoom
    ) {
      if (
        event.timeStamp < touchpadStreamUntil ||
        !looksLikeMouseWheel(event)
      ) {
        touchpadStreamUntil = event.timeStamp + TOUCHPAD_STREAM_GAP_MS;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const zoomEvent = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        deltaX: toPixels(event.deltaX, event.deltaMode),
        deltaY: toPixels(event.deltaY, event.deltaMode),
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        ctrlKey: true,
      });
      (zoomEvent as any)._isFakeZoom = true;
      target.dispatchEvent(zoomEvent);
    }
  };
  container.addEventListener("wheel", handleWheel, {
    capture: true,
    passive: false,
  });
  return () =>
    container.removeEventListener("wheel", handleWheel, { capture: true });
};
