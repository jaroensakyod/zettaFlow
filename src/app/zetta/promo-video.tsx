"use client";
// Promo clip on the home page. Until the real video exists it plays an animated stand-in told in four scenes:
// staff send work in LINE → AI reads and files it → the dashboard updates live → the CEO approves from anywhere.
// To use a real clip, set NEXT_PUBLIC_PROMO_VIDEO_URL (an https:// .mp4/.webm, or a YouTube link) and redeploy.
import { useEffect, useRef, useState } from "react";
import { Bot, Check, FileText, MessageCircle, Pause, Play, ScanLine, Smartphone, TrendingUp } from "lucide-react";

const VIDEO_URL = process.env.NEXT_PUBLIC_PROMO_VIDEO_URL || "";
const SCENE_MS = 4200;
const scenes = [
  { icon: MessageCircle, title: "พนักงานสั่งงานผ่าน LINE", caption: "ทีมพิมพ์ ส่งรูป ส่งไฟล์ ในกลุ่ม LINE ที่ใช้อยู่แล้ว ไม่ต้องเปิดแอปใหม่" },
  { icon: ScanLine, title: "AI ดึงข้อมูลให้อัตโนมัติ", caption: "AI อ่านข้อความ รูปใบเสร็จ และเอกสาร แยกเป็นข้อมูลธุรกิจอย่างแม่นยำ" },
  { icon: TrendingUp, title: "Dashboard อัปเดตเรียลไทม์", caption: "ยอดขาย งาน และสต็อก ขึ้นหน้าจอ CEO ทันที ครบในหน้าจอเดียว" },
  { icon: Smartphone, title: "อนุมัติได้ทุกที่ ทุกเวลา", caption: "ผู้บริหารกดอนุมัติเอกสารจากมือถือ ระบบแจ้งทีมต่อให้อัตโนมัติ" },
];

function youtubeId(url: string) {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : "";
}

