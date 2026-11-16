"use client";
// เชื่อมต่อกลุ่ม LINE, from the very start: a timeline of five steps, each with a small drawing of what the
// person sees on the phone (create the group → add the bot → invite it → make the code → paste it in the group →
// name who may approve).
import { ArrowDown, Bot, Check, ChevronRight, Copy, KeyRound, MessageCirclePlus, Plus, QrCode, Send, ShieldCheck, UserPlus, Users } from "lucide-react";

export function LineSetupGuide({ botId }: { botId: string }) {
  return (
    <section className="lsg" aria-label="ขั้นตอนการเชื่อมกลุ่ม LINE">
      <header className="lsg-head">
        <b>เชื่อมกลุ่ม LINE ใน 6 ขั้นตอน</b>
        <small>ใช้เวลาไม่กี่นาที ทำบนมือถือได้ทั้งหมด ไม่ต้องมีบัญชี EliteFlow ก็เป็นผู้อนุมัติได้</small>
      </header>
      <ol className="lsg-steps">
        <Step n={1} tone="green" icon={<MessageCirclePlus size={18} />} title="สร้างกลุ่ม LINE" text="ในแอป LINE แตะ แชท → ไอคอนสร้างแชท → สร้างกลุ่ม ใส่ชื่อกลุ่ม เช่น “ฝ่ายบัญชี” แล้วเลือกสมาชิกในทีม (ใช้กลุ่มเดิมที่มีอยู่แล้วก็ได้)">
          <Phone title="สร้างกลุ่ม">
            <div className="lsg-row">
              <span className="lsg-av g">
                <Users size={13} />
              </span>
              <span className="lsg-input">ฝ่ายบัญชี</span>
            </div>
            <div className="lsg-avs">
              {["#f472b6", "#60a5fa", "#fbbf24", "#34d399"].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
              <i className="more">
                <Plus size={10} />
              </i>
            </div>
            <span className="lsg-btn green">สร้าง</span>
          </Phone>
        </Step>
        <Step n={2} tone="teal" icon={<UserPlus size={18} />} title="เพิ่มบอท EliteFlow เป็นเพื่อน" text={`สแกน QR ด้วยกล้องมือถือ หรือค้นหา ID ${botId} ในเมนูเพิ่มเพื่อนของ LINE`}>
          <div className="lsg-qr">
            <img src="/line-bot-qr.svg" alt={"QR เพิ่มเพื่อน " + botId} width={96} height={96} />
            <code>{botId}</code>
            <a className="lsg-btn green" href={"https://line.me/R/ti/p/" + botId} target="_blank" rel="noopener">
              <QrCode size={13} /> เพิ่มเพื่อนใน LINE
            </a>
          </div>
        </Step>
        <Step n={3} tone="blue" icon={<Bot size={18} />} title="เชิญบอทเข้ากลุ่ม" text="เปิดกลุ่มที่สร้างไว้ แตะชื่อกลุ่มด้านบน → เชิญ → เลือก EliteFlow แล้วกดเชิญ">
          <Phone title="ฝ่ายบัญชี">
            <div className="lsg-path">
              <span>ชื่อกลุ่ม</span>
              <ChevronRight size={11} />
              <span>เชิญ</span>
              <ChevronRight size={11} />
              <span className="on">EliteFlow</span>
            </div>
            <div className="lsg-row">
              <span className="lsg-av bot">
                <Bot size={13} />
              </span>
              <span className="lsg-name">EliteFlow</span>
              <span className="lsg-tick">
                <Check size={11} />
              </span>
            </div>
            <small className="lsg-sys">EliteFlow เข้าร่วมกลุ่มแล้ว</small>
          </Phone>
        </Step>
        <Step n={4} tone="violet" icon={<KeyRound size={18} />} title="เลือกแผนก แล้วสร้างรหัส" text="เลือกว่ากลุ่มนี้เป็นของแผนกไหน และให้ AI แยกข้อความอัตโนมัติหรือใช้ฟอร์มเดียว แล้วกด “สร้างรหัสเชื่อมกลุ่ม” ด้านล่าง">
          <div className="lsg-make">
            <span className="lsg-chip">บัญชีและการเงิน</span>
            <span className="lsg-chip ai">AI แยกอัตโนมัติ</span>
            <span className="lsg-btn violet">
              <KeyRound size={12} /> สร้างรหัสเชื่อมกลุ่ม
            </span>
            <ArrowDown size={16} className="lsg-down" />
          </div>
        </Step>
        <Step n={5} tone="pink" icon={<Send size={18} />} title="คัดลอกคำสั่ง ไปส่งในกลุ่ม" text="กดคัดลอกคำสั่ง แล้ววางส่งในกลุ่ม LINE ภายใน 10 นาที บอทจะตอบว่าเชื่อมสำเร็จ กลุ่มขึ้นในตารางทันที">
          <Phone title="ฝ่ายบัญชี">
            <div className="lsg-bubble me">
              #connect 4F7K…
              <Copy size={10} />
            </div>
            <div className="lsg-bubble bot">
              <Bot size={11} /> เชื่อมกลุ่มกับ EliteFlow สำเร็จ ✅
            </div>
          </Phone>
        </Step>
        <Step
          n={6}
          tone="amber"
          icon={<ShieldCheck size={18} />}
          title="กำหนดผู้มีสิทธิ์อนุมัติ"
          text="ในกลุ่ม พิมพ์ “@EliteFlow ให้ @ชื่อ อนุมัติได้” (แท็กได้หลายคน) บอทส่งการ์ดรายชื่อ ตรวจแล้วกด “บันทึก” มีผลทันที ผู้อนุมัติกดปุ่มอนุมัติในการ์ดขออนุมัติได้เลย แต่อนุมัติคำขอของตัวเองไม่ได้"
          last
        >
          <Phone title="ฝ่ายบัญชี">
            <div className="lsg-bubble me plain">
              @EliteFlow ให้ <b>@พี่ศิริ</b> อนุมัติได้
            </div>
            <div className="lsg-card">
              <b>
                <ShieldCheck size={11} /> ผู้อนุมัติของแชทนี้
              </b>
              <span>
                <i>+</i> พี่ศิริ <em>เพิ่มใหม่</em>
              </span>
              <span className="lsg-btn amber">บันทึก</span>
            </div>
          </Phone>
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, tone, icon, title, text, last, children }: { n: number; tone: string; icon: React.ReactNode; title: string; text: string; last?: boolean; children: React.ReactNode }) {
  return (
    <li className={"lsg-step t-" + tone + (last ? " last" : "")}>
      <span className="lsg-n">
        <b>{n}</b>
      </span>
      <div className="lsg-body">
        <h4>
          <i>{icon}</i>
          {title}
        </h4>
        <p>{text}</p>
      </div>
      <div className="lsg-art">{children}</div>
    </li>
  );
}

/** A tiny phone screen with a LINE-like green header. */
function Phone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lsg-phone" aria-hidden>
      <div className="lsg-phone-bar">{title}</div>
      <div className="lsg-phone-body">{children}</div>
    </div>
  );
}
