"use client";
import { X, FolderOpen, LoaderCircle, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
export async function api(
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const r = await fetch("/api" + path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status });
  return data;
}
export const money = (n: unknown) =>
  Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
export const displayDate = (s: unknown) =>
  s
    ? new Date(String(s)).toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
        timeZone: "Asia/Bangkok",
      })
    : "—";
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} onCancel={onClose} className="modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="ปิดหน้าต่าง"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <FolderOpen size={28} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={24} />
      <span>กำลังโหลดข้อมูล…</span>
    </div>
  );
}
/** Password field with a show / hide toggle. */
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={show ? "text" : "password"} />
      <button
        type="button"
        className="password-toggle"
        aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={show}
        title={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );
}
