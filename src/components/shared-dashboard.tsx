"use client";
import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { displayDate, Loading, PasswordInput } from "./shared";
import { WidgetView } from "./platform";
import type { Widget } from "@/lib/platform";
type Result = {
  needsPassword: boolean;
  wrong?: boolean;
  label: string;
  company: string;
  expires_at?: string;
  widgets?: Widget[];
};
/** Read-only dashboard opened through a share link (optional password, expiry). */
export function SharedDashboard({ token }: { token: string }) {
  const [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const open = useCallback(
    async (password = "") => {
      setBusy(true);
      try {
        const r = await fetch("/api/public-share/" + encodeURIComponent(token), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
          cache: "no-store",
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [token],
  );
  useEffect(() => {
    open();
  }, [open]);
  return (
    <div className="share-page">
      <main>
        {error ? (
          <section className="z-card">
            <h1>ไม่สามารถเปิด Dashboard</h1>
            <p>{error}</p>
          </section>
        ) : !data ? (
          <Loading />
        ) : data.needsPassword ? (
          <section className="z-card">
            <h1>
              <Lock size={18} /> {data.company} · {data.label || "Shared Dashboard"}
            </h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                open(String(new FormData(e.currentTarget).get("password")));
              }}
            >
              <label>
                รหัสผ่าน
                <PasswordInput name="password" autoFocus required />
              </label>
              {data.wrong && <p className="form-error">รหัสผ่านไม่ถูกต้อง</p>}
              <button className="primary" disabled={busy}>
                เปิด Dashboard
              </button>
            </form>
          </section>
        ) : (
          <>
            <header className="section-actions">
              <div>
                <h1>{data.company}</h1>
                <small>
                  {data.label} · มุมมองอ่านอย่างเดียว · ลิงก์หมดอายุ {displayDate(data.expires_at)}
                </small>
              </div>
              <small>ZettaFlow AI</small>
            </header>
            <div className="widget-board">
              {data.widgets?.map((w) => (
                <article className="widget-card" key={w.key}>
                  <WidgetView w={w} />
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
