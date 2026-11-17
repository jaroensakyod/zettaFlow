"use client";
// ตั้งค่า › ข้อมูลบริษัท › เอกสาร: the company stamp and the people who sign documents. Each signer has a name,
// a position and a signature (drawn here with a finger / mouse, or uploaded). One is the usual issuer and one the
// usual approver; with auto-signing on, their signatures and the stamp go on quotations, invoices and receipts.
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, Eraser, ImageUp, PenLine, Plus, Stamp, Trash2, UserRound, X } from "lucide-react";
import { MAX_PHOTO, MAX_SIGN, MAX_SIGNERS, MAX_STAMP, parseSigners, type Signer } from "@/lib/signers";

/** Positions offered as one-tap chips on each signer card (plus any typed for another signer). */
const POSITIONS = ["กรรมการผู้จัดการ", "CEO", "กรรมการ", "ผู้จัดการทั่วไป", "ผู้จัดการฝ่ายขาย", "ผู้จัดการฝ่ายบัญชี", "ผู้จัดการฝ่ายการเงิน", "หัวหน้าฝ่ายจัดซื้อ"];

/** Scales an image or a drawn canvas down and keeps transparency (WebP, else PNG) within `max` characters. */
async function toImage(src: File | HTMLCanvasElement, box: number, max: number) {
  const bitmap = src instanceof File ? await createImageBitmap(src) : src;
  const scale = Math.min(1, box / bitmap.width, box / bitmap.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  for (const q of [0.9, 0.75, 0.6, 0.45]) {
    const url = c.toDataURL("image/webp", q);
    if (url.startsWith("data:image/webp") && url.length <= max) return url;
  }
  const png = c.toDataURL("image/png");
  if (png.length <= max) return png;
  throw Error("รูปใหญ่เกินไป ลองใช้รูปที่เล็กลง");
}
/** A drawn signature without the empty margin around it. */
function trimmed(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 8, out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function DocSigners({
  values,
  set,
  disabled,
}: {
  values: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  disabled?: boolean;
}) {
  const text = (k: string) => String(values[k] ?? "");
  const signers = parseSigners(values.signers);
  const [drawing, setDrawing] = useState<string | null>(null),
    [error, setError] = useState("");
  // First time: people already typed as issuer / approver become signers (no signature yet).
  useEffect(() => {
    if (signers.length || !(text("signerName") || text("approverName"))) return;
    const seed: Signer[] = [];
    if (text("signerName")) seed.push({ id: "s" + Date.now(), name: text("signerName"), position: text("signerPosition"), sign: "" });
    if (text("approverName") && text("approverName") !== text("signerName"))
      seed.push({ id: "a" + Date.now(), name: text("approverName"), position: text("approverPosition"), sign: "" });
    set("signers", JSON.stringify(seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const same = (a: string, b: string) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "") && !!a.trim();
  const issuer = signers.find((s) => same(s.name, text("signerName")));
  const approver = signers.find((s) => same(s.name, text("approverName")));
  const auto = text("autoSign") !== "0";

  function save(list: Signer[], renamed?: { from: Signer; to: Signer }) {
    set("signers", JSON.stringify(list));
    // Keep the issuer / approver lines in step when that person's name or position changes.
    if (renamed && issuer?.id === renamed.from.id) (set("signerName", renamed.to.name), set("signerPosition", renamed.to.position));
    if (renamed && approver?.id === renamed.from.id) (set("approverName", renamed.to.name), set("approverPosition", renamed.to.position));
  }
  const update = (id: string, patch: Partial<Signer>) => {
    const from = signers.find((s) => s.id === id)!;
    const to = { ...from, ...patch };
    save(signers.map((s) => (s.id === id ? to : s)), { from, to });
  };
  const choose = (role: "signer" | "approver", s: Signer) => {
    set(role + "Name", s.name);
    set(role + "Position", s.position);
  };
  async function pickImage(file: File | undefined, apply: (url: string) => void, box: number, max: number) {
    if (!file) return;
    setError("");
    try {
      apply(await toImage(file, box, max));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="dsg">
      {/* ตราประทับ */}
      <div className="dsg-stamp">
        <div className={"dsg-stamp-box" + (text("stamp") ? "" : " empty")}>
          {text("stamp") ? <img src={text("stamp")} alt="ตราประทับบริษัท" /> : <Stamp size={34} />}
        </div>
        <div className="dsg-stamp-text">
          <b>ตราประทับบริษัท</b>
          <p>รูปตรายางพื้นหลังโปร่งใส (PNG) จะดูสวยที่สุด ระบบประทับให้ตรงช่องผู้อนุมัติบนเอกสาร</p>
          <div className="dsg-row">
            <label className={"dsg-btn" + (disabled ? " off" : "")}>
              <ImageUp size={15} /> {text("stamp") ? "เปลี่ยนรูปตรา" : "อัปโหลดตราประทับ"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled} onChange={(e) => (pickImage(e.target.files?.[0], (u) => set("stamp", u), 500, MAX_STAMP), (e.target.value = ""))} />
            </label>
            {text("stamp") && (
              <button type="button" className="dsg-btn ghost" disabled={disabled} onClick={() => set("stamp", "")}>
                <Trash2 size={15} /> เอาออก
              </button>
            )}
          </div>
        </div>
        <label className={"dsg-auto" + (auto ? " on" : "")}>
          <input type="checkbox" checked={auto} disabled={disabled} onChange={(e) => set("autoSign", e.target.checked ? "1" : "0")} />
          <i />
          <span>
            <b>เซ็นออนไลน์อัตโนมัติ</b>
            <small>ใส่ลายเซ็นและตราประทับบนใบเสนอราคา ใบแจ้งหนี้ ใบกำกับภาษี และใบเสร็จให้เลย</small>
          </span>
        </label>
      </div>

      {/* ผู้ลงนาม */}
      <div className="dsg-list">
        {signers.map((s) => (
          <article key={s.id} className={"dsg-card" + (issuer?.id === s.id || approver?.id === s.id ? " chosen" : "")}>
            <header>
              <label className={"dsg-avatar" + (s.photo ? " has" : "") + (disabled ? " off" : "")} title={s.photo ? "เปลี่ยนรูป" : "ใส่รูป"}>
                {s.photo ? <img src={s.photo} alt={"รูป " + s.name} /> : <UserRound size={24} />}
                <i aria-hidden>
                  <Camera size={12} />
                </i>
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled} aria-label={"ใส่รูป " + (s.name || "ผู้ลงนาม")} onChange={(e) => (pickImage(e.target.files?.[0], (u) => update(s.id, { photo: u }), 160, MAX_PHOTO), (e.target.value = ""))} />
              </label>
              <div className="dsg-fields">
                <input aria-label="ชื่อผู้ลงนาม" placeholder="ชื่อ-นามสกุล" maxLength={100} value={s.name} disabled={disabled} onChange={(e) => update(s.id, { name: e.target.value })} />
                <input aria-label="ตำแหน่ง" placeholder="พิมพ์ตำแหน่ง หรือแตะเลือกด้านล่าง" maxLength={100} value={s.position} disabled={disabled} onChange={(e) => update(s.id, { position: e.target.value })} />
              </div>
              <button type="button" className="dsg-icon" aria-label={"ลบ " + (s.name || "ผู้ลงนาม")} disabled={disabled} onClick={() => save(signers.filter((x) => x.id !== s.id))}>
                <Trash2 size={16} />
              </button>
            </header>
            <div className="dsg-pos" aria-label="เลือกตำแหน่ง">
              {[...new Set([...POSITIONS, ...signers.map((x) => x.position.trim()).filter(Boolean)])].map((p) => (
                <button key={p} type="button" className={s.position.trim() === p ? "on" : ""} disabled={disabled} onClick={() => update(s.id, { position: p })}>
                  {p}
                </button>
              ))}
              <button type="button" className="add" disabled={disabled} onClick={(e) => (e.currentTarget.closest(".dsg-card")?.querySelector<HTMLInputElement>("input[aria-label='ตำแหน่ง']")?.focus(), update(s.id, { position: "" }))}>
                <Plus size={12} /> ตำแหน่งอื่น
              </button>
            </div>
            {s.photo && (
              <button type="button" className="dsg-photo-x" disabled={disabled} onClick={() => update(s.id, { photo: "" })}>
                <X size={12} /> เอารูปออก
              </button>
            )}
            <div className={"dsg-sign" + (s.sign ? "" : " empty")}>
              {s.sign ? <img src={s.sign} alt={"ลายเซ็น " + s.name} /> : <span>ยังไม่มีลายเซ็น</span>}
            </div>
            <div className="dsg-row">
              <button type="button" className="dsg-btn" disabled={disabled} onClick={() => setDrawing(s.id)}>
                <PenLine size={15} /> {s.sign ? "เซ็นใหม่" : "เซ็นบนจอ"}
              </button>
              <label className={"dsg-btn ghost" + (disabled ? " off" : "")}>
                <ImageUp size={15} /> อัปโหลดรูป
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled} onChange={(e) => (pickImage(e.target.files?.[0], (u) => update(s.id, { sign: u }), 600, MAX_SIGN), (e.target.value = ""))} />
              </label>
              {s.sign && (
                <button type="button" className="dsg-btn ghost" disabled={disabled} onClick={() => update(s.id, { sign: "" })}>
                  <Eraser size={15} /> ลบลายเซ็น
                </button>
              )}
            </div>
            <footer>
              <button type="button" className={"dsg-role" + (issuer?.id === s.id ? " on violet" : "")} disabled={disabled || !s.name.trim()} onClick={() => choose("signer", s)}>
                {issuer?.id === s.id && <BadgeCheck size={14} />} ผู้ออกเอกสาร
              </button>
              <button type="button" className={"dsg-role" + (approver?.id === s.id ? " on green" : "")} disabled={disabled || !s.name.trim()} onClick={() => choose("approver", s)}>
                {approver?.id === s.id && <BadgeCheck size={14} />} ผู้อนุมัติ
              </button>
            </footer>
          </article>
        ))}
        {signers.length < MAX_SIGNERS && (
          <button
            type="button"
            className="dsg-add"
            disabled={disabled}
            onClick={() => save([...signers, { id: "p" + Date.now(), name: "ผู้ลงนามใหม่", position: "", sign: "", photo: "" }])}
          >
            <Plus size={22} />
            <b>เพิ่มผู้ลงนาม</b>
            <small>เช่น กรรมการ ผู้จัดการฝ่ายขาย ผู้จัดการฝ่ายบัญชี</small>
          </button>
        )}
      </div>
      <p className="dsg-hint">
        กด <b>ผู้ออกเอกสาร</b> และ <b>ผู้อนุมัติ</b> ที่การ์ดของคนที่ลงนามเป็นประจำ ชื่อ ตำแหน่ง และลายเซ็นจะขึ้นในช่องลงนามของเอกสารให้เอง
        {!issuer && signers.length > 0 && " · ยังไม่ได้เลือกผู้ออกเอกสาร"}
        {!approver && signers.length > 0 && " · ยังไม่ได้เลือกผู้อนุมัติ"}
      </p>
      {error && <p className="form-error">{error}</p>}
      {drawing && (
        <SignPad
          name={signers.find((s) => s.id === drawing)?.name || ""}
          onClose={() => setDrawing(null)}
          onDone={(url) => (update(drawing, { sign: url }), setDrawing(null))}
        />
      )}
    </div>
  );
}

/** Draw a signature with a finger, pen or mouse. */
function SignPad({ name, onClose, onDone }: { name: string; onClose: () => void; onDone: (url: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null),
    last = useRef<{ x: number; y: number } | null>(null),
    [empty, setEmpty] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = 2.6;
    g.strokeStyle = "#1e2a78";
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div className="dsg-modal" role="dialog" aria-modal="true" aria-label="เซ็นชื่อ" onClick={onClose}>
      <div className="dsg-modal-box" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>
            <PenLine size={18} /> เซ็นชื่อ{name ? " · " + name : ""}
          </b>
          <button type="button" className="dsg-icon" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <canvas
          ref={ref}
          className="dsg-pad"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            last.current = at(e);
            const g = e.currentTarget.getContext("2d")!;
            g.beginPath();
            g.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
            g.fillStyle = "#1e2a78";
            g.fill();
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!last.current) return;
            const p = at(e), g = e.currentTarget.getContext("2d")!;
            g.beginPath();
            g.moveTo(last.current.x, last.current.y);
            g.lineTo(p.x, p.y);
            g.stroke();
            last.current = p;
          }}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
        <p className="dsg-pad-hint">เซ็นในกรอบด้านบนด้วยนิ้วหรือเมาส์</p>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button
            type="button"
            className="dsg-btn ghost"
            onClick={() => {
              const c = ref.current!;
              c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
              setEmpty(true);
            }}
          >
            <Eraser size={15} /> ล้าง
          </button>
          <button
            type="button"
            className="dsg-btn"
            disabled={empty}
            onClick={async () => {
              const t = trimmed(ref.current!);
              if (!t) return;
              try {
                onDone(await toImage(t, 600, MAX_SIGN));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <BadgeCheck size={15} /> ใช้ลายเซ็นนี้
          </button>
        </footer>
      </div>
    </div>
  );
}
