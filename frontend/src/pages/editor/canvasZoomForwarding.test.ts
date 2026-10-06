import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCanvasZoomForwarding } from "./canvasZoomForwarding";

type WheelInit = WheelEventInit & {
  wheelDeltaX?: number;
  wheelDeltaY?: number;
  timeStamp?: number;
};

// jsdom lacks the legacy wheelDelta fields and fixes timeStamp at creation.
const wheel = ({ wheelDeltaX, wheelDeltaY, timeStamp = 1000, ...init }: WheelInit) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  Object.defineProperties(event, {
    wheelDeltaX: { value: wheelDeltaX },
    wheelDeltaY: { value: wheelDeltaY },
    timeStamp: { value: timeStamp },
  });
  return event;
};

describe("attachCanvasZoomForwarding", () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  // What Excalidraw's wheel handler would see.
  let received: Array<{ ctrlKey: boolean; deltaX: number; deltaY: number }>;
  let detach: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    canvas = document.createElement("canvas");
    container.appendChild(canvas);
    document.body.appendChild(container);
    received = [];
    canvas.addEventListener("wheel", (event) => {
      const { ctrlKey, deltaX, deltaY } = event as WheelEvent;
      received.push({ ctrlKey, deltaX, deltaY });
    });
    detach = attachCanvasZoomForwarding(container);
  });

  afterEach(() => {
    detach();
    container.remove();
  });

  it("turns a mouse wheel notch into a zoom", () => {
    const event = wheel({ deltaY: 100, wheelDeltaY: -120 });
    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(received).toEqual([{ ctrlKey: true, deltaX: 0, deltaY: 100 }]);
  });

  it("zooms on line-mode wheels, converting lines to pixels", () => {
    canvas.dispatchEvent(
      wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }),
    );

    expect(received).toEqual([{ ctrlKey: true, deltaX: 0, deltaY: 48 }]);
  });

  it("lets touchpad two-finger scrolls through so they pan", () => {
    const vertical = wheel({ deltaY: 7.5, wheelDeltaY: -9 });
    const diagonal = wheel({ deltaX: 4, deltaY: -2, wheelDeltaX: -5, wheelDeltaY: 2 });
    canvas.dispatchEvent(vertical);
    canvas.dispatchEvent(diagonal);

    expect(vertical.defaultPrevented).toBe(false);
    expect(received).toEqual([
      { ctrlKey: false, deltaX: 0, deltaY: 7.5 },
      { ctrlKey: false, deltaX: 4, deltaY: -2 },
    ]);
  });

  it("keeps a touchpad stream panning until it goes quiet", () => {
    canvas.dispatchEvent(wheel({ deltaY: 7.5, wheelDeltaY: -9, timeStamp: 1000 }));
    // Looks like a notch, but arrives mid-stream.
    canvas.dispatchEvent(wheel({ deltaY: 100, wheelDeltaY: -120, timeStamp: 1050 }));
    // A real notch after the stream has ended.
    canvas.dispatchEvent(wheel({ deltaY: 100, wheelDeltaY: -120, timeStamp: 1400 }));

    expect(received.map((event) => event.ctrlKey)).toEqual([false, false, true]);
  });

  it("leaves pinch-zoom (ctrl+wheel) to Excalidraw", () => {
    const pinch = wheel({ deltaY: 3.2, wheelDeltaY: -4, ctrlKey: true });
    canvas.dispatchEvent(pinch);

    expect(pinch.defaultPrevented).toBe(false);
    expect(received).toEqual([{ ctrlKey: true, deltaX: 0, deltaY: 3.2 }]);
  });
});
