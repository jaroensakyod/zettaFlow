"use client";
import { useState } from "react";
import {
  ArrowRight,
  Layers,
  ShieldCheck,
  Workflow,
  Package,
  Users,
} from "lucide-react";
import { api } from "./shared";
export function Auth({
  demo,
  configured,
  onLogin,
  product = "elite",
}: {
  demo: boolean;
  configured: boolean;
  onLogin: () => void;
  product?: "elite" | "zetta";
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login"),
    [error, setError] = useState(() =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("auth_error")
        ? "ลิงก์ยืนยันหรือรีเซ็ตรหัสผ่านไม่สำเร็จ กรุณาเข้าสู่ระบบหรือขอลิงก์ใหม่"
        : "",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const result = await api("/auth", {
        method: "POST",
        body: {
          action: mode,
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name"),
        },
      });
      if (result.verify)
        setMessage("สร้างบัญชีแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ");
      else if (mode === "reset") setMessage(result.message);
      else onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Layers size={24} />
          </span>
          {product === "zetta" ? <>Zetta<span>Flow AI</span></> : <>Elite<span>Flow</span></>}
        </div>
        <div className="auth-eyebrow">{product === "zetta" ? "AI THAT MOVES YOUR BUSINESS FORWARD" : "YOUR BUSINESS. ONE WORKSPACE."}</div>
        <h1>
          จัดการทุกงาน
          <br />
          ให้ทีมเดินหน้า
          <br />
          <em>ไปด้วยกัน</em>
        </h1>
        <p>
          ลูกค้า โครงการ บุคลากร และคลังสินค้า
          <br />
          เชื่อมข้อมูลธุรกิจไว้ในพื้นที่เดียว
        </p>
        <div className="auth-features">
          <span>
            <Users size={16} />
            ทีม & สิทธิ์
          </span>
          <span>
            <Package size={16} />
            สต็อก & จัดซื้อ
          </span>
          <span>
            <Workflow size={16} />
            Workflow & AI
          </span>
        </div>
        <div className="auth-bottom">
          <ShieldCheck size={16} />
          จัดการสิทธิ์ผู้ใช้และแยกข้อมูลแต่ละบริษัท
        </div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <span className="eyebrow">WELCOME TO {product === "zetta" ? "ZETTAFLOW AI" : "ELITEFLOW"}</span>
          <h2>
            {mode === "register"
              ? "สร้างบัญชีของคุณ"
              : mode === "reset"
                ? "ตั้งรหัสผ่านใหม่"
                : "กลับมาทำงานด้วยกัน"}
          </h2>
          <p className="muted">
            {mode === "register"
              ? "เริ่มต้น workspace สำหรับธุรกิจของคุณ"
              : mode === "reset"
                ? "รับลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล"
                : "เข้าสู่ระบบเพื่อดูภาพรวมและงานของทีม"}
          </p>
          {mode === "register" && (
            <label>
              ชื่อ-นามสกุล
              <input name="name" autoComplete="name" required />
            </label>
          )}
          <label>
            อีเมล
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {mode !== "reset" && (
            <label>
              รหัสผ่าน
              <input
                name="password"
                type="password"
                minLength={mode === "register" ? 10 : 1}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && <p className="form-success">{message}</p>}
          <button
            className="primary full"
            disabled={busy || !configured}
            type="submit"
          >
            {busy
              ? "กำลังดำเนินการ…"
              : mode === "register"
                ? "สร้างบัญชี"
                : mode === "reset"
                  ? "ส่งลิงก์ทางอีเมล"
                  : "เข้าสู่ workspace"}
            <ArrowRight size={16} />
          </button>
          <div className="auth-links">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setMessage("");
                setError("");
              }}
            >
              {mode === "register"
                ? "มีบัญชีแล้ว? เข้าสู่ระบบ"
                : "สร้างบัญชีใหม่"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setMode(mode === "reset" ? "login" : "reset")}
            >
              {mode === "reset" ? "เข้าสู่ระบบ" : "ลืมรหัสผ่าน"}
            </button>
          </div>
          {demo && (
            <button className="demo-entry full" type="button" onClick={onLogin}>
              เปิด workspace ตัวอย่าง →
            </button>
          )}
          {!configured && (
            <div className="note">
              {demo
                ? "โหมดตัวอย่างบนเครื่อง · ข้อมูลธุรกิจทั้งหมดเป็นข้อมูลทดสอบ"
                : "ตั้งค่า Supabase environment variables และรัน SQL migrations เพื่อเริ่มใช้งาน"}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="onboarding">
      <div className="onboard-card">
        <span className="brand-mark">
          <Layers />
        </span>
        <h1>สร้าง workspace ของบริษัท</h1>
        <p className="muted">
          ถ้ามีคำเชิญ ระบบจะเชื่อมบริษัทให้โดยใช้อีเมลเดียวกัน
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/onboarding", {
                method: "POST",
                body: { name: new FormData(e.currentTarget).get("name") },
              });
              onComplete();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            ชื่อบริษัท
            <input name="name" required maxLength={200} />
          </label>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button className="primary full" disabled={busy}>
            สร้างบริษัท →
          </button>
        </form>
      </div>
    </div>
  );
}
export function ResetPassword() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="onboarding">
      <form
        className="onboard-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/auth", {
              method: "POST",
              body: {
                action: "password",
                password: new FormData(e.currentTarget).get("password"),
              },
            });
            setMessage("เปลี่ยนรหัสผ่านแล้ว กลับไปเข้าสู่ระบบได้");
          } catch (err) {
            setMessage((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>ตั้งรหัสผ่านใหม่</h1>
        <label>
          รหัสผ่านใหม่
          <input
            type="password"
            name="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </label>
        <p role="status">{message}</p>
        <button className="primary full" disabled={busy}>
          บันทึกรหัสผ่าน
        </button>
        <a href="/">กลับไป EliteFlow</a>
      </form>
    </div>
  );
}
