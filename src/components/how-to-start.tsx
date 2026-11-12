"use client";
// วิธีเริ่มใช้งาน (bottom of ภาพรวม): three steps — company details, connect LINE, then just type in the LINE chat
// and the AI files the data and shows it on the dashboard. Each step shows whether it is done.
import { useEffect, useState } from "react";
import { ArrowRight, Bot, Building2, Check, LayoutDashboard, MessagesSquare, Sparkles, type LucideIcon } from "lucide-react";
import type { Context } from "@/lib/types";
import { companyMissing } from "@/lib/company-required";
import { api } from "./shared";

type LineGroup = { test?: boolean; total?: number };

export function HowToStart({ ctx, navigate }: { ctx: Context; navigate: (v: string) => void }) {
  const [groups, setGroups] = useState<LineGroup[] | null>(null);
  useEffect(() => {
    let live = true;
    api("/line-groups")
      .then((g: LineGroup[]) => live && setGroups(Array.isArray(g) ? g : []))
      .catch(() => live && setGroups([]));
    return () => {
      live = false;
    };
  }, []);
  const profile = { ...ctx.company.profile, name: ctx.company.profile.name || ctx.company.name } as Record<string, unknown>,
    real = (groups || []).filter((g) => !g.test),
    done = [companyMissing(profile).length === 0, real.length > 0, real.some((g) => (g.total || 0) > 0)],
    count = done.filter(Boolean).length;
  const steps: { title: string; text: string; icon: LucideIcon; color: string; go: string; button: string }[] = [
    {
      title: "บันทึกข้อมูลบริษัท",
      text: "ชื่อ เลขผู้เสียภาษี ที่อยู่ เบอร์ติดต่อ และโลโก้ ใช้ออกเอกสารและแสดงในหน้าบริษัท",
      icon: Building2,
      color: "#7c3aed",
      go: "company",
      button: "ไปที่หน้าบริษัท",
    },
    {
      title: "เชื่อมต่อ LINE",
      text: "เพิ่มบอท EliteFlow เข้ากลุ่ม LINE ของทีม แล้วเลือกว่ากลุ่มไหนให้ AI ดึงข้อมูลอะไรมาโชว์",
      icon: MessagesSquare,
      color: "#06c755",
      go: "integrations",
      button: "เชื่อมต่อ LINE",
    },
    {
      title: "พิมพ์ในแชท LINE ได้เลย",
      text: "พิมพ์หรือส่งรูปใบเสร็จในกลุ่มตามปกติ AI จะอ่าน บันทึก และขึ้นบน Dashboard ให้เอง",
      icon: Bot,
      color: "#0ea5e9",
      go: "integrations",
      button: "ดูข้อความจาก LINE",
    },
  ];
  return (
    <section className="hts" aria-labelledby="hts-title">
      <header className="hts-head">
        <span className="hts-badge">
          <Sparkles size={14} /> วิธีเริ่มใช้งาน
        </span>
        <h2 id="hts-title">บันทึกข้อมูลง่าย ๆ ใน 3 ขั้นตอน</h2>
        <div className="hts-progress" aria-label={`ทำแล้ว ${count} จาก 3 ขั้นตอน`}>
          <i>
            <em style={{ width: (count / 3) * 100 + "%" }} />
          </i>
          <small>{groups === null ? "กำลังตรวจสอบ…" : `ทำแล้ว ${count}/3`}</small>
        </div>
      </header>
      <ol className="hts-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={"hts-step" + (done[i] ? " done" : "")} style={{ "--c": s.color } as React.CSSProperties}>
            <div className="hts-top">
              <span className="hts-num">{done[i] ? <Check size={16} /> : i + 1}</span>
              <span className="hts-ic">
                <s.icon size={22} />
              </span>
              {done[i] && <span className="hts-done">เรียบร้อย</span>}
            </div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            {i === 2 && (
              <div className="hts-chat" aria-hidden>
                <span className="me">ซื้อกระดาษ A4 5 รีม 650 บาท</span>
                <span className="bot">
                  <Bot size={12} /> บันทึกค่าใช้จ่าย ฿650 แล้ว
                </span>
                <span className="dash">
                  <LayoutDashboard size={12} /> ขึ้นบน Dashboard
                </span>
              </div>
            )}
            <button className="hts-go" onClick={() => navigate(s.go)}>
              {s.button} <ArrowRight size={15} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
