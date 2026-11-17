"use client";
// หน้าแรก: "EliteFlow ทำอะไร" ในภาพเดียว — a LINE group chat played out on a phone, next to the EliteFlow website
// updating live. Each case is a real way people use it: tag @EliteFlow, type (or send a photo), the bot summarises it
// as a card, someone taps บันทึก / อนุมัติ, and the record lands in the right system. Plays on its own; tabs pick a case.
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Camera,
  Check,
  ChevronRight,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  Mic,
  Pause,
  Phone,
  Play,
  Plus,
  Search,
  Smile,
  Sparkles,
} from "lucide-react";

type Card = { title: string; tone: string; icon: string; rows: [string, string][]; buttons: string[]; done?: string };
type Msg =
  | { id: number; kind: "me"; text: string; time: string }
  | { id: number; kind: "photo"; label: string; amount: string; time: string }
  | { id: number; kind: "them"; name: string; avatar: string; text: string; time: string }
  | { id: number; kind: "bot"; text: string; time: string }
  | { id: number; kind: "card"; card: Card; tapped: number | null; time: string }
  | { id: number; kind: "typing" };
type Row = string[];
type Web = { page: string; icon: string; kpis: [string, number, string][]; head: string[]; rows: Row[] };
type Step =
  | { t: "type"; text: string }
  | { t: "photo"; label: string; amount: string }
  | { t: "them"; name: string; avatar: string; text: string }
  | { t: "bot"; text: string }
  | { t: "card"; card: Card }
  | { t: "tap"; button: number }
  | { t: "stage"; n: number }
  | { t: "kpi"; index: number; to: number }
  | { t: "row"; row: Row }
  | { t: "wait"; ms: number };
type Case = { id: string; tab: string; emoji: string; group: string; members: number; dept: string; web: Web; steps: Step[] };

const stages = [
  { title: "พิมพ์หรือส่งรูปในกลุ่ม LINE", body: "แท็ก @EliteFlow แล้วพิมพ์ภาษาพูดได้เลย ส่งรูปใบเสร็จ สลิป หรือไฟล์ตามมา" },
  { title: "AI อ่านและสรุปเป็นการ์ด", body: "แยกว่าเป็นงานอะไร ดึงยอดเงิน วันที่ ชื่อคน ครบทุกช่อง ให้ตรวจก่อนบันทึก" },
  { title: "กดบันทึก / อนุมัติในแชท", body: "ผู้มีสิทธิ์กดอนุมัติได้ทันทีในกลุ่ม ไม่ต้องเปิดคอมพิวเตอร์" },
  { title: "เข้าระบบและ Dashboard ทันที", body: "รายการขึ้นในระบบที่ถูกต้อง ตัวเลขผู้บริหารอัปเดตเรียลไทม์" },
];

