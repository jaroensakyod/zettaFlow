"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Layers,
  ShieldCheck,
  Workflow,
  Package,
  Users,
} from "lucide-react";
import { api, PasswordInput } from "./shared";
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
  // "ทดลองฟรี" on the public pages links here with ?signup=1 to open the sign-up form.
  const [mode, setMode] = useState<"login" | "register" | "reset">(() =>
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("signup")
        ? "register"
        : "login",
    ),
    [error, setError] = useState(() =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("auth_error")
        ? "ลิงก์ยืนยันหรือรีเซ็ตรหัสผ่านไม่สำเร็จ กรุณาเข้าสู่ระบบหรือขอลิงก์ใหม่"
        : "",
    ),
    [message, setMessage] = useState(() =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("password_changed")
        ? "เปลี่ยนรหัสผ่านแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย"
        : "",
    ),
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
      if (result.verify) {
        // Sign-up done: switch straight to the login form (email stays filled in).
        setMode("login");
        setMessage("สร้างบัญชีแล้ว กรุณากดยืนยันในอีเมล แล้วเข้าสู่ระบบที่นี่");
      }
      else if (mode === "reset") setMessage(result.message);
      else onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout future">
      {/* Futuristic backdrop: aurora, starfield, a neon grid floor and a scanning line (decoration only). */}
      <div className="fx" aria-hidden>
        <i className="fx-aurora a1" />
        <i className="fx-aurora a2" />
        <i className="fx-aurora a3" />
        <i className="fx-stars s1" />
        <i className="fx-stars s2" />
        <i className="fx-grid" />
        <i className="fx-scan" />
      </div>
      <section className="auth-story">
        <div className="fx-holo" aria-hidden>
          <i className="ring r1" />
          <i className="ring r2" />
          <i className="ring r3" />
          <i className="core" />
          <i className="dot d1" />
          <i className="dot d2" />
          <i className="dot d3" />
        </div>
        <div className="brand">
          {product === "zetta" ? (
            <span className="brand-mark">
              <Layers size={24} />
            </span>
          ) : (
            <img className="auth-logo" src="/brand/eliteflow-mark.png" alt="" width={40} height={40} />
          )}
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
        <form onSubmit={submit} className="auth-card">
          <div className="auth-status" aria-hidden>
            <span className="pulse" /> SYSTEM ONLINE <b>·</b> SECURE CONNECTION
          </div>
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
              <PasswordInput
                name="password"
                minLength={mode === "register" ? 7 : 1}
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
        <img className="auth-logo" src="/brand/eliteflow-mark.png" alt="EliteFlow" width={56} height={56} />
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
/** Ask for a fresh reset link (used when a link expired or was already used). */
function NewResetLink({ note }: { note: string }) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="onboard-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api("/auth", { method: "POST", body: { action: "reset", email: new FormData(e.currentTarget).get("email") } });
          setMessage(r.message + " กดลิงก์จากอีเมลล่าสุดเท่านั้น");
        } catch (err) {
          setMessage((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>ลิงก์ใช้ไม่ได้แล้ว</h1>
      <p className="muted">{note}</p>
      <label>
        อีเมลของบัญชี
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <p role="status">{message}</p>
      <button className="primary full" disabled={busy}>
        ส่งลิงก์ตั้งรหัสผ่านใหม่
      </button>
      <a href="/workspace/dashboard">ไปหน้าเข้าสู่ระบบ</a>
    </form>
  );
}
const expiredNote =
  "ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว (ลิงก์ใช้ได้ครั้งเดียว ภายใน 1 ชั่วโมง และถ้ากดขอหลายครั้งจะใช้ได้เฉพาะอีเมลล่าสุด) กรอกอีเมลเพื่อรับลิงก์ใหม่";
export function ResetPassword() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [expired, setExpired] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("expired")) setExpired(true);
  }, []);
  if (expired)
    return (
      <div className="onboarding">
        <NewResetLink note={expiredNote} />
      </div>
    );
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
            // End the recovery session so the user signs in with the new password.
            await api("/auth", { method: "POST", body: { action: "logout" } }).catch(() => {});
            setMessage("เปลี่ยนรหัสผ่านแล้ว กำลังไปหน้าเข้าสู่ระบบ…");
            window.location.assign("/workspace/dashboard?password_changed=1");
            return;
          } catch (err) {
            const text = (err as Error).message;
            // No recovery session (opened /reset-password directly or the session ended): ask for a new link.
            if (/session|เข้าสู่ระบบ|JWT|401/i.test(text)) setExpired(true);
            else setMessage(text);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>ตั้งรหัสผ่านใหม่</h1>
        <label>
          รหัสผ่านใหม่
          <PasswordInput
            name="password"
            required
            minLength={7}
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

/** /auth/confirm?token_hash=…&type=…: the email link opens this page; the token is used only when the person presses the button. */
export function ConfirmLink() {
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(""),
    [type, setType] = useState("");
  useEffect(() => {
    setType(new URLSearchParams(location.search).get("type") || "");
  }, []);
  if (failed) return <div className="onboarding"><NewResetLink note={failed} /></div>;
  return (
    <div className="onboarding">
      <div className="onboard-card">
        <h1>{type === "recovery" ? "ตั้งรหัสผ่านใหม่" : "ยืนยันอีเมล"}</h1>
        <p className="muted">กดปุ่มด้านล่างเพื่อดำเนินการต่อ</p>
        <button
          className="primary full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const q = new URLSearchParams(location.search);
            try {
              const r = await api("/auth", { method: "POST", body: { action: "verify", token_hash: q.get("token_hash"), type: q.get("type") } });
              window.location.assign(r.next);
            } catch (err) {
              setFailed((err as Error).message === "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้เลย" ? expiredNote : (err as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "กำลังตรวจสอบ…" : type === "recovery" ? "ไปตั้งรหัสผ่านใหม่" : "ยืนยันอีเมล"}
        </button>
      </div>
    </div>
  );
}
