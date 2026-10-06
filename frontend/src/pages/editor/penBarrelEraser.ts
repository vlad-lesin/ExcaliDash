import { flushSync } from "react-dom";

/**
 * Excalidraw erases with a pen's eraser end, but the first barrel button
 * arrives as a right-click (button 2) and opens the canvas context menu.
 * Remap it: pressing the barrel button over the canvas switches to the eraser,
 * the tip erases while it touches, and releasing the button restores the
 * previous tool. Mouse right-clicks are untouched. Returns a cleanup that
 * detaches the listeners.
 *
 * With the barrel held, tip contact is a chorded pointermove (no new
 * pointerdown), so erase strokes are started/ended here with synthetic events.
 */
const BARREL_BUTTON = 2;
const TIP_BIT = 1;
const BARREL_BIT = 2;
// Spec placeholder pressure for "pressed, but no pressure hardware".
const UNKNOWN_PRESSURE = 0.5;
const SYNTHETIC = "_isPenBarrelEraser";

type Hold = {
  pointerId: number;
  canvas: HTMLElement;
  previousTool: any | null;
  erasing: boolean;
};

const isCanvasTarget = (target: EventTarget | null): target is HTMLElement => {
  const element = target as HTMLElement | null;
  return (
    element?.tagName?.toLowerCase() === "canvas" &&
    element.closest(".layer-ui__wrapper") === null &&
    element.closest(".App-menu") === null
  );
};

// Tip contact sets buttons bit 0; some platforms report barrel+tip as a plain
// right-button press, so real (non-placeholder) pressure also counts.
const isTipDown = (event: PointerEvent) =>
  (event.buttons & TIP_BIT) !== 0 ||
  (event.pressure > 0 && event.pressure !== UNKNOWN_PRESSURE);

// Restoring the image tool would reopen the file picker.
const toToolArg = (tool: any) =>
  tool.type === "custom"
    ? { type: "custom", customType: tool.customType }
    : { type: tool.type === "image" ? "selection" : tool.type };

const forward = (
  type: "pointerdown" | "pointerup",
  source: PointerEvent,
  canvas: HTMLElement,
) => {
  const pressing = type === "pointerdown";
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: source.pointerId,
    pointerType: "pen",
    isPrimary: source.isPrimary,
    clientX: source.clientX,
    clientY: source.clientY,
    screenX: source.screenX,
    screenY: source.screenY,
    pressure: pressing ? source.pressure : 0,
    tiltX: source.tiltX,
    tiltY: source.tiltY,
    button: 0,
    buttons: pressing ? TIP_BIT : 0,
    altKey: source.altKey,
    ctrlKey: source.ctrlKey,
    metaKey: source.metaKey,
    shiftKey: source.shiftKey,
  });
  (event as any)[SYNTHETIC] = true;
  canvas.dispatchEvent(event);
};

export const attachPenBarrelEraser = (
  container: HTMLElement | null,
  getApi: () => any,
): (() => void) => {
  if (!container) return () => {};
  let hold: Hold | null = null;
  let suppressContextMenu = false;

  const startErasing = (event: PointerEvent) => {
    if (!hold || hold.erasing || event.target !== hold.canvas) return;
    if (getApi()?.getAppState?.().activeTool?.type !== "eraser") return;
    hold.erasing = true;
    forward("pointerdown", event, hold.canvas);
  };

  const stopErasing = (event: PointerEvent) => {
    if (!hold?.erasing) return;
    hold.erasing = false;
    forward("pointerup", event, hold.canvas);
    // A synthetic pointerup doesn't drop the capture Excalidraw took.
    if (hold.canvas.hasPointerCapture?.(hold.pointerId)) {
      hold.canvas.releasePointerCapture(hold.pointerId);
    }
  };

  const dropHold = (event?: PointerEvent) => {
    if (!hold) return null;
    if (event) stopErasing(event);
    const { previousTool } = hold;
    hold = null;
    window.removeEventListener("pointermove", handleHoldPointer, true);
    window.removeEventListener("pointerup", handleHoldPointer, true);
    window.removeEventListener("pointercancel", handleHoldPointer, true);
    window.removeEventListener("blur", handleBlur);
    return previousTool;
  };

  const endHold = (event?: PointerEvent) => {
    const previousTool = dropHold(event);
    const api = getApi();
    // Leave the tool alone if the user picked another one mid-hold.
    if (previousTool && api?.getAppState?.().activeTool?.type === "eraser") {
      api.setActiveTool(toToolArg(previousTool));
    }
  };

  const handleHoldPointer = (event: PointerEvent) => {
    if (!hold || event.pointerId !== hold.pointerId) return;
    if ((event as any)[SYNTHETIC]) return;
    if ((event.buttons & BARREL_BIT) === 0) {
      endHold(event);
    } else if (isTipDown(event)) {
      startErasing(event);
    } else {
      stopErasing(event);
    }
  };

  const handleBlur = () => endHold();

  const handlePointerDown = (event: PointerEvent) => {
    if ((event as any)[SYNTHETIC]) return;
    suppressContextMenu = false;
    if (
      event.pointerType !== "pen" ||
      event.button !== BARREL_BUTTON ||
      !isCanvasTarget(event.target)
    ) {
      return;
    }
    const api = getApi();
    const appState = api?.getAppState?.();
    if (!appState || appState.viewModeEnabled) return;
    if (typeof api.setActiveTool !== "function") return;
    event.preventDefault();
    event.stopPropagation();
    suppressContextMenu = true;
    const activeTool = appState.activeTool;
    // A hold whose release was missed keeps the tool it should restore.
    const previousTool = hold
      ? dropHold(event)
      : activeTool?.type === "eraser"
        ? null
        : activeTool;
    hold = {
      pointerId: event.pointerId,
      canvas: event.target,
      previousTool,
      erasing: false,
    };
    if (activeTool?.type !== "eraser") {
      // Commit the switch now so a stroke started below already erases.
      flushSync(() => api.setActiveTool({ type: "eraser" }));
    }
    window.addEventListener("pointermove", handleHoldPointer, true);
    window.addEventListener("pointerup", handleHoldPointer, true);
    window.addEventListener("pointercancel", handleHoldPointer, true);
    window.addEventListener("blur", handleBlur);
    if (isTipDown(event)) startErasing(event);
  };

  const handleContextMenu = (event: MouseEvent) => {
    if (!suppressContextMenu) return;
    suppressContextMenu = false;
    event.preventDefault();
    event.stopPropagation();
  };

  container.addEventListener("pointerdown", handlePointerDown, true);
  container.addEventListener("contextmenu", handleContextMenu, true);
  return () => {
    endHold();
    container.removeEventListener("pointerdown", handlePointerDown, true);
    container.removeEventListener("contextmenu", handleContextMenu, true);
  };
};
