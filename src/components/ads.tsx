"use client";
// ลงโฆษณา: write a sponsored card, see it live as other companies will, pick how long, pay with coins,
// then follow views and clicks of every ad the company bought.
import { useCallback, useEffect, useState } from "react";
import { Coins, Eye, Megaphone, MousePointerClick, Pause, Play, Plus } from "lucide-react";
import { api, Empty, Loading } from "./shared";
import { AdCard } from "./ad-card";
import { businessTypeGroups } from "@/lib/catalog";
import type { AdPackage, AdTone, FeedAd, MyAd } from "@/lib/ads";
import type { Context } from "@/lib/types";

type Studio = { packages: AdPackage[]; ads: MyAd[]; balance: number; posts: { id: string; title: string }[] };
const tones: [AdTone, string][] = [
  ["violet", "ม่วง"],
  ["pink", "ชมพู"],
  ["blue", "ฟ้า"],
  ["green", "เขียว"],
];
const day = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });

export function AdStudio({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const [studio, setStudio] = useState<Studio | null>(null),
    [draft, setDraft] = useState({ title: "", body: "", cta_label: "ดูรายละเอียด", cta_url: "", tone: "violet" as AdTone, target_industry: "", post_id: "" }),
    [pkg, setPkg] = useState("d7"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const owner = ctx.member.role === "owner";
  const load = useCallback(() => api("/ads").then(setStudio).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const chosen = studio?.packages.find((p) => p.id === pkg);
  const enough = !!chosen && (studio?.balance ?? 0) >= chosen.coins;
  const preview: FeedAd = {
    id: "preview",
    ...draft,
    company: ctx.company.name,
    company_id: ctx.company.id,
    has_logo: !!ctx.company.profile.logo,
    industry: String(ctx.company.profile.industry || ""),
  };

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    if (!confirm(`ซื้อโฆษณา ${chosen.name} ใช้ ${chosen.coins} เหรียญ?`)) return;
    setBusy(true);
    setError("");
    try {
      await api("/ads", { method: "POST", body: { ...draft, post_id: draft.post_id || null, package: pkg } });
      notify("ลงโฆษณาแล้ว บริษัทอื่นจะเห็นในเครือข่ายธุรกิจทันที");
      setDraft((d) => ({ ...d, title: "", body: "" }));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(a: MyAd) {
    try {
      await api("/ads/" + a.id, { method: "PATCH", body: { status: a.status === "active" ? "paused" : "active" } });
      notify(a.status === "active" ? "หยุดแสดงโฆษณาชั่วคราวแล้ว" : "แสดงโฆษณาต่อแล้ว");
      load();
    } catch (err) {
      notify((err as Error).message);
    }
  }

  if (!studio) return error ? <p className="form-error">{error}</p> : <Loading />;
  return (
    <div className="ads">
      <section className="card ads-intro">
        <Megaphone size={22} />
        <div>
          <h2>ลงโฆษณาในเครือข่ายธุรกิจ</h2>
          <p>
            การ์ด “ผู้สนับสนุน” จะแสดงในหน้าเครือข่ายธุรกิจของบริษัทอื่น ทั้งในฟีดและแถบด้านขวา บริษัทประเภทธุรกิจที่คุณเลือกจะเห็นก่อน
            <a href="/feed/preview" target="_blank" rel="noreferrer">
              {" "}
              ดูตัวอย่างหน้าเครือข่าย →
            </a>
          </p>
        </div>
        <span className="ads-balance">
          <Coins size={16} /> {studio.balance.toLocaleString("th-TH")} เหรียญ
          <button className="text-button" onClick={() => navigate("store")}>
            เติม
          </button>
        </span>
      </section>

      <div className="ads-grid">
        <form className="card ads-form" onSubmit={buy}>
          <h3>1. ข้อความโฆษณา</h3>
          <label>
            หัวข้อ
            <input value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={120} required placeholder="เช่น รับออกแบบบูธงานแฟร์ ครบจบในที่เดียว" />
          </label>
          <label>
            รายละเอียด
            <textarea value={draft.body} onChange={(e) => set("body", e.target.value)} maxLength={500} rows={3} placeholder="จุดเด่น ราคา หรือโปรโมชันสั้น ๆ" />
          </label>
          <div className="form-grid">
            <label>
              ข้อความปุ่ม
              <input value={draft.cta_label} onChange={(e) => set("cta_label", e.target.value)} maxLength={40} placeholder="ทักเลย / ดูผลงาน" />
            </label>
            <label>
              ลิงก์ของปุ่ม (https://)
              <input value={draft.cta_url} onChange={(e) => set("cta_url", e.target.value)} maxLength={300} placeholder="https://line.me/… หรือเว็บไซต์" />
            </label>
          </div>
          <div className="ads-tones" role="radiogroup" aria-label="สีการ์ด">
            {tones.map(([t, l]) => (
              <label key={t} className={"ads-tone " + t + (draft.tone === t ? " on" : "")}>
                <input type="radio" name="tone" checked={draft.tone === t} onChange={() => set("tone", t)} /> {l}
              </label>
            ))}
          </div>
          {studio.posts.length > 0 && (
            <label>
              เชื่อมกับโพสต์ของบริษัท (ไม่บังคับ)
              <select value={draft.post_id} onChange={(e) => set("post_id", e.target.value)}>
                <option value="">— ไม่เชื่อม —</option>
                {studio.posts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <h3>2. กลุ่มเป้าหมาย</h3>
          <label>
            ให้บริษัทประเภทนี้เห็นก่อน (ไม่บังคับ)
            <select value={draft.target_industry} onChange={(e) => set("target_industry", e.target.value)}>
              <option value="">ทุกประเภทธุรกิจ</option>
              {businessTypeGroups.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <h3>3. ระยะเวลา</h3>
          <div className="ads-packages" role="radiogroup" aria-label="แพ็กเกจโฆษณา">
            {studio.packages.map((p) => (
              <label key={p.id} className={"ads-package" + (pkg === p.id ? " on" : "")}>
                <input type="radio" name="package" checked={pkg === p.id} onChange={() => setPkg(p.id)} />
                <b>{p.name}</b>
                <span>
                  <Coins size={14} /> {p.coins} เหรียญ
                </span>
                <small>≈ {Math.round(p.coins / p.days)} เหรียญ/วัน</small>
              </label>
            ))}
          </div>
          {error && <p className="form-error">{error}</p>}
          {!owner ? (
            <p className="note">เฉพาะเจ้าของบริษัทซื้อโฆษณาได้</p>
          ) : !enough ? (
            <button type="button" className="primary full" onClick={() => navigate("store")}>
              <Coins size={15} /> เหรียญไม่พอ เติมเหรียญ ({chosen?.coins} เหรียญ)
            </button>
          ) : (
            <button className="primary full" disabled={busy || !draft.title.trim()}>
              <Plus size={15} /> ลงโฆษณา {chosen?.name} · {chosen?.coins} เหรียญ
            </button>
          )}
        </form>

        <aside className="ads-preview">
          <h3>ตัวอย่างที่บริษัทอื่นจะเห็น</h3>
          <small>ในฟีด (แทรกทุก 5 โพสต์)</small>
          <AdCard ad={preview} preview />
          <small>แถบด้านขวา</small>
          <div className="ads-preview-side">
            <AdCard ad={preview} compact preview />
          </div>
        </aside>
      </div>

      <section className="card ads-mine">
        <h3>โฆษณาของฉัน</h3>
        {!studio.ads.length ? (
          <Empty title="ยังไม่มีโฆษณา" description="ลงโฆษณาแรกด้านบน แล้วดูจำนวนบริษัทที่เห็นและกดได้ที่นี่" />
        ) : (
          <ul>
            {studio.ads.map((a) => {
              const ended = Date.parse(a.ends_at) <= Date.now();
              return (
                <li key={a.id}>
                  <span>
                    <b>{a.title}</b>
                    <small>
                      {a.package} · {a.coins} เหรียญ · {day(a.starts_at)} – {day(a.ends_at)}
                      {a.target_industry ? " · เป้าหมาย: " + a.target_industry : ""}
                    </small>
                  </span>
                  <span className="ads-stats">
                    <span title="บริษัทที่เห็น (นับวันละครั้งต่อบริษัท)">
                      <Eye size={14} /> {a.views}
                    </span>
                    <span title="บริษัทที่กดปุ่ม">
                      <MousePointerClick size={14} /> {a.clicks}
                    </span>
                  </span>
                  <em className={ended ? "muted" : a.status === "active" ? "done" : "wait"}>{ended ? "หมดเวลา" : a.status === "active" ? "กำลังแสดง" : "หยุดชั่วคราว"}</em>
                  {!ended && (
                    <button className="icon-button" aria-label={a.status === "active" ? "หยุดชั่วคราว" : "แสดงต่อ"} onClick={() => toggle(a)}>
                      {a.status === "active" ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
