import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachPenBarrelEraser } from "./penBarrelEraser";

const PEN_ID = 7;

const pointer = (
  type: string,
  init: PointerEventInit & { pointerType?: string } = {},
) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: PEN_ID,
    pointerType: "pen",
    ...init,
  });

const barrelDown = (init: PointerEventInit = {}) =>
  pointer("pointerdown", { button: 2, buttons: 2, pressure: 0, ...init });

describe("attachPenBarrelEraser", () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let state: { activeTool: any; viewModeEnabled: boolean };
  let api: { getAppState: () => typeof state; setActiveTool: any };
  // What Excalidraw's canvas handlers would see, with the tool at that moment.
  let received: Array<{ type: string; button: number; buttons: number; tool: string }>;
  let contextMenus: number;
  let detach: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    canvas = document.createElement("canvas");
    container.appendChild(canvas);
    document.body.appendChild(container);
    state = { activeTool: { type: "freedraw" }, viewModeEnabled: false };
    api = {
      getAppState: () => state,
      setActiveTool: vi.fn((tool) => {
        state.activeTool = tool;
      }),
    };
    received = [];
    contextMenus = 0;
    for (const type of ["pointerdown", "pointerup"]) {
      canvas.addEventListener(type, (event) => {
        const { button, buttons } = event as PointerEvent;
        received.push({ type, button, buttons, tool: state.activeTool.type });
      });
    }
    canvas.addEventListener("contextmenu", () => {
      contextMenus += 1;
    });
    detach = attachPenBarrelEraser(container, () => api);
  });

  afterEach(() => {
    detach();
    container.remove();
  });

  it("leaves mouse right-clicks alone", () => {
    canvas.dispatchEvent(barrelDown({ pointerType: "mouse" } as any));
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(menu);

    expect(api.setActiveTool).not.toHaveBeenCalled();
    expect(received).toEqual([
      { type: "pointerdown", button: 2, buttons: 2, tool: "freedraw" },
    ]);
    expect(contextMenus).toBe(1);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("switches to the eraser while held and suppresses the context menu", () => {
    canvas.dispatchEvent(barrelDown());
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(menu);

    expect(api.setActiveTool).toHaveBeenCalledWith({ type: "eraser" });
    expect(received).toEqual([]);
    expect(contextMenus).toBe(0);
    expect(menu.defaultPrevented).toBe(true);

    canvas.dispatchEvent(pointer("pointerup", { button: 2, buttons: 0 }));
    expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "freedraw" });
  });

  it("erases only while the tip touches, then restores the tool", () => {
    canvas.dispatchEvent(barrelDown());
    canvas.dispatchEvent(pointer("pointermove", { buttons: 3, pressure: 0.6 }));
    canvas.dispatchEvent(pointer("pointermove", { buttons: 3, pressure: 0.7 }));
    canvas.dispatchEvent(pointer("pointermove", { buttons: 2, pressure: 0 }));
    canvas.dispatchEvent(pointer("pointermove", { buttons: 3, pressure: 0.4 }));
    canvas.dispatchEvent(pointer("pointerup", { button: 2, buttons: 0 }));

    expect(received).toEqual([
      { type: "pointerdown", button: 0, buttons: 1, tool: "eraser" },
      { type: "pointerup", button: 0, buttons: 0, tool: "eraser" },
      { type: "pointerdown", button: 0, buttons: 1, tool: "eraser" },
      // The synthetic stroke end lands before the tool is restored.
      { type: "pointerup", button: 0, buttons: 0, tool: "eraser" },
      { type: "pointerup", button: 2, buttons: 0, tool: "freedraw" },
    ]);
    expect(state.activeTool).toEqual({ type: "freedraw" });
  });

  it("starts erasing at once when the press arrives with tip contact", () => {
    canvas.dispatchEvent(barrelDown({ pressure: 0.8 }));

    expect(received).toEqual([
      { type: "pointerdown", button: 0, buttons: 1, tool: "eraser" },
    ]);
  });

  it("ignores placeholder pressure from devices without pressure sensing", () => {
    canvas.dispatchEvent(barrelDown({ pressure: 0.5 }));
    canvas.dispatchEvent(pointer("pointermove", { buttons: 2, pressure: 0.5 }));

    expect(received).toEqual([]);
  });

  it("does nothing in view mode", () => {
    state.viewModeEnabled = true;
    canvas.dispatchEvent(barrelDown());

    expect(api.setActiveTool).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
  });

  it("keeps a tool the user picked mid-hold", () => {
    canvas.dispatchEvent(barrelDown());
    state.activeTool = { type: "rectangle" };
    canvas.dispatchEvent(pointer("pointerup", { button: 2, buttons: 0 }));

    expect(api.setActiveTool).toHaveBeenCalledTimes(1);
    expect(state.activeTool).toEqual({ type: "rectangle" });
  });

  it("restores the previous tool if the window loses focus mid-hold", () => {
    canvas.dispatchEvent(barrelDown());
    window.dispatchEvent(new Event("blur"));

    expect(state.activeTool).toEqual({ type: "freedraw" });
  });

  it("stops intercepting once detached", () => {
    detach();
    canvas.dispatchEvent(barrelDown());

    expect(api.setActiveTool).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
  });
});
