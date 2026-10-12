const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const date = (s) =>
  s
    ? new Date(s).toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
        timeZone: "Asia/Bangkok",
      })
    : "—";
const statuses = {
  review: "รอตรวจทาน",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  pending: "รอดำเนินการ",
  progress: "กำลังดำเนินการ",
  done: "เสร็จแล้ว",
};
const badge = (s) =>
  `<span class="badge ${esc(s)}">● ${statuses[s] || esc(s)}</span>`;
let config,
  state,
  page = "dashboard",
  authRegister = false,
  token = null,
  refreshToken = null,
  lastRefresh = 0,
  filter = "",
  statusFilter = "",
  busy = false;
const labels = {
  dashboard: "Executive Dashboard",
  inbox: "Data Inbox",
  projects: "Workflow & Projects",
  calendar: "Calendar",
  templates: "Data Templates",
  documents: "Document Archive",
  reports: "Reports & Export",
  team: "Team & Access",
  settings: "Integrations",
};
const icons = {
  dashboard: "▦",
  inbox: "▤",
  projects: "◈",
  calendar: "▦",
  templates: "⊞",
  documents: "▧",
  reports: "↗",
  team: "♧",
  settings: "⚙",
};
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 3500);
}
async function api(path, options = {}) {
  if (refreshToken && Date.now() - lastRefresh > 45 * 60000) {
    const r = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.firebaseApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      },
    );
    const d = await r.json();
    if (!r.ok) throw Error("กรุณาเข้าสู่ระบบใหม่");
    token = d.id_token;
    refreshToken = d.refresh_token;
    lastRefresh = Date.now();
  }
  const r = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw Object.assign(Error(d.error), { status: r.status });
  return d;
}
function authView() {
  $("#app").innerHTML =
    `<div class="auth"><section class="pitch"><div class="wordmark"><span class="mark">Z</span>ZettaFlow <span class="muted">AI</span></div><div class="eyebrow">ONE PLATFORM. YOUR WORKFLOW.</div><h1>ทุกบทสนทนา<br>คือจุดเริ่มต้นของ<br><em>งานที่เดินหน้า</em></h1><p>เชื่อมข้อมูลจากทีมของคุณ สกัดสิ่งสำคัญ<br>ตรวจทาน อนุมัติ และติดตามงานในที่เดียว</p><div class="flow"><span>01 / รับข้อมูล</span>→<span>02 / ตรวจทาน</span>→<span>03 / เดินหน้า</span></div></section><section class="signin"><form id="authForm"><div class="eyebrow">WELCOME TO YOUR WORKSPACE</div><h1>${authRegister ? "สร้าง workspace ของคุณ" : "กลับมาทำงานด้วยกัน"}</h1><p>${authRegister ? "เริ่มต้นจัดระบบข้อมูลให้ธุรกิจของคุณ" : "เข้าสู่ระบบเพื่อดูข้อมูลและงานของทีม"}</p>${authRegister ? '<label for="name">ชื่อของคุณ</label><input id="name" required autocomplete="name"><label for="company">ชื่อบริษัท</label><input id="company" required>' : ""}<label for="email">อีเมล</label><input id="email" type="email" required autocomplete="email"><label for="password">รหัสผ่าน</label><input id="password" type="password" required minlength="${authRegister ? 10 : 1}" autocomplete="${authRegister ? "new-password" : "current-password"}"><div class="error" id="authError" role="alert"></div><button class="primary full" type="submit">${authRegister ? "สร้าง workspace →" : "เข้าสู่ workspace →"}</button><button class="ghost full" type="button" data-action="switch-auth">${authRegister ? "มีบัญชีแล้ว? เข้าสู่ระบบ" : "ยังไม่มีบัญชี? สร้าง workspace"}</button><div class="note">${config.authMode === "local" ? "โหมดทดสอบบนเครื่อง · ข้อมูลบันทึกในฐานข้อมูลของเครื่องนี้ สร้างบัญชีใหม่เพื่อเริ่มใช้งาน" : "บัญชี Firebase · สมาชิกใหม่ต้องยืนยันอีเมลก่อนเข้าใช้งาน"}</div></form></section></div>`;
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $("#authError").textContent = "";
    const input = {
      email: $("#email").value,
      password: $("#password").value,
      register: authRegister,
      name: $("#name")?.value,
      company: $("#company")?.value,
    };
    try {
      if (config.authMode === "firebase") {
        if (!config.firebaseApiKey)
          throw Error("Server ยังไม่ได้ตั้งค่า Firebase Web API key");
        const method = authRegister ? "signUp" : "signInWithPassword";
        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(config.firebaseApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: input.email,
              password: input.password,
              returnSecureToken: true,
            }),
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw Error(
            "เข้าสู่ระบบไม่สำเร็จ ตรวจอีเมล รหัสผ่าน หรือบัญชีที่มีอยู่แล้ว",
          );
        if (authRegister) {
          const verification = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(config.firebaseApiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestType: "VERIFY_EMAIL",
                idToken: result.idToken,
              }),
            },
          );
          if (!verification.ok)
            throw Error("ส่งอีเมลยืนยันไม่สำเร็จ กรุณาตรวจ Firebase");
          authRegister = false;
          authView();
          toast("สร้างบัญชีแล้ว กรุณายืนยันอีเมล แล้วเข้าสู่ระบบ");
          return;
        }
        token = result.idToken;
        refreshToken = result.refreshToken;
        lastRefresh = Date.now();
        input.token = token;
      }
      await api("/auth", { method: "POST", body: input });
      await load();
    } catch (err) {
      $("#authError").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function load() {
  state = await api("/state");
  render();
}
const departments = () => [
  ...new Set([
    ...state.templates.map((t) => t.department),
    ...state.tasks.map((t) => t.department),
  ]),
];
function render() {
  const u = state.user,
    review = state.records.filter((r) => r.status === "review").length;
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><div class="wordmark"><span class="mark">Z</span>ZettaFlow <span class="muted">AI</span></div><div class="workspace-name"><span class="avatar">${esc(state.name[0])}</span><div><p>${esc(state.name)}</p><span class="muted">Business workspace</span></div></div><div class="nav-title">WORKSPACE</div><nav class="nav">${Object.entries(
      labels,
    )
      .filter(([k]) => u.role === "owner" || k !== "team")
      .map(
        ([key, label]) =>
          `<button data-page="${key}" class="${page === key ? "active" : ""}"><b>${icons[key]}</b>${label}${key === "inbox" && review ? `<span class="count">${review}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="side-bottom"><p>เปลี่ยนข้อมูลให้เป็นการตัดสินใจ<br>และงานที่ทีมติดตามได้</p><div class="realtime" style="margin-top:14px">${config.authMode === "local" ? "Local workspace" : "Cloud workspace"}</div></div></aside><section><header class="topbar"><button class="mobile-menu ghost" data-action="menu" aria-label="เปิดเมนู">☰</button><span class="crumb">Workspace / <strong>${labels[page]}</strong></span><div class="account"><span class="avatar">${esc(u.name[0])}</span><div><p>${esc(u.name)}</p><span class="muted">${esc(u.role.toUpperCase())}</span></div><button class="ghost" data-action="logout" aria-label="ออกจากระบบ">↪</button></div></header><main class="main"><div class="page-head"><div><div class="eyebrow">YOUR BUSINESS, CONNECTED</div><h1>${labels[page]}</h1><p>${{ dashboard: "ภาพรวมธุรกิจและงานที่ต้องตัดสินใจ", inbox: "ข้อมูลจาก Web และ LINE ที่พร้อมให้ทีมตรวจทาน", projects: "ติดตามงานหลังการอนุมัติ แยกตามสถานะและแผนก", calendar: "กำหนดส่งของงานที่ได้รับอนุมัติ", templates: "กำหนดข้อมูลและขั้นตอนที่เหมาะกับธุรกิจของคุณ", documents: "ค้นหาข้อมูลที่สกัด พร้อมชื่อเอกสารและข้อความต้นทาง", reports: "ข้อมูลที่อนุมัติแล้ว พร้อมส่งออกเพื่อวิเคราะห์ต่อ", team: "จัดการสมาชิกและสิทธิ์การเข้าถึงแต่ละแผนก", settings: "เชื่อมต่อ LINE และตรวจความพร้อมของระบบ" }[page]}</p></div><div class="actions"><button class="ghost" data-action="refresh" aria-label="รีเฟรชข้อมูล">↻</button>${state.user.role !== "viewer" ? '<button class="primary" data-action="ingest">＋ รับข้อมูลใหม่</button>' : ""}</div></div><div id="pageContent">${content()}</div><div class="footer"><span>ZettaFlow AI · One platform. Your workflow.</span><span id="syncTime">อัปเดต ${new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })} · รีเฟรชทุก 15 วินาที</span></div></main></section></div>`;
  if (page === "team") loadTeam();
  if (page === "settings" && state.user.role === "owner") loadGroups();
}
function empty(message, action = "") {
  return `<div class="empty"><div class="empty-icon">◇</div>${message}${action ? `<br><button data-action="${action}">เริ่มต้นใช้งาน →</button>` : ""}</div>`;
}
function recordsTable(records) {
  return records.length
    ? `<div class="table-wrap"><table><thead><tr><th>โครงการ / รายการ</th><th>แผนก</th><th>แหล่งข้อมูล</th><th>วันที่</th><th>สถานะ</th><th></th></tr></thead><tbody>${records.map((r) => `<tr><td><strong>${esc(r.values.project || r.template.name)}</strong><div class="muted">${esc(r.filename || r.template.name)}</div></td><td>${esc(r.department)}</td><td>${esc(r.source)} <span class="muted">${r.engine === "ai" ? "AI" : "ฟิลด์ตรง"}</span></td><td>${date(r.createdAt)}</td><td>${badge(r.status)}</td><td><button class="ghost" data-record="${r.id}">ดูรายละเอียด ↗</button></td></tr>`).join("")}</tbody></table></div>`
    : empty("ยังไม่มีรายการในมุมมองนี้", "ingest");
}
function totals() {
  const approved = state.records.filter((r) => r.status === "approved");
  return {
    sales: approved.reduce((sum, r) => sum + (r.values.sales || 0), 0),
    expense: approved.reduce(
      (sum, r) => sum + (r.values.expense || 0) + (r.values.rent || 0),
      0,
    ),
    pending: state.records.filter((r) => r.status === "review").length,
    active: state.tasks.filter((t) => t.status !== "done").length,
  };
}
function chart() {
  const rows = state.records
    .filter((r) => r.status === "approved" && r.values.sales != null)
    .slice(0, 14)
    .reverse();
  if (!rows.length)
    return empty("เมื่ออนุมัติรายงานยอดขายแล้ว กราฟจะแสดงข้อมูลจริงของบริษัท");
  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.values.sales || 0, r.values.expense || 0)),
  );
  const width = 600,
    bar = width / rows.length;
  return `<svg class="chart" viewBox="0 0 620 180" role="img" aria-label="ยอดขายและค่าใช้จ่ายของรายงานที่อนุมัติ ${rows.length} รายการ"><line x1="0" x2="600" y1="150" y2="150" stroke="#e8e9f1"/>${rows.map((r, i) => `<g><title>${esc(r.values.project)}: ยอดขาย ${money(r.values.sales)} ค่าใช้จ่าย ${money(r.values.expense)}</title><rect x="${i * bar + 8}" y="${150 - ((r.values.sales || 0) / max) * 125}" width="${bar * 0.25}" height="${((r.values.sales || 0) / max) * 125}" fill="#8565e5" rx="3"/><rect x="${i * bar + 8 + bar * 0.3}" y="${150 - ((r.values.expense || 0) / max) * 125}" width="${bar * 0.25}" height="${((r.values.expense || 0) / max) * 125}" fill="#f5a4be" rx="3"/><text x="${i * bar + 8}" y="172" fill="#9a97aa" font-size="9">${esc(r.values.date?.slice(5) || date(r.createdAt))}</text></g>`).join("")}</svg>`;
}
function dynamicWidgets() {
  return state.templates
    .map((t) => {
      const rows = state.records.filter(
        (r) => r.status === "approved" && r.template.id === t.id,
      );
      return t.fields
        .filter((f) => f.type === "number")
        .map((f) => {
          const values = rows
            .map((r) => r.values[f.key])
            .filter((v) => typeof v === "number");
          return (
            '<div class="metric"><div class="metric-top">' +
            esc(t.name) +
            '<span>∑</span></div><div class="value">' +
            money(values.reduce((sum, v) => sum + v, 0)) +
            "</div><small>" +
            esc(f.label) +
            " · " +
            values.length +
            " รายการที่อนุมัติ</small></div>"
          );
        })
        .join("");
    })
    .join("");
}
function content() {
  if (page === "dashboard") {
    const t = totals(),
      overdue = state.tasks.filter(
        (t) =>
          t.status !== "done" &&
          t.dueAt &&
          t.dueAt < new Date().toISOString().slice(0, 10),
      ).length;
    return `<div class="metrics">${[
      ["ยอดขายที่อนุมัติ", "฿ " + money(t.sales), "↗", "รวมจากฟิลด์ยอดขาย"],
      [
        "ค่าใช้จ่ายที่อนุมัติ",
        "฿ " + money(t.expense),
        "◈",
        "ค่าใช้จ่าย + ค่าเช่าที่บันทึก",
      ],
      ["รายการรอตรวจทาน", t.pending, "▤", "รอผู้มีสิทธิ์ตัดสินใจ"],
      ["งานที่กำลังดำเนินการ", t.active, "⊞", "งานหลังการอนุมัติ"],
    ]
      .map(
        ([label, value, icon, note]) =>
          `<div class="metric"><div class="metric-top">${label}<span>${icon}</span></div><div class="value">${value}</div><small>${note}</small></div>`,
      )
      .join(
        "",
      )}</div><section class="card" style="margin-bottom:22px"><div class="card-head"><h2>ข้อมูลตาม Data Template</h2><span class="muted">ปรับตามฟิลด์ตัวเลขที่กำหนด</span></div><div class="metrics" style="margin-bottom:0">${dynamicWidgets()}</div></section><div class="grid-main"><div><section class="card"><div class="card-head"><h2>ยอดขายและค่าใช้จ่าย</h2><span class="muted">รายงานล่าสุดที่อนุมัติแล้ว</span></div><div class="legend"><span><i class="dot"></i>ยอดขาย</span><span><i class="dot pink"></i>ค่าใช้จ่าย</span></div>${chart()}</section><section class="card" style="margin-top:22px"><div class="card-head"><h2>รายการล่าสุด</h2><button class="ghost" data-page="inbox">ดูทั้งหมด ↗</button></div>${recordsTable(state.records.slice(0, 5))}</section></div><div><section class="card insight"><div class="card-head"><h2>Workspace Summary</h2><span class="sparkle">✦</span></div><p>มี <strong>${t.pending} รายการ</strong> รอการตรวจทาน<br>ทีมกำลังดำเนินงาน <strong>${t.active} งาน</strong><br>งานเกินกำหนด <strong>${overdue} งาน</strong><br>ยอดขายที่อนุมัติแล้ว <strong>฿ ${money(t.sales)}</strong></p><p class="disclaimer">สรุปจากข้อมูลจริงที่คุณมีสิทธิ์ดู · คำนวณโดยระบบ</p></section><section class="card" style="margin-top:22px"><div class="card-head"><h2>Workflow ล่าสุด</h2><button class="ghost" data-page="projects">↗</button></div>${
      state.tasks.length
        ? state.tasks
            .slice(-4)
            .reverse()
            .map(
              (t) =>
                `<div class="list-item"><span class="status-icon">◈</span><div><p>${esc(t.name)}</p><span class="time">${esc(t.project)} · ${esc(t.department)}</span><div style="margin-top:7px">${badge(t.status)}</div></div></div>`,
            )
            .join("")
        : empty("อนุมัติพื้นที่ขายเพื่อเริ่ม Workflow ของทีม")
    }</section></div></div>`;
  }
  if (["inbox", "documents"].includes(page))
    return `<div class="toolbar"><input id="search" type="search" placeholder="ค้นหาโครงการ ข้อความ หรือชื่อไฟล์" value="${esc(filter)}" aria-label="ค้นหาข้อมูล"><select id="statusFilter" aria-label="กรองสถานะ"><option value="">ทุกสถานะ</option>${["review", "approved", "rejected"].map((s) => `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${statuses[s]}</option>`).join("")}</select></div><section class="card" id="recordsTable">${filteredTable()}</section>`;
  if (page === "projects")
    return `<div class="board">${["pending", "progress", "review", "done"]
      .map((s) => {
        const tasks = state.tasks.filter((t) => t.status === s);
        return `<section class="column"><h3>${statuses[s]} <span>${tasks.length}</span></h3>${tasks.map((t) => `<article class="task"><span class="badge">${esc(t.department)}</span><h3>${esc(t.name)}</h3><p>${esc(t.project)}</p>${t.dueAt ? `<div class="due">กำหนดส่ง ${date(t.dueAt)}</div>` : ""}${state.user.role !== "viewer" && t.status !== "done" ? `<select data-task="${t.id}" aria-label="สถานะ ${esc(t.name)}">${["pending", "progress", "review", "done"].map((v) => `<option value="${v}" ${v === s ? "selected" : ""}>${statuses[v]}</option>`).join("")}</select>` : badge(t.status)}</article>`).join("") || '<div class="empty">ยังไม่มีงาน</div>'}</section>`;
      })
      .join("")}</div>`;
  if (page === "calendar") {
    const tasks = state.tasks
      .filter((t) => t.dueAt)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return `<div class="calendar-list">${tasks.map((t) => `<div class="calendar-item"><div class="calendar-date">${date(t.dueAt)}</div><div><h3>${esc(t.name)}</h3><p>${esc(t.project)} · ${esc(t.department)}</p></div><div style="margin-left:auto">${badge(t.status)}</div></div>`).join("") || empty("ยังไม่มีงานที่กำหนดวันส่ง เลือกวันครบกำหนดขณะอนุมัติพื้นที่ขาย")}</div>`;
  }
  if (page === "templates")
    return `${state.user.role === "owner" ? '<div class="actions" style="margin-bottom:20px"><button class="primary" data-action="template">＋ สร้าง Data Template</button></div>' : ""}<div class="subgrid">${state.templates.map((t) => `<article class="template"><span class="badge">${esc(t.department)}</span><h2>${esc(t.name)}</h2>${state.user.role === "owner" ? `<button class="ghost" data-edit-template="${t.id}">แก้ไข Template</button>` : ""}<p>${t.fields.length} ฟิลด์ข้อมูล · ${t.steps.length} งานต่อเนื่องหลังอนุมัติ</p><div class="chips">${t.fields.map((f) => `<span>${esc(f.label)}${f.required ? " *" : ""}</span>`).join("")}</div><p>${t.steps.map((s) => esc(s.department)).join(" → ") || "ตรวจทานและบันทึกข้อมูล"}</p>${state.user.role !== "viewer" ? `<button style="margin-top:20px" data-ingest-template="${t.id}">รับข้อมูลด้วย Template นี้ ↗</button>` : ""}</article>`).join("") || empty("ยังไม่มี Template ที่บัญชีนี้มีสิทธิ์ดู")}</div>`;
  if (page === "reports") {
    const t = totals();
    return `<div class="settings-grid"><section class="card"><div class="card-head"><h2>รายงานของบริษัท</h2><button data-action="export" class="primary">↓ Export CSV</button></div><p class="muted">ส่งออกเฉพาะรายการของแผนกที่บัญชีนี้มีสิทธิ์เข้าถึง</p><div class="list-item"><p>ยอดขายที่อนุมัติ</p><strong style="margin-left:auto">฿ ${money(t.sales)}</strong></div><div class="list-item"><p>ค่าใช้จ่ายและค่าเช่าที่อนุมัติ</p><strong style="margin-left:auto">฿ ${money(t.expense)}</strong></div><div class="list-item"><p>ข้อมูลทั้งหมดที่เข้าถึงได้</p><strong style="margin-left:auto">${state.records.length} รายการ</strong></div></section><section class="card"><h2>ประวัติการดำเนินการ</h2>${
      state.audit
        .slice(0, 8)
        .map(
          (a) =>
            `<div class="list-item"><div><p>${esc(a.action)}</p><span class="time">${date(a.at)} · ${esc(a.actor.slice(0, 8))}</span></div></div>`,
        )
        .join("") || empty("ยังไม่มีประวัติที่แสดงได้")
    }</section></div>`;
  }
  if (page === "team")
    return `<section class="card"><div class="card-head"><h2>สมาชิกใน workspace</h2><button class="primary" data-action="invite">＋ เพิ่มคำเชิญ</button></div><div id="teamTable" aria-live="polite">กำลังโหลด…</div><div class="note">คำเชิญมีอายุ 7 วัน สมาชิกต้องสร้างบัญชีด้วยอีเมลที่ได้รับคำเชิญ ระบบนี้ยังไม่ส่งอีเมลคำเชิญอัตโนมัติ</div></section>`;
  if (page === "settings" && state.user.role !== "owner")
    return `<section class="card"><h2>เชื่อมบัญชี LINE ของคุณ</h2><div class="note">ใช้คำสั่งในกลุ่ม LINE ที่ Owner เชื่อมแล้ว โดยสิทธิ์อนุมัติยังเป็นไปตามบทบาทและแผนกของบัญชีเว็บ</div>${state.user.role !== "viewer" ? '<button class="primary" data-action="link-user">สร้างรหัสเชื่อมบัญชี 10 นาที</button>' : "บัญชี Viewer ดูข้อมูลได้อย่างเดียว"}<div id="linkCommand"></div></section>`;
  if (page === "settings")
    return `<div class="settings-grid"><section class="card"><div class="card-head"><h2>LINE Messaging API</h2><span class="badge ${config.lineReady ? "approved" : ""}">${config.lineReady ? "ตั้งค่า Secret แล้ว" : "รอการตั้งค่า"}</span></div><p>เพิ่มบอทในกลุ่ม LINE แล้วสร้างรหัสเชื่อมต่อสำหรับกลุ่มนั้น ระบบจะจับคู่กลุ่มกับบริษัทและ Template จากข้อความที่ LINE ส่งมาจริง</p><label for="lineTemplate">Data Template ของกลุ่ม</label><select id="lineTemplate">${state.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select><button data-action="pair" class="primary full" ${!config.lineReady ? "disabled" : ""}>สร้างรหัสเชื่อมต่อ 10 นาที</button><div id="pairCommand"></div><button data-action="link-user" class="full">เชื่อมบัญชี LINE เพื่ออนุมัติ</button><div id="linkCommand"></div><h3>กลุ่มที่เชื่อมต่อแล้ว</h3><div id="groups">กำลังโหลด…</div></section><section class="card"><h2>สถานะระบบ</h2><div class="list-item"><p>ฐานข้อมูล / Authentication</p><span class="badge approved" style="margin-left:auto">${config.authMode === "local" ? "SQLite / Local" : "Firestore / Firebase"}</span></div><div class="list-item"><p>AI Extraction & OCR</p><span class="badge ${config.aiReady ? "approved" : ""}" style="margin-left:auto">${config.aiReady ? "พร้อมใช้งาน" : "ยังไม่ได้ตั้งค่า"}</span></div><div class="note">${config.aiReady ? "AI จะอ่านข้อมูลตาม Template แล้วส่งให้คนตรวจทานก่อนอนุมัติ" : "ขณะนี้อ่านเฉพาะข้อความรูปแบบ “ชื่อฟิลด์: ค่า” ได้ ยังไม่ใช้ AI และยังอ่านภาพ/PDF ไม่ได้"}</div><p>การใช้งาน Cloud ต้องตั้งค่า Firebase credentials, AI key และ LINE credentials บน server ดูคู่มือใน repo สำหรับการ deploy</p><div class="code">Webhook: ${esc(location.origin)}/api/line/webhook</div><p style="margin-top:15px">รับไฟล์สูงสุด ${Math.round(config.maxUploadBytes / 1000)} KB · รูปภาพและ PDF</p></section></div>`;
}
function filteredTable() {
  const q = filter.toLowerCase();
  return recordsTable(
    state.records.filter(
      (r) =>
        (!statusFilter || r.status === statusFilter) &&
        `${r.values.project || ""} ${r.raw} ${r.filename || ""} ${r.template.name}`
          .toLowerCase()
          .includes(q),
    ),
  );
}
function modal(title, body, footer = "") {
  $("#modalBody").innerHTML =
    `<div class="dialog-head"><h2>${title}</h2><button class="ghost" data-action="close" aria-label="ปิดหน้าต่าง">✕</button></div>${body}<div id="modalError" class="error" role="alert"></div>${footer}`;
  $("#modal").showModal();
}
const fieldInput = (f, value) =>
  `<label for="value_${f.key}">${esc(f.label)}${f.required ? " *" : ""}</label><input id="value_${f.key}" name="${f.key}" type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}" ${f.type === "number" ? 'step="any"' : ""} value="${esc(value ?? "")}" ${f.required ? "required" : ""}>`;
function ingestModal(templateId = "") {
  modal(
    "รับข้อมูลใหม่",
    `<form id="ingestForm"><label for="templateSelect">Data Template</label><select id="templateSelect">${state.templates.map((t) => `<option value="${t.id}" ${t.id === templateId ? "selected" : ""}>${esc(t.name)} · ${esc(t.department)}</option>`).join("")}</select><div class="note">${config.aiReady ? "ส่งข้อความตามที่ทีมพูดคุย หรือแนบภาพ/PDF แล้วให้ AI สกัดข้อมูล" : "โหมดพื้นฐาน: ใช้ชื่อฟิลด์ตาม Template คั่นด้วย : และขึ้นบรรทัดใหม่ เช่น โครงการ: The Promenade"}</div><label for="rawMessage">ข้อความต้นทาง</label><textarea id="rawMessage" placeholder="โครงการ: The Promenade&#10;สถานที่: เดอะพรอมานาด&#10;พื้นที่: 33&#10;ค่าเช่า: 55000&#10;วันเริ่ม: 2026-10-16&#10;วันสิ้นสุด: 2026-10-28"></textarea><label for="attachment">แนบภาพหรือ PDF ${config.aiReady ? "" : "(ต้องตั้งค่า AI ก่อน)"}</label><input id="attachment" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" ${config.aiReady ? "" : "disabled"}><div class="form-footer"><button type="button" data-action="example">ใช้ข้อความตัวอย่าง</button><button class="primary" type="submit">สกัดข้อมูล →</button></div></form>`,
  );
  $("#ingestForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    try {
      const file = $("#attachment").files[0];
      let attachment;
      if (file) {
        if (file.size > config.maxUploadBytes) throw Error("ไฟล์ใหญ่เกินกำหนด");
        const data = await new Promise((r, j) => {
          const reader = new FileReader();
          reader.onload = () => r(reader.result.split(",")[1]);
          reader.onerror = j;
          reader.readAsDataURL(file);
        });
        attachment = { name: file.name, type: file.type, data };
      }
      const result = await api("/ingest", {
        method: "POST",
        body: {
          templateId: $("#templateSelect").value,
          raw: $("#rawMessage").value,
          attachment,
        },
      });
      button.textContent = "กำลังประมวลผล…";
      for (let i = 0; i < 65; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await api(`/jobs/${result.jobId}`);
        if (job.status === "failed") throw Error(job.error);
        if (job.status === "done") {
          $("#modal").close();
          page = "inbox";
          await load();
          toast("สกัดข้อมูลแล้ว พร้อมตรวจทาน");
          return;
        }
      }
      $("#modal").close();
      toast("กำลังประมวลผลเบื้องหลัง กลับมาตรวจใน Data Inbox");
    } catch (err) {
      $("#modalError").textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = "สกัดข้อมูล →";
    }
  };
}
function recordModal(recordId) {
  const r = state.records.find((r) => r.id === recordId);
  if (!r) return;
  const canDecide =
    ["owner", "manager"].includes(state.user.role) && r.status === "review";
  modal(
    "ตรวจทานข้อมูล",
    `<p class="muted" style="margin-top:8px">${esc(r.template.name)} · ${esc(r.source)} · ${date(r.createdAt)}</p><div class="original">${esc(r.raw || r.filename || "เอกสารแนบ")}</div>${r.attachment ? `<button data-download="${r.id}">↓ ดาวน์โหลดเอกสารต้นฉบับ</button>` : ""}${r.missing.length ? `<div class="note">ยังขาดข้อมูล: ${r.missing.map(esc).join(", ")}</div>` : ""}<form id="decisionForm"><div class="form-grid">${r.template.fields.map((f) => fieldInput(f, r.values[f.key])).join("")}</div>${canDecide ? `<label for="dueAt">วันครบกำหนดของงานใน Workflow (ถ้ามี)</label><input id="dueAt" type="date"><label for="reason">เหตุผลเมื่อไม่อนุมัติ</label><input id="reason" maxlength="1000"><div class="form-footer"><button class="danger" type="button" data-reject="${r.id}">ไม่อนุมัติ</button><button class="primary" type="submit">อนุมัติและสร้าง Workflow →</button></div>` : `<div class="note">${statuses[r.status]}${r.reason ? " · " + esc(r.reason) : ""}</div>`}</form>`,
  );
  if (!canDecide)
    $("#decisionForm")
      .querySelectorAll("input")
      .forEach((el) => (el.disabled = true));
  $("#decisionForm").onsubmit = async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      const values = Object.fromEntries(
        r.template.fields.map((f) => {
          const value = $(`#value_${f.key}`).value;
          return [
            f.key,
            value === "" ? null : f.type === "number" ? Number(value) : value,
          ];
        }),
      );
      await api(`/records/${r.id}`, {
        method: "PATCH",
        body: { status: "approved", values, dueAt: $("#dueAt").value || null },
      });
      $("#modal").close();
      await load();
      toast("อนุมัติแล้ว งานของทีมถูกสร้างเรียบร้อย");
    } catch (err) {
      $("#modalError").textContent = err.message;
      e.submitter.disabled = false;
    }
  };
}
function templateModal(templateId = "") {
  const existing = state.templates.find((t) => t.id === templateId);
  modal(
    existing ? "แก้ไข Data Template" : "สร้าง Data Template",
    `<form id="templateForm"><div class="form-grid"><div><label for="templateName">ชื่อ Template</label><input id="templateName" required maxlength="200"></div><div><label for="templateDepartment">แผนก</label><input id="templateDepartment" required maxlength="200" list="departments"><datalist id="departments">${departments()
      .map((d) => `<option>${esc(d)}</option>`)
      .join(
        "",
      )}</datalist></div></div><label>ฟิลด์ข้อมูล <span class="muted">รหัส / ชื่อ / ประเภท / บังคับ</span></label><div id="fields"></div><button type="button" data-action="add-field" style="margin-top:12px">＋ เพิ่มฟิลด์</button><label>งานที่สร้างหลังอนุมัติ</label><div id="steps"></div><button type="button" data-action="add-step" style="margin-top:12px">＋ เพิ่มงาน</button><div class="form-footer"><button class="primary" type="submit">บันทึก Template</button></div></form>`,
  );
  if (existing) {
    $("#templateName").value = existing.name;
    $("#templateDepartment").value = existing.department;
    existing.fields.forEach((f) => addField(f));
    existing.steps.forEach((s) => addStep(s));
  } else addField();
  $("#templateForm").onsubmit = async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      const fields = [...document.querySelectorAll(".field-row")].map(
        (row) => ({
          key: row.querySelector("[name=key]").value,
          label: row.querySelector("[name=label]").value,
          type: row.querySelector("select").value,
          required: row.querySelector("[type=checkbox]").checked,
        }),
      );
      const steps = [...document.querySelectorAll(".step-row")].map((row) => ({
        name: row.querySelector("[name=name]").value,
        department: row.querySelector("[name=department]").value,
      }));
      await api(existing ? `/templates/${existing.id}` : "/templates", {
        method: existing ? "PATCH" : "POST",
        body: {
          name: $("#templateName").value,
          department: $("#templateDepartment").value,
          fields,
          steps,
        },
      });
      $("#modal").close();
      await load();
      toast("สร้าง Template แล้ว");
    } catch (err) {
      $("#modalError").textContent = err.message;
      e.submitter.disabled = false;
    }
  };
}
function addField(field) {
  const row = document.createElement("div");
  row.className = "field-row";
  row.innerHTML =
    '<input name="key" aria-label="รหัสฟิลด์" placeholder="sales" required pattern="[a-z][a-z0-9_]*" maxlength="40"><input name="label" aria-label="ชื่อฟิลด์" placeholder="ยอดขาย" required maxlength="200"><select aria-label="ประเภทฟิลด์"><option value="text">ข้อความ</option><option value="number">ตัวเลข</option><option value="date">วันที่</option></select><label><input type="checkbox" aria-label="ข้อมูลบังคับ"></label><button class="ghost" type="button" data-remove="row" aria-label="ลบฟิลด์">×</button>';
  $("#fields").append(row);
  if (field) {
    row.querySelector("[name=key]").value = field.key;
    row.querySelector("[name=label]").value = field.label;
    row.querySelector("select").value = field.type;
    row.querySelector("[type=checkbox]").checked = field.required;
  }
}
function addStep(step) {
  const row = document.createElement("div");
  row.className = "step-row";
  row.innerHTML =
    '<input name="name" placeholder="ชื่อของงาน" aria-label="ชื่องาน" required maxlength="200"><input name="department" placeholder="แผนก" aria-label="แผนกของงาน" required maxlength="200"><button class="ghost" type="button" data-remove="row" aria-label="ลบงาน">×</button>';
  $("#steps").append(row);
  if (step) {
    row.querySelector("[name=name]").value = step.name;
    row.querySelector("[name=department]").value = step.department;
  }
}
async function loadTeam() {
  try {
    const team = await api("/team");
    if (!$("#teamTable")) return;
    $("#teamTable").innerHTML =
      `<div class="table-wrap"><table><thead><tr><th>สมาชิก</th><th>บทบาท</th><th>แผนกที่เข้าถึงได้</th><th>สถานะ</th><th></th></tr></thead><tbody>${team.map((u) => `<tr><td><strong>${esc(u.name)}</strong><div class="muted">${esc(u.email)}</div></td><td>${esc(u.role)}</td><td>${u.role === "owner" ? "ทุกแผนก" : u.departments.map(esc).join(", ")}</td><td>${u.disabled ? "ระงับ" : "ใช้งาน"}</td><td>${u.role !== "owner" ? `<button data-member="${u.uid}" data-disabled="${!u.disabled}">${u.disabled ? "เปิดใช้งาน" : "ระงับสิทธิ์"}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  } catch (err) {
    if ($("#teamTable")) $("#teamTable").textContent = err.message;
  }
}
function inviteModal() {
  modal(
    "เพิ่มคำเชิญสมาชิก",
    `<form id="inviteForm"><label for="inviteEmail">อีเมลสมาชิกใหม่</label><input id="inviteEmail" type="email" required><label for="inviteRole">บทบาท</label><select id="inviteRole"><option value="manager">Manager · ตรวจทานและอนุมัติ</option><option value="staff">Staff · ส่งข้อมูลและอัปเดตงาน</option><option value="viewer">Viewer · ดูข้อมูลและส่งออก</option></select><label>แผนกที่เข้าถึงได้</label>${departments()
      .map(
        (d) =>
          `<label><input type="checkbox" name="department" value="${esc(d)}"> ${esc(d)}</label>`,
      )
      .join(
        "",
      )}<div class="note">ให้สมาชิกสร้างบัญชีด้วยอีเมลนี้ภายใน 7 วัน เพื่อเข้าบริษัทของคุณ</div><div class="form-footer"><button class="primary" type="submit">บันทึกคำเชิญ</button></div></form>`,
  );
  $("#inviteForm").onsubmit = async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      await api("/invites", {
        method: "POST",
        body: {
          email: $("#inviteEmail").value,
          role: $("#inviteRole").value,
          departments: [
            ...document.querySelectorAll("[name=department]:checked"),
          ].map((el) => el.value),
        },
      });
      $("#modal").close();
      toast("บันทึกคำเชิญแล้ว");
    } catch (err) {
      $("#modalError").textContent = err.message;
      e.submitter.disabled = false;
    }
  };
}
async function loadGroups() {
  try {
    const groups = await api("/line/groups");
    if ($("#groups"))
      $("#groups").innerHTML = groups.length
        ? groups
            .map(
              (g) =>
                `<div class="code">${esc(g.groupId)}<br>${esc(state.templates.find((t) => t.id === g.templateId)?.name)}</div>`,
            )
            .join("")
        : "<p>ยังไม่มีกลุ่มที่เชื่อมต่อ</p>";
  } catch (err) {
    if ($("#groups")) $("#groups").textContent = err.message;
  }
}
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    filter = e.target.value;
    $("#recordsTable").innerHTML = filteredTable();
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (e.target.id === "statusFilter") {
      statusFilter = e.target.value;
      $("#recordsTable").innerHTML = filteredTable();
    }
    if (e.target.dataset.task) {
      await api(`/tasks/${e.target.dataset.task}`, {
        method: "PATCH",
        body: { status: e.target.value },
      });
      await load();
      toast("อัปเดตงานแล้ว");
    }
  } catch (err) {
    toast(err.message);
    await load();
  }
});
document.addEventListener("click", async (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.page) {
      page = button.dataset.page;
      filter = "";
      statusFilter = "";
      render();
      return;
    }
    if (button.dataset.editTemplate)
      return templateModal(button.dataset.editTemplate);
    if (button.dataset.download) {
      const r = await fetch(`/api/files/${button.dataset.download}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw Error("ดาวน์โหลดไม่สำเร็จ");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = state.records.find(
        (r) => r.id === button.dataset.download,
      ).filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (button.dataset.record) return recordModal(button.dataset.record);
    if (button.dataset.ingestTemplate)
      return ingestModal(button.dataset.ingestTemplate);
    if (button.dataset.remove) {
      button.parentElement.remove();
      return;
    }
    if (button.dataset.reject) {
      await api(`/records/${button.dataset.reject}`, {
        method: "PATCH",
        body: { status: "rejected", reason: $("#reason").value },
      });
      $("#modal").close();
      await load();
      toast("ไม่อนุมัติ พร้อมบันทึกเหตุผล");
      return;
    }
    if (button.dataset.member) {
      await api(`/team/${button.dataset.member}`, {
        method: "PATCH",
        body: { disabled: button.dataset.disabled === "true" },
      });
      await loadTeam();
      toast("อัปเดตสิทธิ์แล้ว");
      return;
    }
    const action = button.dataset.action;
    if (action === "switch-auth") {
      authRegister = !authRegister;
      authView();
    }
    if (action === "logout") {
      await api("/logout", { method: "POST" });
      token = null;
      refreshToken = null;
      state = null;
      authView();
    }
    if (action === "close") $("#modal").close();
    if (action === "menu") $(".shell").classList.toggle("menu-open");
    if (action === "refresh") {
      await load();
      toast("อัปเดตข้อมูลแล้ว");
    }
    if (action === "ingest") ingestModal();
    if (action === "template") templateModal();
    if (action === "add-field") addField();
    if (action === "add-step") addStep();
    if (action === "invite") inviteModal();
    if (action === "example") {
      const template = state.templates.find(
        (t) => t.id === $("#templateSelect").value,
      );
      $("#rawMessage").value = template.fields
        .map(
          (f) =>
            `${f.label}: ${f.type === "date" ? new Date().toISOString().slice(0, 10) : f.type === "number" ? 55000 : f.key === "project" ? "The Promenade" : f.key === "location" ? "เดอะพรอมานาด" : "ข้อมูลตัวอย่าง"}`,
        )
        .join("\n");
    }
    if (action === "link-user") {
      const result = await api("/line/link-user", { method: "POST" });
      $("#linkCommand").innerHTML =
        `<div class="note">พิมพ์คำสั่งนี้ในกลุ่มที่เชื่อมแล้วภายใน 10 นาที จากบัญชี LINE ของคุณเท่านั้น</div><div class="code">${esc(result.command)}</div>`;
    }
    if (action === "pair") {
      const result = await api("/line/pair", {
        method: "POST",
        body: { templateId: $("#lineTemplate").value },
      });
      $("#pairCommand").innerHTML =
        `<div class="note">พิมพ์ข้อความนี้ในกลุ่ม LINE ที่มีบอทภายใน 10 นาที</div><div class="code">${esc(result.command)}</div>`;
    }
    if (action === "export") {
      const response = await fetch("/api/export", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw Error("ส่งออกไม่สำเร็จ");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "zettaflow.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (err) {
    if ($("#modal").open) $("#modalError").textContent = err.message;
    else toast(err.message);
  }
});
setInterval(async () => {
  if (
    !state ||
    busy ||
    $("#modal").open ||
    (["inbox", "documents"].includes(page) &&
      $("#search") === document.activeElement)
  )
    return;
  busy = true;
  try {
    state = await api("/state");
    render();
  } catch (err) {
    if (err.status === 401) {
      state = null;
      authView();
    } else toast(err.message);
  } finally {
    busy = false;
  }
}, 15000);
try {
  config = await api("/config");
  if (config.authMode === "local") {
    try {
      await load();
    } catch {
      authView();
    }
  } else authView();
} catch (err) {
  $("#app").innerHTML =
    `<div class="boot"><p>${esc(err.message)}</p><p>เปิดเว็บผ่าน npm start เพื่อเชื่อมต่อ backend</p></div>`;
}
