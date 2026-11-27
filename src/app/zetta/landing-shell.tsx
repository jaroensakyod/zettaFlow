// Shared EliteFlow marketing header, footer and logo for the public pages (/ and /pricing).
import Link from "next/link";

export const SIGNUP = "/feed?signup=1";
export const LOGIN = "/feed";

export function Logo() {
  return (
    <span className="lp-logo">
      <img src="/brand/eliteflow-mark.png" alt="" width={36} height={36} />
      <span>
        <b>EliteFlow</b>
        <small>Your Business. One Workspace.</small>
      </span>
    </span>
  );
}

export function LandingHeader({ home = true }: { home?: boolean }) {
  const at = (hash: string) => (home ? hash : "/" + hash);
  return (
    <header className="lp-header">
      <Link href="/" aria-label="EliteFlow หน้าแรก">
        <Logo />
      </Link>
      <nav aria-label="เมนูหลัก">
        <a href={at("#live")}>สั่งงานผ่าน LINE</a>
        <a href={at("#product")}>Product</a>
        <a href={at("#solutions")}>Solutions</a>
        <Link href="/pricing">แพ็กเกจ</Link>
        <a href={at("#faq")}>FAQ</a>
      </nav>
      <div className="lp-header-cta">
        <a href="/demo" className="lp-link">
          ดูตัวอย่าง
        </a>
        <Link href={LOGIN} className="lp-link">
          เข้าสู่ระบบ
        </Link>
        <Link href={SIGNUP} className="lp-btn primary sm">
          ใช้ฟรี
        </Link>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="lp-footer" id="contact">
      <div>
        <Logo />
        <p>ระบบบริหารธุรกิจ เครือข่ายบริษัท และผู้ช่วย AI ในที่เดียว</p>
        {/* As registered with the Department of Business Development (หนังสือรับรอง E86001920000782, 27 พ.ย. 2569). */}
        <address className="lp-legal">
          <b>บริษัท อีลิทโฟลว์ จำกัด</b>
          <span>เลขทะเบียนนิติบุคคล / เลขประจำตัวผู้เสียภาษี 0135569035949</span>
          <span>สำนักงานใหญ่ 23 หมู่ 7 ตำบลบึงคอไห อำเภอลำลูกกา จังหวัดปทุมธานี</span>
        </address>
      </div>
      <div>
        <h4>ติดต่อ</h4>
        <a href="mailto:Sirisoaa@gmail.com">Sirisoaa@gmail.com</a>
        <a href="tel:0960041231">096-004-1231</a>
        <span>LINE: siri_studio</span>
      </div>
      <div>
        <h4>ผลิตภัณฑ์</h4>
        <Link href="/pricing">แพ็กเกจและราคา</Link>
        <Link href={LOGIN}>เข้าสู่ระบบ EliteFlow</Link>
        <a href="/demo">ระบบตัวอย่าง</a>
      </div>
      <small>© 2026 บริษัท อีลิทโฟลว์ จำกัด · EliteFlow</small>
    </footer>
  );
}
