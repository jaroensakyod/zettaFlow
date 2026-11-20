"use client";
// Place a new cover photo before saving: drag it inside the cover frame (and zoom), then save exactly what shows —
// the visible part is cut out of the photo, so every viewer sees the same framing.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Move, X, ZoomIn } from "lucide-react";

type Placed = { x: number; y: number; zoom: number };

export function CoverPositioner({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (cropped: File) => void }) {
  const frame = useRef<HTMLDivElement>(null),
    [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null),
    [box, setBox] = useState({ w: 0, h: 0 }),
    [at, setAt] = useState<Placed>({ x: 0, y: 0, zoom: 1 }),
    [busy, setBusy] = useState(false),
    drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file),
      im = new Image();
    im.onload = () => setImg({ url, w: im.naturalWidth, h: im.naturalHeight });
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The photo always covers the frame; zoom enlarges it from there.
  const base = img && box.w ? Math.max(box.w / img.w, box.h / img.h) : 1,
    scale = base * at.zoom,
    iw = img ? img.w * scale : 0,
    ih = img ? img.h * scale : 0;
  const clamp = (p: Placed, s = scale): Placed => {
    const w = img ? img.w * s : 0,
      h = img ? img.h * s : 0;
    return { ...p, x: Math.min(0, Math.max(box.w - w, p.x)), y: Math.min(0, Math.max(box.h - h, p.y)) };
  };
  // Start centred once the photo and the frame are known.
  useEffect(() => {
    if (img && box.w) setAt({ zoom: 1, x: (box.w - img.w * base) / 2, y: (box.h - img.h * base) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, box.w, box.h]);

  const down = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: at.x, y: at.y };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setAt((a) => clamp({ ...a, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const zoomTo = (z: number) =>
    setAt((a) => {
      // Keep the middle of the frame where it is while zooming.
      const s = base * z,
        cx = (box.w / 2 - a.x) / scale,
        cy = (box.h / 2 - a.y) / scale;
      return clamp({ zoom: z, x: box.w / 2 - cx * s, y: box.h / 2 - cy * s }, s);
    });
  const nudge = (dx: number, dy: number) => setAt((a) => clamp({ ...a, x: a.x + dx, y: a.y + dy }));

  const save = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const sx = -at.x / scale,
        sy = -at.y / scale,
        sw = box.w / scale,
        sh = box.h / scale,
        outW = Math.round(Math.min(2400, sw)),
        outH = Math.round((outW * box.h) / box.w),
        canvas = document.createElement("canvas"),
        bitmap = await createImageBitmap(file);
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw Error("จัดตำแหน่งรูปไม่สำเร็จ");
      onSave(new File([blob], "cover.jpg", { type: "image/jpeg" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="cover-pos"
      ref={frame}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const k = { ArrowLeft: [12, 0], ArrowRight: [-12, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] }[e.key];
        if (k) (e.preventDefault(), nudge(k[0], k[1]));
        if (e.key === "Escape") onCancel();
      }}
      tabIndex={0}
      role="application"
      aria-label="ลากเพื่อจัดตำแหน่งรูปปก"
    >
      {img && <img src={img.url} alt="" draggable={false} style={{ width: iw, height: ih, transform: `translate(${at.x}px, ${at.y}px)` }} />}
      <span className="cover-pos-hint">
        <Move size={15} /> ลากรูปเพื่อจัดตำแหน่ง
      </span>
      <div className="cover-pos-bar" onPointerDown={(e) => e.stopPropagation()}>
        <label className="cover-pos-zoom">
          <ZoomIn size={15} />
          <input type="range" min={1} max={3} step={0.01} value={at.zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="ซูมรูป" />
        </label>
        <button type="button" className="cover-pos-cancel" onClick={onCancel} disabled={busy}>
          <X size={15} /> ยกเลิก
        </button>
        <button type="button" className="cover-pos-save" onClick={save} disabled={busy || !img}>
          <Check size={15} /> {busy ? "กำลังบันทึก…" : "บันทึกรูปปก"}
        </button>
      </div>
    </div>
  );
}
