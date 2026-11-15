"use client";
// The first thing on บันทึกค่าใช้จ่าย and บันทึกรายรับ: drop a file once and AI fills the form, easier than typing.
// A large drop zone with the three steps; what AI read and the files attached show inside the same card.
import { useRef, useState, type ReactNode } from "react";
import { CloudUpload, FileCheck2, ScanText, Sparkles, Upload } from "lucide-react";

export function AiDropHero({
  title,
  subtitle,
  docs,
  accept,
  reading,
  disabled,
  onFiles,
  children,
}: {
  title: string;
  subtitle: string;
  /** Kinds of documents AI reads, shown as chips. */
  docs: string[];
  accept: string;
  /** "AI กำลังอ่าน …" while files are being read. */
  reading: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  /** What AI read and the attached files. */
  children?: ReactNode;
}) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const steps = [
    { icon: <Upload size={16} />, label: "แนบไฟล์" },
    { icon: <ScanText size={16} />, label: "AI อ่านและกรอกให้" },
    { icon: <FileCheck2 size={16} />, label: "ตรวจแล้วกดบันทึก" },
  ];
  return (
    <section className={"aih" + (reading ? " busy" : "")} aria-label="แนบไฟล์ให้ AI กรอกอัตโนมัติ">
      <div className="aih-intro">
        <span className="aih-badge">
          <Sparkles size={14} /> AI กรอกให้อัตโนมัติ
        </span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <ol className="aih-steps">
          {steps.map((s, i) => (
            <li key={s.label}>
              <i>{i + 1}</i>
              {s.icon}
              {s.label}
            </li>
          ))}
        </ol>
        <div className="aih-docs">
          {docs.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
      <label
        className={"aih-drop" + (drag ? " drag" : "") + (disabled ? " off" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) onFiles([...e.dataTransfer.files]);
        }}
      >
        <span className="aih-cloud">{reading ? <Sparkles size={34} /> : <CloudUpload size={34} />}</span>
        <b>{reading ? reading + "…" : drag ? "ปล่อยไฟล์ที่นี่ได้เลย" : "ลากไฟล์มาวาง หรือถ่ายรูปแล้วอัปโหลด"}</b>
        {!reading && (
          <span className="aih-btn" role="button" aria-disabled={disabled} onClick={(e) => (e.preventDefault(), !disabled && input.current?.click())}>
            <Upload size={17} /> เลือกไฟล์
          </span>
        )}
        <small>PDF, JPG, PNG ไม่เกิน 15MB · แนบได้หลายไฟล์พร้อมกัน</small>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={accept}
          disabled={disabled}
          onChange={(e) => {
            const list = [...(e.target.files || [])];
            e.target.value = "";
            onFiles(list);
          }}
        />
      </label>
      {children && <div className="aih-result">{children}</div>}
    </section>
  );
}
