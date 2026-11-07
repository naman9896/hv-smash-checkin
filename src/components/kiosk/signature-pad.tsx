"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SignaturePadHandle {
  /** The signature as a PNG data URL (transparent background), or null when empty. */
  toDataURL: () => string | null;
  clear: () => void;
}

type Point = { x: number; y: number };

/**
 * Finger / Apple Pencil / mouse signature box.
 * Strokes are kept as points (in CSS pixels) so a resize or rotation redraws them instead of losing them.
 */
export function SignaturePad({
  ref,
  id,
  invalid,
  describedBy,
  onChange,
}: {
  ref?: React.Ref<SignaturePadHandle>;
  id: string;
  invalid?: boolean;
  describedBy?: string;
  /** Called with true once something is drawn, false after clearing. */
  onChange?: (hasInk: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const paint = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#111111";
    for (const s of strokes.current) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y + 0.1); // a dot
      for (let i = 1; i < s.length; i++) {
        // Smooth with quadratic curves through the midpoints
        const mid = { x: (s[i - 1].x + s[i].x) / 2, y: (s[i - 1].y + s[i].y) / 2 };
        ctx.quadraticCurveTo(s[i - 1].x, s[i - 1].y, mid.x, mid.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx, dpr);
  }, [paint]);

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  const setInk = useCallback(
    (v: boolean) => {
      setHasInk(v);
      onChange?.(v);
    },
    [onChange],
  );

  const clear = useCallback(() => {
    strokes.current = [];
    redraw();
    setInk(false);
  }, [redraw, setInk]);

  useImperativeHandle(
    ref,
    () => ({
      clear,
      toDataURL: () => {
        const canvas = canvasRef.current;
        if (!canvas || !strokes.current.some((s) => s.length)) return null;
        // Export at 2x CSS size whatever the screen density: sharp enough to print, small to upload
        const { width, height } = canvas.getBoundingClientRect();
        const out = document.createElement("canvas");
        out.width = Math.round(width * 2);
        out.height = Math.round(height * 2);
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        paint(ctx, 2);
        return out.toDataURL("image/png");
      },
    }),
    [clear, paint],
  );

  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  return (
    <div>
      <div
        className={cn(
          "relative overflow-hidden rounded-[14px] border-2 border-dashed bg-white transition-colors",
          invalid ? "border-danger bg-red-50/40" : "border-line focus-within:border-primary",
        )}
      >
        <canvas
          ref={canvasRef}
          id={id}
          tabIndex={0}
          role="img"
          aria-label={hasInk ? "Signature box, signed" : "Signature box, sign here with your finger"}
          aria-describedby={describedBy}
          className="block h-52 w-full cursor-crosshair touch-none select-none focus-visible:outline-none sm:h-56"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            strokes.current.push([point(e)]);
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const s = strokes.current[strokes.current.length - 1];
            // Coalesced events give a smoother line on iPad / Apple Pencil
            const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
            const r = e.currentTarget.getBoundingClientRect();
            for (const ev of events) s.push({ x: ev.clientX - r.left, y: ev.clientY - r.top });
            redraw();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            if (!hasInk) setInk(true);
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[17px] text-slate-400">
            Sign here with your finger
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-slate-300" aria-hidden="true" />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-[15px] font-semibold text-muted hover:bg-slate-100 hover:text-ink disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" /> Clear signature
        </button>
      </div>
    </div>
  );
}