export function PromoVideo() {
  if (VIDEO_URL) {
    const yt = youtubeId(VIDEO_URL);
    return (
      <div className="pv-frame">
        {yt ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0`}
            title="EliteFlow promo"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <video src={VIDEO_URL} controls playsInline preload="metadata" />
        )}
      </div>
    );
  }
  return <StandIn />;
}

function StandIn() {
  const [scene, setScene] = useState(0),
    [playing, setPlaying] = useState(true),
    [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Plays only while on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !visible) return;
    const t = setTimeout(() => setScene((s) => (s + 1) % scenes.length), SCENE_MS);
    return () => clearTimeout(t);
  }, [scene, playing, visible]);
  const run = playing && visible;
  return (
    <div className={"pv-frame pv-standin" + (run ? " run" : "")} ref={box}>
      <div className="pv-stage" key={scene} data-scene={scene}>
        {scene === 0 && <SceneLine />}
        {scene === 1 && <SceneAi />}
        {scene === 2 && <SceneDashboard />}
        {scene === 3 && <SceneApprove />}
      </div>
      <div className="pv-caption" key={"c" + scene}>
        <span className="pv-step">ขั้นที่ {scene + 1}/4</span>
        <h3>{scenes[scene].title}</h3>
        <p>{scenes[scene].caption}</p>
      </div>
      <div className="pv-bar">
        <button type="button" className="pv-play" aria-label={playing ? "หยุด" : "เล่น"} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="pv-chapters">
          {scenes.map((s, i) => (
            <button
              type="button"
              key={s.title}
              className={"pv-chapter" + (i === scene ? " on" : i < scene ? " done" : "")}
              onClick={() => setScene(i)}
              aria-label={s.title}
            >
              <i style={i === scene && run ? { animationDuration: SCENE_MS + "ms" } : undefined} />
              <span>
                <s.icon size={13} /> {s.title}
              </span>
            </button>
          ))}
        </div>
      </div>
      <span className="pv-tag">ตัวอย่างการทำงาน · คลิปจริงเร็วๆ นี้</span>
    </div>
  );
}

function SceneLine() {
  return (
    <div className="pv-phone pv-line">
      <div className="pv-line-top">
        <MessageCircle size={14} /> [EliteFlow] ฝ่ายจัดซื้อ · 8 คน
      </div>
      <div className="pv-msg m1">
        <i>N</i>
        <p>ขออนุมัติซื้อวัสดุตกแต่งบูธ Central World 12,500 บาทค่ะ</p>
      </div>
      <div className="pv-msg m2">
        <i>N</i>
        <p className="pv-receipt">
          <FileText size={16} /> ใบเสนอราคา_SiamDisplay.pdf
        </p>
      </div>
      <div className="pv-msg bot m3">
        <i>
          <Bot size={12} />
        </i>
        <p>รับทราบ กำลังบันทึกเข้าระบบ…</p>
      </div>
    </div>
  );
}

function SceneAi() {
  const fields = [
    ["ผู้ขอ", "นิดา · ฝ่ายจัดซื้อ"],
    ["รายการ", "วัสดุตกแต่งบูธ"],
    ["โปรเจกต์", "Central World"],
    ["ยอดเงิน", "฿12,500"],
    ["ผู้ขาย", "Siam Display"],
  ];
  return (
    <div className="pv-ai">
      <div className="pv-doc">
        <FileText size={30} />
        <i className="pv-scan" />
        <span />
        <span />
        <span className="short" />
        <span />
      </div>
      <div className="pv-ai-core">
        <Bot size={26} />
        <small>AI กำลังอ่าน</small>
      </div>
      <ul className="pv-fields">
        {fields.map(([k, v], i) => (
          <li key={k} style={{ animationDelay: 0.5 + i * 0.35 + "s" }}>
            <small>{k}</small>
            <b>{v}</b>
            <Check size={14} />
          </li>
        ))}
      </ul>
      <span className="pv-accuracy">ความแม่นยำ 99.2%</span>
    </div>
  );
}

function SceneDashboard() {
  const bars = [38, 52, 46, 61, 58, 74, 88];
  return (
    <div className="pv-dash">
      <div className="pv-dash-top">
        <b>CEO Command Center</b>
        <span className="pv-live">
          <i /> LIVE
        </span>
      </div>
      <div className="pv-kpis">
        <div>
          <small>ยอดขายวันนี้</small>
          <b className="pv-count">฿58,420</b>
          <em>▲ 12.8%</em>
        </div>
        <div>
          <small>งานเสร็จ</small>
          <b>487</b>
          <em>▲ 6%</em>
        </div>
        <div className="hot">
          <small>รออนุมัติ</small>
          <b>3</b>
          <em>ใหม่ +1</em>
        </div>
      </div>
      <div className="pv-chart">
        {bars.map((h, i) => (
          <i key={i} style={{ height: h + "%", animationDelay: i * 0.12 + "s" }} />
        ))}
      </div>
      <div className="pv-row">
        <span className="pv-dot" /> ขออนุมัติซื้อวัสดุ · Central World <b>฿12,500</b>
      </div>
    </div>
  );
}

function SceneApprove() {
  return (
    <div className="pv-phone pv-approve">
      <small className="pv-where">📍 สนามบินสุวรรณภูมิ · 21:40</small>
      <div className="pv-card">
        <small>คำขออนุมัติ</small>
        <b>ซื้อวัสดุตกแต่งบูธ</b>
        <span>Central World · ฿12,500</span>
        <div className="pv-actions">
          <span className="pv-reject">ตีกลับ</span>
          <span className="pv-ok">
            <Check size={15} /> อนุมัติ
          </span>
        </div>
      </div>
      <div className="pv-done">
        <Check size={22} />
        <b>อนุมัติแล้ว</b>
        <small>แจ้งทีมจัดซื้อใน LINE ให้แล้ว</small>
      </div>
      <i className="pv-tap" />
    </div>
  );
}
