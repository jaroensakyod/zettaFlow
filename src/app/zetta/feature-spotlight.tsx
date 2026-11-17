"use client";
// หน้าแรก › PRODUCT: the six things the platform does. One card at a time comes forward (bigger, brighter) and its
// title lights up word by word, as if being read — it leads the eye through the list. Hover or tap a card to hold it.
import { useEffect, useRef, useState } from "react";
import { Bot, ChartNoAxesCombined, LayoutGrid, Link2, ReceiptText, Users } from "lucide-react";

const features = [
  { icon: LayoutGrid, tone: "violet", title: "สร้างระบบเองได้ ไม่ต้องเขียนโค้ด", body: "บอก AI ว่าอยากเก็บข้อมูลอะไร ระบบร่างฟอร์มและหน้าจอให้ เพิ่มช่องได้ในนาทีเดียว" },
  { icon: ChartNoAxesCombined, tone: "blue", title: "Dashboard สร้างให้อัตโนมัติ", body: "ทุกข้อมูลกลายเป็นกราฟและตัวเลขสรุป ผู้บริหารเห็นภาพรวมแบบเรียลไทม์" },
  { icon: Bot, tone: "pink", title: "ถาม AI ได้ในแชท", body: "“มีงานรออนุมัติกี่งาน?” “ยอดขายวันนี้เท่าไหร่?” ตอบจากข้อมูลจริงทันที" },
  { icon: ReceiptText, tone: "green", title: "ตรวจสลิปและใบเสร็จอัตโนมัติ", body: "อ่าน QR สลิป เทียบยอด กันสลิปซ้ำ อ่านใบเสร็จและใบกำกับภาษีให้เอง" },
  { icon: Users, tone: "amber", title: "สิทธิ์ตามตำแหน่งจริง", body: "เจ้าของ ผู้จัดการ พนักงาน แยกสิทธิ์รายแผนก ผูก LINE กับตัวพนักงาน" },
  { icon: Link2, tone: "teal", title: "แชร์ข้อมูลให้พาร์ตเนอร์", body: "ส่งลิงก์ Dashboard หรือเอกสาร ตั้งรหัสผ่านและวันหมดอายุได้" },
];
const STEP_MS = 2800;

export function FeatureSpotlight() {
  const [on, setOn] = useState(0);
  const [held, setHeld] = useState(false);
  const [seen, setSeen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setSeen(!!e[0]?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (held || !seen) return;
    const t = window.setTimeout(() => setOn((i) => (i + 1) % features.length), STEP_MS);
    return () => window.clearTimeout(t);
  }, [on, held, seen]);
  return (
    <div className={"bs-features spot" + (seen ? " seen" : "")} ref={box} onMouseLeave={() => setHeld(false)}>
      {features.map((f, i) => {
        const words = f.title.split(" ");
        return (
          <article
            key={f.title}
            className={"bs-feature t-" + f.tone + (i === on ? " on" : "")}
            onMouseEnter={() => (setOn(i), setHeld(true))}
            onClick={() => (setOn(i), setHeld(true))}
          >
            <span className="bs-ficon">
              <f.icon size={22} />
            </span>
            <h3 key={i === on ? "read-" + on : "still"} className={i === on ? "reading" : ""}>
              {words.map((w, j) => (
                <span key={j} style={{ animationDelay: j * 260 + "ms" }}>
                  {w}
                  {j < words.length - 1 ? " " : ""}
                </span>
              ))}
            </h3>
            <p>{f.body}</p>
            {i === on && <i className="bs-read-bar" key={"bar" + on} style={{ animationDuration: STEP_MS + "ms" }} />}
          </article>
        );
      })}
    </div>
  );
}
