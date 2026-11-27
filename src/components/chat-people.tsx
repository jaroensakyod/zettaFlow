"use client";
// B2B chat: who sent each message (their picture, name and company) and the pictures and files a message carries.
import { useEffect, useRef, useState } from "react";
import { Camera, FileArchive, ImageIcon, FileSpreadsheet, FileText, Paperclip, Trash2, X } from "lucide-react";
import type { B2bFile } from "@/lib/b2b";
import { api } from "./shared";
import { CompanyLogo } from "./feed";

const palette = ["#7c3aed", "#db2777", "#0891b2", "#059669", "#d97706", "#4f46e5", "#dc2626", "#0d9488"];
const colorOf = (s: string) => palette[[...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % palette.length];
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0] || "")
    .join("")
    .toUpperCase() || "?";

/** A person's picture (or their initials) with their company's logo on its corner. */
export function PersonAvatar({
  userId,
  at,
  name,
  company,
  size = 36,
}: {
  userId?: string | null;
  at?: string | null;
  name: string;
  company?: { id: string; name: string; has_logo: boolean; logo_url?: string } | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const photo = userId && at && !broken ? `/api/avatar/${userId}?v=${encodeURIComponent(at)}` : null;
  return (
    <span className="person-avatar" style={{ width: size, height: size }} title={company ? `${name} · ${company.name}` : name}>
      {photo ? (
        <img src={photo} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="person-initials" style={{ background: colorOf(userId || name), fontSize: Math.round(size * 0.38) }}>
          {initials(name)}
        </span>
      )}
      {company && (
        <span className="person-company">
          <CompanyLogo id={company.id} name={company.name} logo={company.logo_url || company.has_logo} size={Math.max(14, Math.round(size * 0.44))} />
        </span>
      )}
    </span>
  );
}

/** Square-crop and shrink a picture to a 256 px WebP in the browser. */
export async function toAvatar(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height),
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("แปลงรูปไม่สำเร็จ"))), "image/webp", 0.85));
}

/** The signed-in person's own picture, which every company they chat with sees next to their messages. */
export function MyAvatar({ userId, name, company, demo, notify }: { userId: string; name: string; company: { id: string; name: string; has_logo: boolean }; demo: boolean; notify: (s: string) => void }) {
  const [at, setAt] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!demo)
      api("/avatar")
        .then((r: { avatar_at: string | null }) => setAt(r.avatar_at))
        .catch(() => {});
  }, [demo]);
  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", await toAvatar(file), "avatar.webp");
      const res = await fetch("/api/avatar", { method: "POST", body: form }),
        r: { avatar_at: string | null; error?: string } = await res.json();
      if (!res.ok) throw new Error(r.error || "ตั้งรูปไม่สำเร็จ");
      setAt(r.avatar_at);
      notify("ตั้งรูปโปรไฟล์แล้ว บริษัทที่คุยด้วยจะเห็นรูปนี้ข้างข้อความของคุณ");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="my-avatar">
      <button type="button" className="my-avatar-pick" disabled={busy || demo} onClick={() => input.current?.click()} title={demo ? "โหมดตัวอย่างตั้งรูปไม่ได้" : "เปลี่ยนรูปโปรไฟล์"}>
        <PersonAvatar userId={userId} at={at} name={name} company={company} size={34} />
        <i>
          <Camera size={11} />
        </i>
      </button>
      <span>
        <b>{name}</b>
        <small>{at ? "รูปโปรไฟล์ของคุณ" : "ตั้งรูปโปรไฟล์ให้คู่ค้าเห็น"}</small>
      </span>
      {at && !demo && (
        <button
          type="button"
          className="icon-button"
          aria-label="ลบรูปโปรไฟล์"
          disabled={busy}
          onClick={() =>
            api("/avatar", { method: "DELETE" })
              .then(() => setAt(null))
              .catch((e) => notify((e as Error).message))
          }
        >
          <Trash2 size={14} />
        </button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

export const isImage = (mime: string) => mime.startsWith("image/");
export const fileSize = (n: number) => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");
const FileIcon = ({ mime }: { mime: string }) =>
  mime.includes("sheet") || mime === "text/csv" ? <FileSpreadsheet size={18} /> : mime === "application/zip" ? <FileArchive size={18} /> : <FileText size={18} />;
const fileUrl = (thread: string, f: B2bFile, download = false) => `/api/b2b/${thread}/file/${f.path.split("/").pop()}${download ? "?name=" + encodeURIComponent(f.name) : ""}`;

/** Pictures as thumbnails, other files as rows to download. */
export function MessageFiles({ thread, files }: { thread: string; files: B2bFile[] }) {
  const pics = files.filter((f) => isImage(f.mime)),
    docs = files.filter((f) => !isImage(f.mime));
  return (
    <div className="b2b-files">
      {pics.length > 0 && (
        <div className={"b2b-pics n" + Math.min(pics.length, 3)}>
          {pics.map((f) => (
            <a key={f.path} href={fileUrl(thread, f)} target="_blank" rel="noreferrer" title={f.name}>
              <img src={fileUrl(thread, f)} alt={f.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {docs.map((f) => (
        <a key={f.path} className="b2b-doc" href={fileUrl(thread, f, true)} target="_blank" rel="noreferrer">
          <FileIcon mime={f.mime} />
          <span>
            <b>{f.name}</b>
            <small>{fileSize(f.size)}</small>
          </span>
        </a>
      ))}
    </div>
  );
}

export const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.xlsx,.docx,.pptx,.zip";
/** The paperclip in the compose box and the files waiting to be sent. */
/** Pick files for a message; `images` opens the picker on pictures only (the photo library on a phone). */
export function AttachButton({ disabled, onPick, images }: { disabled?: boolean; onPick: (files: File[]) => void; images?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="b2b-attach"
        aria-label={images ? "ส่งรูปภาพ" : "แนบไฟล์"}
        title={images ? "ส่งรูปภาพ (ไม่เกิน 10 MB ต่อรูป)" : "แนบไฟล์ PDF, Excel, Word หรือรูป (ไม่เกิน 10 MB ต่อไฟล์)"}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {images ? <ImageIcon size={18} /> : <Paperclip size={18} />}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={images ? ".png,.jpg,.jpeg,.webp" : ACCEPT}
        hidden
        onChange={(e) => {
          onPick([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="b2b-pending-files">
      {files.map((f, i) => (
        <span key={f.name + i}>
          {isImage(f.type) ? <img src={URL.createObjectURL(f)} alt="" /> : <FileIcon mime={f.type} />}
          <em>{f.name}</em>
          <small>{fileSize(f.size)}</small>
          <button type="button" aria-label={"เอา " + f.name + " ออก"} onClick={() => onRemove(i)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
