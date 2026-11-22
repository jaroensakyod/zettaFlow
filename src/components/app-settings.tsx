"use client";
// ตั้งค่า (from the account menu): the user's own preferences. Language first — EliteFlow is to support several
// languages; the choice is kept on this device and set as the page language. More settings join this page later.
import { useEffect, useState } from "react";
import { Bell, Check, Globe2, Languages, Palette } from "lucide-react";

export const LANG_KEY = "ef-lang";
export const languages = [
  { id: "th", name: "ภาษาไทย", native: "ไทย", flag: "🇹🇭", ready: true },
  { id: "en", name: "English", native: "English", flag: "🇬🇧", ready: false },
  { id: "zh", name: "中文", native: "Chinese", flag: "🇨🇳", ready: false },
  { id: "ja", name: "日本語", native: "Japanese", flag: "🇯🇵", ready: false },
  { id: "lo", name: "ພາສາລາວ", native: "Lao", flag: "🇱🇦", ready: false },
  { id: "my", name: "မြန်မာ", native: "Myanmar", flag: "🇲🇲", ready: false },
] as const;
export type LangId = (typeof languages)[number]["id"];

/** The language chosen on this device (ไทย when none or storage is blocked). */
export function savedLang(): LangId {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (languages.some((l) => l.id === v)) return v as LangId;
  } catch {}
  return "th";
}

export function AppSettings({ notify }: { notify: (s: string) => void }) {
  const [lang, setLang] = useState<LangId>("th");
  useEffect(() => setLang(savedLang()), []);
  const pick = (id: LangId) => {
    setLang(id);
    try {
      localStorage.setItem(LANG_KEY, id);
    } catch {}
    document.documentElement.lang = id;
    const l = languages.find((x) => x.id === id)!;
    notify(l.ready ? "เปลี่ยนภาษาเป็น " + l.name + " แล้ว" : "บันทึกภาษา " + l.name + " แล้ว · หน้าจอภาษานี้กำลังทยอยเปิดใช้ ระหว่างนี้แสดงเป็นภาษาไทย");
  };
  return (
    <div className="acs-page">
      <section className="acs-card">
        <header>
          <span className="acs-icon t-blue">
            <Languages size={18} />
          </span>
          <div>
            <h3>ภาษา / Language</h3>
            <small>เลือกภาษาที่ใช้แสดงผลในระบบ</small>
          </div>
        </header>
        <div className="acs-langs" role="radiogroup" aria-label="ภาษา">
          {languages.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={lang === l.id} className={lang === l.id ? "on" : ""} onClick={() => pick(l.id)}>
              <span className={"acs-flag f-" + l.id}>{l.id.toUpperCase()}</span>
              <span className="acs-lang-text">
                <b>{l.name}</b>
                <small>{l.ready ? l.native : l.native + " · เร็วๆ นี้"}</small>
              </span>
              {lang === l.id && <Check size={16} className="acs-check" />}
            </button>
          ))}
        </div>
        <p className="acs-note">
          <Globe2 size={14} /> ภาษาที่เลือกจะจำไว้ในเครื่องนี้ ภาษาอื่นนอกจากไทยกำลังทยอยเปิดใช้งาน
        </p>
      </section>

      <section className="acs-card acs-soon">
        <header>
          <span className="acs-icon t-pink">
            <Bell size={18} />
          </span>
          <div>
            <h3>การแจ้งเตือน</h3>
            <small>เลือกเรื่องที่ต้องการให้แจ้งทางเว็บ อีเมล และ LINE</small>
          </div>
          <em className="acs-tag">เร็วๆ นี้</em>
        </header>
      </section>
      <section className="acs-card acs-soon">
        <header>
          <span className="acs-icon t-violet">
            <Palette size={18} />
          </span>
          <div>
            <h3>หน้าตาและธีม</h3>
            <small>โหมดสว่าง / มืด และขนาดตัวอักษร</small>
          </div>
          <em className="acs-tag">เร็วๆ นี้</em>
        </header>
      </section>
    </div>
  );
}