const cases: Case[] = [
  {
    id: "expense",
    tab: "เบิกค่าใช้จ่าย",
    emoji: "🧾",
    group: "ทีมขาย · EliteFlow",
    members: 8,
    dept: "บัญชีและการเงิน",
    web: {
      page: "ค่าใช้จ่าย",
      icon: "🧾",
      kpis: [["ค่าใช้จ่ายเดือนนี้", 48650, "฿"], ["รออนุมัติ", 2, ""], ["อนุมัติแล้ว", 31, ""]],
      head: ["รายการ", "ผู้ขอ", "ยอด", "สถานะ"],
      rows: [["ค่าที่จอดรถ", "ฝน", "฿120", "จ่ายแล้ว"], ["ค่าไปรษณีย์", "บอส", "฿85", "จ่ายแล้ว"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow ค่าน้ำมันไปพบลูกค้าที่บางนา 1,250 บาท" },
      { t: "photo", label: "ใบเสร็จ ปตท.", amount: "1,250.00" },
      { t: "stage", n: 1 },
      {
        t: "card",
        card: { title: "ใบขออนุมัติค่าใช้จ่าย", tone: "pink", icon: "🧾", rows: [["รายการ", "ค่าน้ำมัน · พบลูกค้าบางนา"], ["ยอดเงิน", "฿1,250.00"], ["หมวด", "ค่าน้ำมัน/แก๊ส/รถยนต์"], ["หลักฐาน", "📎 ใบเสร็จ 1 รูป"]], buttons: ["บันทึกได้เลย", "แก้ไข", "ยกเลิก"], done: "📤 ส่งให้ผู้อนุมัติแล้ว" },
      },
      { t: "stage", n: 2 },
      { t: "tap", button: 0 },
      { t: "card", card: { title: "รออนุมัติ · EXP-69-0042", tone: "amber", icon: "⏳", rows: [["ผู้ขอ", "คุณ (ทีมขาย)"], ["ยอดเงิน", "฿1,250.00"]], buttons: ["อนุมัติ", "ไม่อนุมัติ"], done: "✅ อนุมัติโดย คุณวิภา" } },
      { t: "them", name: "วิภา (ผู้จัดการ)", avatar: "ว", text: "ตรวจแล้วค่ะ" },
      { t: "tap", button: 0 },
      { t: "stage", n: 3 },
      { t: "row", row: ["ค่าน้ำมัน · บางนา", "คุณ", "฿1,250", "อนุมัติแล้ว"] },
      { t: "kpi", index: 0, to: 49900 },
      { t: "kpi", index: 2, to: 32 },
      { t: "bot", text: "✅ อนุมัติแล้ว บันทึกเข้าระบบบัญชี EXP-69-0042 เรียบร้อยค่ะ" },
    ],
  },
  {
    id: "leave",
    tab: "ขอลางาน",
    emoji: "🌴",
    group: "ทีมการตลาด · EliteFlow",
    members: 12,
    dept: "HR ฝ่ายบุคคล",
    web: {
      page: "การลา",
      icon: "🌴",
      kpis: [["ลาวันนี้", 1, ""], ["รออนุมัติ", 0, ""], ["วันลาคงเหลือเฉลี่ย", 9, " วัน"]],
      head: ["พนักงาน", "ประเภท", "วันที่", "สถานะ"],
      rows: [["แนน", "ลากิจ", "18 พ.ย.", "อนุมัติ"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow ขอลาป่วยพรุ่งนี้ 1 วันนะครับ มีไข้" },
      { t: "stage", n: 1 },
      { t: "card", card: { title: "ใบลา", tone: "teal", icon: "🌴", rows: [["พนักงาน", "ต้น (การตลาด)"], ["ประเภท", "ลาป่วย"], ["วันที่", "19 พ.ย. 2569 · 1 วัน"], ["เหตุผล", "มีไข้"]], buttons: ["บันทึกได้เลย", "แก้ไข", "ยกเลิก"], done: "📤 ส่งให้หัวหน้าแล้ว" } },
      { t: "stage", n: 2 },
      { t: "tap", button: 0 },
      { t: "row", row: ["ต้น", "ลาป่วย", "19 พ.ย.", "รออนุมัติ"] },
      { t: "kpi", index: 1, to: 1 },
      { t: "them", name: "หัวหน้าเจน", avatar: "จ", text: "พักผ่อนเยอะๆ นะ หายไวๆ" },
      { t: "card", card: { title: "รออนุมัติ · ใบลา", tone: "amber", icon: "⏳", rows: [["พนักงาน", "ต้น"], ["วันที่", "19 พ.ย. · ลาป่วย"]], buttons: ["อนุมัติ", "ไม่อนุมัติ"], done: "✅ อนุมัติโดย หัวหน้าเจน" } },
      { t: "tap", button: 0 },
      { t: "stage", n: 3 },
      { t: "kpi", index: 1, to: 0 },
      { t: "row", row: ["ต้น", "ลาป่วย", "19 พ.ย.", "อนุมัติ"] },
      { t: "bot", text: "✅ บันทึกใบลาในระบบ HR แล้ว วันลาป่วยคงเหลือ 29 วันค่ะ" },
    ],
  },
  {
    id: "sale",
    tab: "แจ้งยอดขาย",
    emoji: "💰",
    group: "ฝ่ายขาย · EliteFlow",
    members: 15,
    dept: "ฝ่ายขาย + บัญชี",
    web: {
      page: "ยอดขาย",
      icon: "💰",
      kpis: [["ยอดขายวันนี้", 58420, "฿"], ["เป้าเดือนนี้", 72, "%"], ["ลูกค้าใหม่", 4, ""]],
      head: ["ลูกค้า", "พนักงาน", "ยอด", "ชำระ"],
      rows: [["ร้านมะลิ", "บอส", "฿12,400", "โอนแล้ว"], ["คาเฟ่ทองหล่อ", "ฝน", "฿8,900", "โอนแล้ว"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow ปิดการขายร้านสมใจ ป้ายไฟ 3 ชุด 45,000 ลูกค้าโอนแล้ว" },
      { t: "photo", label: "สลิป K PLUS", amount: "45,000.00" },
      { t: "stage", n: 1 },
      { t: "card", card: { title: "บันทึกยอดขาย", tone: "violet", icon: "💰", rows: [["ลูกค้า", "ร้านสมใจ (ลูกค้าใหม่)"], ["สินค้า", "ป้ายไฟ × 3 ชุด"], ["ยอดขาย", "฿45,000.00"], ["การชำระ", "โอนแล้ว · ตรวจสลิปผ่าน ✓"]], buttons: ["บันทึกได้เลย", "แก้ไข", "ยกเลิก"], done: "✅ บันทึกแล้ว" } },
      { t: "stage", n: 2 },
      { t: "tap", button: 0 },
      { t: "stage", n: 3 },
      { t: "row", row: ["ร้านสมใจ", "คุณ", "฿45,000", "โอนแล้ว"] },
      { t: "kpi", index: 0, to: 103420 },
      { t: "kpi", index: 1, to: 81 },
      { t: "kpi", index: 2, to: 5 },
      { t: "bot", text: "🎉 ยอดขายวันนี้ ฿103,420 ทะลุเป้ารายวันแล้ว! ออกใบเสร็จให้ลูกค้าได้ที่ปุ่มด้านล่างค่ะ" },
      { t: "them", name: "ผู้จัดการขาย", avatar: "ข", text: "เยี่ยมมาก 👏👏" },
    ],
  },
  {
    id: "stock",
    tab: "เบิกสินค้า",
    emoji: "📦",
    group: "คลังสินค้า · EliteFlow",
    members: 6,
    dept: "คลังสินค้า",
    web: {
      page: "สต็อกสินค้า",
      icon: "📦",
      kpis: [["สินค้าทั้งหมด", 214, " รายการ"], ["ใกล้หมด", 3, ""], ["กล่องพัสดุ M คงเหลือ", 120, " ใบ"]],
      head: ["เลขที่", "สินค้า", "จำนวน", "ผู้เบิก"],
      rows: [["WD-69-0087", "เทปใส", "10", "แนน"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow เบิกกล่องพัสดุ M 80 ใบ ไปหน้างานสยาม" },
      { t: "stage", n: 1 },
      { t: "card", card: { title: "ใบเบิกสินค้า", tone: "blue", icon: "📦", rows: [["สินค้า", "กล่องพัสดุ M"], ["จำนวน", "80 ใบ (คงเหลือ 120)"], ["ไปที่", "หน้างานสยาม"]], buttons: ["บันทึกได้เลย", "แก้ไข", "ยกเลิก"], done: "✅ ตัดสต็อกแล้ว · WD-69-0088" } },
      { t: "stage", n: 2 },
      { t: "tap", button: 0 },
      { t: "stage", n: 3 },
      { t: "row", row: ["WD-69-0088", "กล่องพัสดุ M", "80", "คุณ"] },
      { t: "kpi", index: 2, to: 40 },
      { t: "kpi", index: 1, to: 4 },
      { t: "bot", text: "⚠️ กล่องพัสดุ M เหลือ 40 ใบ ต่ำกว่าจุดสั่งซื้อ แจ้งฝ่ายจัดซื้อให้แล้วค่ะ" },
    ],
  },
  {
    id: "task",
    tab: "สั่งงานทีม",
    emoji: "✅",
    group: "ผู้บริหาร · EliteFlow",
    members: 5,
    dept: "งาน & โปรเจกต์",
    web: {
      page: "งานของทีม",
      icon: "✅",
      kpis: [["งานที่เปิดอยู่", 18, ""], ["ครบกำหนดสัปดาห์นี้", 5, ""], ["เสร็จตรงเวลา", 94, "%"]],
      head: ["งาน", "ผู้รับผิดชอบ", "กำหนดส่ง", "สถานะ"],
      rows: [["ตรวจบูธ Central", "เอ็ม", "20 พ.ย.", "กำลังทำ"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow ให้ @แนน ทำสไลด์เสนองาน Fashion Island ส่งภายในศุกร์นี้" },
      { t: "stage", n: 1 },
      { t: "card", card: { title: "มอบหมายงาน", tone: "green", icon: "✅", rows: [["งาน", "สไลด์เสนองาน Fashion Island"], ["ผู้รับผิดชอบ", "@แนน"], ["กำหนดส่ง", "ศุกร์ 21 พ.ย. 2569"], ["โปรเจกต์", "Fashion Island"]], buttons: ["บันทึกได้เลย", "แก้ไข", "ยกเลิก"], done: "✅ สร้างงานแล้ว · แจ้ง @แนน" } },
      { t: "stage", n: 2 },
      { t: "tap", button: 0 },
      { t: "stage", n: 3 },
      { t: "row", row: ["สไลด์ Fashion Island", "แนน", "21 พ.ย.", "ใหม่"] },
      { t: "kpi", index: 0, to: 19 },
      { t: "kpi", index: 1, to: 6 },
      { t: "them", name: "แนน", avatar: "น", text: "รับทราบค่ะ เดี๋ยวส่งร่างแรกพรุ่งนี้นะคะ 🙏" },
      { t: "bot", text: "🔔 จะเตือน @แนน ก่อนครบกำหนด 1 วันค่ะ" },
    ],
  },
  {
    id: "hire",
    tab: "เพิ่มพนักงาน",
    emoji: "🧑‍💼",
    group: "HR · EliteFlow",
    members: 4,
    dept: "HR ฝ่ายบุคคล",
    web: {
      page: "พนักงาน",
      icon: "🧑‍💼",
      kpis: [["พนักงานทั้งหมด", 46, " คน"], ["ประจำ / พาร์ตไทม์", 41, ""], ["เริ่มงานเดือนนี้", 2, ""]],
      head: ["ชื่อ", "ฝ่าย", "ประเภท", "LINE"],
      rows: [["วิภา", "บัญชี", "ประจำ", "ผูกแล้ว ✓"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow เพิ่ม @พี่เอ็ม เป็นพนักงานฝ่าย IT ตำแหน่ง Developer ประจำ เริ่ม 1 ธ.ค." },
      { t: "stage", n: 1 },
      { t: "card", card: { title: "เพิ่มพนักงานใหม่", tone: "teal", icon: "🧑‍💼", rows: [["ชื่อ", "พี่เอ็ม"], ["ฝ่าย / ตำแหน่ง", "IT · Developer"], ["ประเภท", "พนักงานประจำ"], ["เริ่มงาน", "1 ธ.ค. 2569"], ["LINE", "✓ ผูกกับคนที่แท็กแล้ว"]], buttons: ["บันทึกได้เลย", "แก้ไข", "ยกเลิก"], done: "✅ เพิ่มพนักงานแล้ว" } },
      { t: "stage", n: 2 },
      { t: "tap", button: 0 },
      { t: "stage", n: 3 },
      { t: "row", row: ["พี่เอ็ม", "IT", "ประจำ", "ผูกแล้ว ✓"] },
      { t: "kpi", index: 0, to: 47 },
      { t: "kpi", index: 1, to: 42 },
      { t: "kpi", index: 2, to: 3 },
      { t: "them", name: "พี่เอ็ม", avatar: "อ", text: "ขอบคุณครับ ยินดีที่ได้ร่วมงานครับ 🙌" },
    ],
  },
  {
    id: "ask",
    tab: "ถาม AI",
    emoji: "🤖",
    group: "ผู้บริหาร · EliteFlow",
    members: 5,
    dept: "Dashboard ผู้บริหาร",
    web: {
      page: "Dashboard ผู้บริหาร",
      icon: "📊",
      kpis: [["รายรับเดือนนี้", 1284500, "฿"], ["ค่าใช้จ่าย", 486200, "฿"], ["กำไรโดยประมาณ", 798300, "฿"]],
      head: ["โปรเจกต์", "สถานะ", "ยอดขาย", "ความคืบหน้า"],
      rows: [["Central World", "กำลังทำ", "฿320,000", "64%"], ["Fashion Island", "เสร็จแล้ว", "฿180,000", "100%"]],
    },
    steps: [
      { t: "stage", n: 0 },
      { t: "type", text: "@EliteFlow สรุปค่าใช้จ่ายเดือนนี้หน่อย" },
      { t: "stage", n: 1 },
      { t: "card", card: { title: "สรุปค่าใช้จ่าย พ.ย. 2569", tone: "violet", icon: "📊", rows: [["รวมทั้งเดือน", "฿486,200 (▲ 8%)"], ["สูงสุด", "วัสดุตกแต่งบูธ ฿182,000"], ["รออนุมัติ", "3 รายการ · ฿24,500"], ["AI แนะนำ", "ค่าขนส่งสูงกว่าเดือนก่อน 21%"]], buttons: ["ดูไฟล์ Excel", "อนุมัติที่ค้าง"] } },
      { t: "stage", n: 3 },
      { t: "kpi", index: 1, to: 486200 },
      { t: "them", name: "CEO", avatar: "C", text: "@EliteFlow ยอดขายวันนี้เท่าไหร่" },
      { t: "bot", text: "💰 ยอดขายวันนี้ ฿103,420 จาก 6 รายการ · ดีกว่าเมื่อวาน 18% ค่ะ" },
    ],
  },
];

/** The row's width as on a computer; smaller screens scale it down to fit. */
const STAGE_W = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (i: number) => {
  const m = 30 + i;
  return `09:${String(m % 60).padStart(2, "0")}`;
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function LineLive() {
  const [ci, setCi] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [stage, setStage] = useState(0);
  const [kpis, setKpis] = useState<number[]>(cases[0].web.kpis.map((k) => k[1]));
  const [rows, setRows] = useState<Row[]>(cases[0].web.rows);
  const [fresh, setFresh] = useState<number>(-1);
  const [finger, setFinger] = useState<{ id: number; button: number } | null>(null);
  const [playing, setPlaying] = useState(true);
  const [shown, setShown] = useState(false);
  const chat = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Narrow screens see the whole row (chat · steps · website) as on a computer, scaled to fit the width.
  const fit = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fitHeight, setFitHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = fit.current,
      st = stageRef.current;
    if (!el || !st) return;
    const measure = () => {
      const s = Math.min(1, el.clientWidth / STAGE_W);
      setScale(s);
      setFitHeight(s < 1 ? st.offsetHeight * s : undefined);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(st);
    return () => ro.disconnect();
  }, []);
  const playingRef = useRef(true);
  playingRef.current = playing;
  const msgsNow = useRef<Msg[]>([]);
  msgsNow.current = msgs;
  const kpisNow = useRef<number[]>([]);

  // Start when the section scrolls into view.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setShown(true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!shown) return;
    let alive = true;
    const c = cases[ci];
    let id = 0;
    let t = 0;
    const wait = async (ms: number) => {
      const end = Date.now() + ms;
      while (alive && Date.now() < end) await sleep(60);
      while (alive && !playingRef.current) await sleep(120);
    };
    const add = (m: Msg) => setMsgs((s) => [...s.filter((x) => x.kind !== "typing"), m]);
    const countTo = async (index: number, to: number) => {
      const from = kpisNow.current[index];
      for (let k = 1; k <= 24 && alive; k++) {
        const v = from + ((to - from) * k) / 24;
        kpisNow.current[index] = v;
        setKpis([...kpisNow.current]);
        await sleep(28);
      }
    };
    setMsgs([]);
    setDraft("");
    setStage(0);
    setRows(c.web.rows);
    setFresh(-1);
    kpisNow.current = c.web.kpis.map((k) => k[1]);
    setKpis([...kpisNow.current]);
    (async () => {
      await wait(500);
      for (const s of c.steps) {
        if (!alive) return;
        if (s.t === "stage") setStage(s.n);
        else if (s.t === "type") {
          for (let k = 1; k <= s.text.length && alive; k++) {
            setDraft(s.text.slice(0, k));
            await sleep(s.text[k - 1] === " " ? 30 : 42);
            while (alive && !playingRef.current) await sleep(120);
          }
          await wait(350);
          setDraft("");
          add({ id: ++id, kind: "me", text: s.text, time: clock(t++) });
          await wait(700);
        } else if (s.t === "photo") {
          add({ id: ++id, kind: "photo", label: s.label, amount: s.amount, time: clock(t++) });
          await wait(900);
        } else if (s.t === "them") {
          add({ id: ++id, kind: "typing" });
          await wait(900);
          add({ id: ++id, kind: "them", name: s.name, avatar: s.avatar, text: s.text, time: clock(t++) });
          await wait(1100);
        } else if (s.t === "bot" || s.t === "card") {
          add({ id: ++id, kind: "typing" });
          await wait(1300);
          add(s.t === "bot" ? { id: ++id, kind: "bot", text: s.text, time: clock(t++) } : { id: ++id, kind: "card", card: s.card, tapped: null, time: clock(t++) });
          await wait(s.t === "card" ? 1500 : 1300);
        } else if (s.t === "tap") {
          const last = [...msgsNow.current].reverse().find((m) => m.kind === "card") as Extract<Msg, { kind: "card" }> | undefined;
          if (last) {
            setFinger({ id: last.id, button: s.button });
            await wait(900);
            setMsgs((ms) => ms.map((m) => (m.id === last.id && m.kind === "card" ? { ...m, tapped: s.button } : m)));
            await wait(450);
            setFinger(null);
            await wait(500);
          }
        } else if (s.t === "kpi") await countTo(s.index, s.to);
        else if (s.t === "row") {
          setRows((r) => {
            const i = r.findIndex((x) => x[0] === s.row[0]);
            const next = i >= 0 ? r.map((x, j) => (j === i ? s.row : x)) : [s.row, ...r];
            setFresh(i >= 0 ? i : 0);
            return next.slice(0, 4);
          });
          await wait(700);
        } else if (s.t === "wait") await wait(s.ms);
      }
      await wait(3600);
      if (alive) setCi((i) => (i + 1) % cases.length);
    })();
    return () => {
      alive = false;
    };
  }, [ci, shown]);

  useEffect(() => {
    chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const c = cases[ci];
  return (
    <div className="ll" ref={box}>
      <div className="ll-tabs" role="tablist" aria-label="ตัวอย่างการสั่งงานใน LINE">
        {cases.map((x, i) => (
          <button key={x.id} role="tab" aria-selected={i === ci} className={i === ci ? "on" : ""} onClick={() => (setCi(i), setPlaying(true))}>
            <span>{x.emoji}</span> {x.tab}
            {i === ci && <i className="ll-tab-bar" key={ci} />}
          </button>
        ))}
      </div>

      <div className="ll-fit" ref={fit} style={{ height: fitHeight }}>
      <div className={"ll-stage" + (scale < 1 ? " scaled" : "")} ref={stageRef} style={scale < 1 ? { width: STAGE_W, transform: `scale(${scale})` } : undefined}>
        {/* The phone: a LINE group chat */}
        <div className="ll-phone-wrap">
          <div className="ll-phone">
            <div className="ll-notch" />
            <div className="ll-status">
              <b>9:41</b>
              <span>●●●● 5G ▮</span>
            </div>
            <header className="ll-head">
              <ArrowLeft size={18} />
              <div>
                <b>{c.group}</b>
                <small>({c.members})</small>
              </div>
              <Search size={17} />
              <Phone size={17} />
              <Menu size={17} />
            </header>
            <div className="ll-chat" ref={chat}>
              <div className="ll-day">วันนี้</div>
              {msgs.map((m) =>
                m.kind === "typing" ? (
                  <div key={m.id} className="ll-row left in">
                    <span className="ll-av bot">
                      <img src="/brand/eliteflow-mark.png" alt="" />
                    </span>
                    <div className="ll-bubble typing">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                ) : m.kind === "me" ? (
                  <div key={m.id} className="ll-row right in">
                    <small className="ll-meta">
                      อ่านแล้ว {c.members - 1}
                      <br />
                      {m.time}
                    </small>
                    <div className="ll-bubble me">
                      <Mention text={m.text} />
                    </div>
                  </div>
                ) : m.kind === "photo" ? (
                  <div key={m.id} className="ll-row right in">
                    <small className="ll-meta">
                      อ่านแล้ว {c.members - 1}
                      <br />
                      {m.time}
                    </small>
                    <div className="ll-photo">
                      <div className="ll-receipt">
                        <b>{m.label}</b>
                        <span />
                        <span />
                        <span className="short" />
                        <em>รวม {m.amount}</em>
                        <i className="ll-scan" />
                      </div>
                    </div>
                  </div>
                ) : m.kind === "them" ? (
                  <div key={m.id} className="ll-row left in">
                    <span className="ll-av">{m.avatar}</span>
                    <div>
                      <small className="ll-name">{m.name}</small>
                      <div className="ll-bubble them">
                        <Mention text={m.text} />
                      </div>
                    </div>
                    <small className="ll-meta">{m.time}</small>
                  </div>
                ) : m.kind === "bot" ? (
                  <div key={m.id} className="ll-row left in">
                    <span className="ll-av bot">
                      <img src="/brand/eliteflow-mark.png" alt="" />
                    </span>
                    <div>
                      <small className="ll-name">EliteFlow</small>
                      <div className="ll-bubble them">{m.text}</div>
                    </div>
                    <small className="ll-meta">{m.time}</small>
                  </div>
                ) : (
                  <div key={m.id} className="ll-row left in">
                    <span className="ll-av bot">
                      <img src="/brand/eliteflow-mark.png" alt="" />
                    </span>
                    <div>
                      <small className="ll-name">EliteFlow</small>
                      <div className={"ll-card t-" + m.card.tone + (m.tapped !== null ? " done" : "")}>
                        <div className="ll-card-head">
                          <span>{m.card.icon}</span>
                          <b>{m.card.title}</b>
                        </div>
                        <div className="ll-card-body">
                          {m.card.rows.map(([k, v]) => (
                            <div key={k}>
                              <small>{k}</small>
                              <b>{v}</b>
                            </div>
                          ))}
                        </div>
                        {m.tapped !== null && m.card.done ? (
                          <div className="ll-card-done">{m.card.done}</div>
                        ) : (
                          <div className={"ll-card-btns n" + m.card.buttons.length}>
                            {m.card.buttons.map((b, i) => (
                              <span key={b} className={(i === 0 ? "primary" : "") + (finger?.id === m.id && finger.button === i ? " press" : "")}>
                                {b}
                                {finger?.id === m.id && finger.button === i && <i className="ll-finger" aria-hidden />}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <small className="ll-meta">{m.time}</small>
                  </div>
                ),
              )}
            </div>
            <footer className="ll-input">
              <Plus size={20} />
              <Camera size={19} />
              <ImageIcon size={19} />
              <div className={"ll-field" + (draft ? " typing" : "")}>
                {draft ? <Mention text={draft} /> : <span className="ph">Aa</span>}
                {draft && <i className="ll-caret" />}
              </div>
              {draft ? <Smile size={19} /> : <Mic size={19} />}
            </footer>
          </div>
          <button type="button" className="ll-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "หยุดชั่วคราว" : "เล่นต่อ"}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? "หยุดชั่วคราว" : "เล่นต่อ"}
          </button>
        </div>

        {/* What happens, step by step */}
        <ol className="ll-steps">
          {stages.map((s, i) => (
            <li key={s.title} className={(i === stage ? "on" : "") + (i < stage ? " past" : "")}>
              <span className="ll-step-n">{i < stage ? <Check size={14} /> : i + 1}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
          <li className="ll-where">
            <Sparkles size={15} /> เคสนี้บันทึกเข้า <b>{c.dept}</b>
          </li>
        </ol>

        {/* The EliteFlow website, updating */}
        <div className={"ll-web" + (stage === 3 ? " live" : "")}>
          <div className="ll-web-bar">
            <i />
            <i />
            <i />
            <span>eliteflow-ai.com/workspace</span>
          </div>
          <div className="ll-web-body">
            <aside>
              <img src="/brand/eliteflow-mark.png" alt="" />
              <LayoutDashboard size={15} />
              <span className="on" />
              <span />
              <span />
              <span />
            </aside>
            <div className="ll-web-main">
              <div className="ll-web-title">
                <span>{c.web.icon}</span>
                <b>{c.web.page}</b>
                <em className={stage === 3 ? "on" : ""}>● Live จาก LINE</em>
              </div>
              <div className="ll-kpis">
                {c.web.kpis.map(([label, , unit], i) => (
                  <div key={label} className={"ll-kpi k" + i}>
                    <small>{label}</small>
                    <b>
                      {unit === "฿" ? "฿" : ""}
                      {fmt(kpis[i] ?? 0)}
                      {unit !== "฿" ? unit : ""}
                    </b>
                  </div>
                ))}
              </div>
              <table className="ll-table">
                <thead>
                  <tr>
                    {c.web.head.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.join("|")} className={i === fresh ? "fresh" : ""}>
                      {r.map((cell, j) => (
                        <td key={j}>
                          {j === r.length - 1 ? <span className={"ll-pill " + pillTone(cell)}>{cell}</span> : cell}
                          {j === 0 && i === fresh && <em className="ll-new">ใหม่ · LINE</em>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ll-web-foot">
                <Bot size={14} /> AI ตรวจข้อมูลครบทุกช่องก่อนบันทึก · ทุกรายการมีที่มาจากแชท
                <ChevronRight size={14} />
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function pillTone(v: string) {
  if (/รอ|ใหม่|กำลัง/.test(v)) return "wait";
  if (/อนุมัติ|แล้ว|ผูก|เสร็จ|\d+%/.test(v)) return "ok";
  return "plain";
}
/** "@EliteFlow …" and "@ชื่อ" in LINE's blue. */
function Mention({ text }: { text: string }) {
  const parts = text.split(/(@\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span key={i} className="ll-at">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
