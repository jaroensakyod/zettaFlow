// A realistic company for the demo: บริษัท ศิริ สตูดิโอ จำกัด, a Bangkok apparel brand that also builds
// pop-up booths and events. Every page has believable rows (dates relative to today, ~4 months of history)
// so น้องโฟลว์ and the dashboards can be tested against data that looks like a real office.
// Deterministic: the same seed always produces the same records.

type Add = (kind: string, data: Record<string, unknown>) => string;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedCompany(add: Add, now = Date.now()) {
  const rand = rng(2569);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const round = (n: number, to = 10) => Math.round(n / to) * to;
  const day = (n: number) => new Date(now + 7 * 3600000 + n * 86400000).toISOString().slice(0, 10);
  const month = (n: number) => day(n).slice(0, 7);
  const yy = (new Date(now + 7 * 3600000).getUTCFullYear() + 543) % 100;
  const code = (p: string, n: number) => `${p}-${yy}-${String(n).padStart(4, "0")}`;

  // ---------- People ----------
  const staff = [
    ["ศิริกัลยา วงศ์ทอง", "ศิริ", "Operations", "กรรมการผู้จัดการ", "ผู้บริหาร", 120000, -2100],
    ["ธนพล ศรีสุข", "ต้น", "Sales", "ผู้จัดการฝ่ายขาย", "ผู้จัดการ", 65000, -1500],
    ["นภา ใจดี", "นภา", "Sales", "Sales Executive", "พนักงาน", 28000, -620],
    ["ปิยะพงษ์ มั่นคง", "เบียร์", "Sales", "Key Account", "พนักงาน", 32000, -410],
    ["วรรณิษา แก้วใส", "แพรว", "Marketing", "Marketing Manager", "ผู้จัดการ", 55000, -980],
    ["กิตติพัฒน์ บุญมา", "กิต", "Marketing", "Content Creator", "พนักงาน", 26000, -150],
    ["อรุณี ทองดี", "อร", "Finance", "หัวหน้าบัญชี", "หัวหน้างาน", 48000, -1800],
    ["สุภาวดี จันทร์เพ็ญ", "แพท", "Finance", "เจ้าหน้าที่บัญชี", "พนักงาน", 24000, -300],
    ["สมชาย ใจกล้า", "ชาย", "Warehouse", "หัวหน้าคลังสินค้า", "หัวหน้างาน", 30000, -1400],
    ["อนุชา พรมแดง", "นุ", "Warehouse", "พนักงานคลัง", "พนักงาน", 16500, -260],
    ["ชนิดา รัตนพันธ์", "ดา", "HR", "HR Manager", "ผู้จัดการ", 52000, -1200],
    ["ณัฐวุฒิ เพชรรัตน์", "ณัฐ", "IT", "IT Support", "พนักงาน", 30000, -540],
    ["พิมพ์ชนก สายบุญ", "พิม", "Design", "Senior Designer", "หัวหน้างาน", 45000, -880],
    ["ภาณุวัฒน์ ศรีวงศ์", "ภาณุ", "Design", "3D Designer", "พนักงาน", 30000, -45],
    ["จิราพร มีสุข", "จิ", "Purchasing", "เจ้าหน้าที่จัดซื้อ", "พนักงาน", 25000, -700],
    ["วีรยุทธ ทองคำ", "วี", "Business Development", "Business Development", "พนักงาน", 38000, -330],
  ] as const;
  const emp: string[] = [];
  staff.forEach(([name, nickname, department, position, level, salary, start], i) => {
    emp.push(
      add("employees", {
        name, nickname, department, position, level, salary,
        code: `EMP-${String(i + 1).padStart(3, "0")}`,
        employmentType: i === 13 ? "สัญญาจ้าง" : "ประจำ",
        startDate: day(start),
        branch: department === "Warehouse" ? "คลังบางนา" : "สำนักงานใหญ่ พระราม 9",
        phone: `08${between(1, 9)}-${between(100, 999)}-${between(1000, 9999)}`,
        email: `staff${i + 1}@siristudio.co.th`,
        leaveQuota: 10,
        score: between(70, 96),
        status: start > -120 ? "probation" : i === 9 ? "on_leave" : "active",
      }),
    );
  });
  const person = (i: number) => staff[i][0];
  ["มานพ (SUP)", "ขวัญใจ (PC)", "ศุภชัย (PT)", "ลลิตา (MC)", "ธีรภัทร (PC)", "อัญชลี (PT)"].forEach((name, i) =>
    add("freelancers", {
      name, role: ["SUP", "PC", "PT", "MC", "PC", "PT"][i], wage: [1500, 900, 650, 3500, 900, 650][i],
      phone: `09${between(1, 9)}-${between(100, 999)}-${between(1000, 9999)}`,
      status: i < 3 ? "assigned" : "available",
    }),
  );

  // ---------- Directory ----------
  const customerRows = [
    ["บริษัท เซ็นทรัล รีเทล คอร์ปอเรชั่น จำกัด", "vip", 45, 800000, "คุณวิภาวดี"],
    ["บริษัท สยามพิวรรธน์ จำกัด", "vip", 30, 600000, "คุณกฤษณ์"],
    ["บริษัท เดอะมอลล์ กรุ๊ป จำกัด", "regular", 30, 400000, "คุณศศิธร"],
    ["บริษัท ไทยเบฟเวอเรจ จำกัด (มหาชน)", "vip", 60, 1000000, "คุณอนันต์"],
    ["บริษัท แสนสิริ จำกัด (มหาชน)", "regular", 30, 300000, "คุณพรรณี"],
    ["บริษัท ฟู้ดแลนด์ ซุปเปอร์มาร์เก็ต จำกัด", "standard", 15, 150000, "คุณชาตรี"],
    ["ร้าน บ้านผ้าไหม เชียงใหม่", "standard", 7, 50000, "คุณบัวผัน"],
    ["บริษัท โรบินสัน จำกัด (มหาชน)", "regular", 30, 350000, "คุณปวีณา"],
    ["บริษัท เอเชียทีค เดอะ ริเวอร์ฟร้อนท์ จำกัด", "regular", 30, 250000, "คุณเกียรติ"],
    ["บริษัท ทรู คอร์ปอเรชั่น จำกัด (มหาชน)", "vip", 45, 700000, "คุณมนัส"],
    ["คุณสมศรี รักไทย (ลูกค้ารายย่อย)", "standard", 0, 20000, "คุณสมศรี"],
    ["บริษัท ไอคอนสยาม จำกัด", "vip", 30, 900000, "คุณธิดารัตน์"],
  ] as const;
  const cus = customerRows.map(([name, segment, creditDays, creditLimit, contact], i) =>
    add("customers", {
      name, segment, creditDays, creditLimit, contact,
      code: code("CUS", i + 1),
      type: name.startsWith("คุณ") || name.startsWith("ร้าน") ? "บุคคลธรรมดา" : "นิติบุคคล",
      taxId: name.startsWith("บริษัท") ? `0105${between(500000000, 599999999)}` : "",
      phone: `02-${between(100, 999)}-${between(1000, 9999)}`,
      email: name.startsWith("บริษัท") ? `purchasing${i + 1}@example.co.th` : "",
      ownerId: emp[pick([1, 2, 3])],
      address: pick(["ปทุมวัน กรุงเทพฯ", "บางรัก กรุงเทพฯ", "คลองเตย กรุงเทพฯ", "ห้วยขวาง กรุงเทพฯ", "เมือง เชียงใหม่"]),
      status: i === 6 ? "inactive" : "active",
    }),
  );
  const supplierRows = [
    ["บริษัท สยามเท็กซ์ไทล์ จำกัด", "สินค้า / วัตถุดิบ", "หลัก", "ผ้าฝ้าย ผ้าลินิน", 30, 4.6],
    ["บริษัท ไทยการ์เมนต์ แฟคตอรี่ จำกัด", "สินค้า / วัตถุดิบ", "หลัก", "ตัดเย็บเสื้อผ้า OEM", 45, 4.3],
    ["หจก. ป้ายดีไซน์ พริ้นท์", "บริการ", "หลัก", "งานพิมพ์ป้าย ไวนิล สติกเกอร์", 15, 4.1],
    ["บริษัท Siam Display จำกัด", "สินค้า / วัตถุดิบ", "หลัก", "ชั้นวาง หุ่นโชว์ อุปกรณ์บูธ", 30, 4.5],
    ["บริษัท แฮงเกอร์โปร จำกัด", "สินค้า / วัตถุดิบ", "สำรอง", "ไม้แขวนเสื้อ ป้ายแท็ก", 30, 3.9],
    ["บริษัท ไลท์ติ้ง แอนด์ ซาวด์ จำกัด", "บริการ", "หลัก", "เช่าเวที แสง เสียง", 15, 4.4],
    ["บริษัท ขนส่งด่วนไทย จำกัด", "บริการ", "หลัก", "ขนส่งสินค้า รถ 6 ล้อ / กระบะ", 7, 4.0],
    ["บริษัท แพ็คเกจจิ้ง พลัส จำกัด", "สินค้า / วัตถุดิบ", "สำรอง", "ถุงกระดาษ กล่อง", 30, 4.2],
  ] as const;
  const sup = supplierRows.map(([name, category, tier, products, creditDays, rating], i) =>
    add("suppliers", {
      name, category, tier, products, creditDays, rating,
      code: code("SUP", i + 1),
      type: name.startsWith("หจก") ? "นิติบุคคล" : "นิติบุคคล",
      taxId: `0105${between(500000000, 599999999)}`,
      leadTime: `${between(3, 21)} วัน`,
      paymentTerms: `เครดิต ${creditDays} วัน`,
      bankName: pick(["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย"]),
      contact: pick(["คุณวิชัย", "คุณมาลี", "คุณประเสริฐ", "คุณสุดา"]),
      phone: `02-${between(100, 999)}-${between(1000, 9999)}`,
      docExpiry: day(between(-10, 200)),
      status: "active",
    }),
  );
  const dealerRows = [
    ["เซ็นทรัลเวิลด์", "กรุงเทพฯ", "กรุงเทพฯ"], ["สยามพารากอน", "กรุงเทพฯ", "กรุงเทพฯ"], ["ไอคอนสยาม", "กรุงเทพฯ", "กรุงเทพฯ"],
    ["เซ็นทรัล เฟสติวัล เชียงใหม่", "ภาคเหนือ", "เชียงใหม่"], ["เซ็นทรัล ภูเก็ต", "ภาคใต้", "ภูเก็ต"], ["เทอร์มินอล 21 โคราช", "ภาคอีสาน", "นครราชสีมา"],
  ] as const;
  const dealers = dealerRows.map(([name, region, province], i) =>
    add("dealers", { name, region, province, code: `DL-${String(i + 1).padStart(3, "0")}`, branch: name, contact: "ฝ่ายเช่าพื้นที่", status: "active" }),
  );

  // ---------- Projects, events, deals ----------
  const projectRows = [
    ["Pop-up Store เซ็นทรัลเวิลด์ (Q4)", "active", "urgent", -20, 25, 450000, 1],
    ["บูธงาน Bangkok Fashion Expo 2026", "active", "high", -10, 12, 380000, 4],
    ["คอลเลกชันปลายปี Winter Linen", "active", "high", -45, 40, 620000, 12],
    ["ตกแต่งร้านสาขาไอคอนสยาม", "planning", "normal", 15, 75, 900000, 0],
    ["อีเวนต์เปิดตัวแบรนด์ ไทยเบฟ x ศิริ", "review", "high", -60, -5, 520000, 1],
    ["ระบบ ERP และหน้าร้านออนไลน์", "active", "normal", -90, 60, 280000, 11],
    ["Pop-up The Promenade", "completed", "normal", -120, -95, 150000, 1],
  ] as const;
  const prj = projectRows.map(([name, status, priority, s, e, budget, owner], i) =>
    add("projects", { name, status, priority, budget, code: `PRJ-${String(i + 1).padStart(3, "0")}`, owner: person(owner), startDate: day(s), endDate: day(e), description: `โครงการ ${name}` }),
  );
  const events = [
    ["Bangkok Fashion Expo 2026", 1, "ไบเทค บางนา ฮอลล์ 98", 5, 8, 380000, "confirmed"],
    ["งานเปิดตัวคอลเลกชัน Winter Linen", 2, "ไอคอนสยาม ชั้น G", 18, 18, 220000, "planning"],
    ["Brand Launch ไทยเบฟ x ศิริ", 4, "เอเชียทีค", -12, -11, 520000, "completed"],
  ].map(([name, p, location, s, e, budget, status]) =>
    add("events", { name, projectId: prj[p as number], location, startDate: day(s as number), endDate: day(e as number), budget, owner: person(4), status, staff: "SUP 1, PC 4, MC 1" }),
  );
  [
    ["เซ็นทรัลเวิลด์ / Pop-up ลาน Eden", 0, 0, "ลาน Eden ชั้น 1", 36, 85000, 20, 900000, "approved"],
    ["สยามพารากอน / บูธ Fashion Week", 1, 1, "Parc Paragon", 24, 65000, 22, 600000, "pending"],
    ["ไอคอนสยาม / ร้านถาวร", 2, 3, "ชั้น 2 โซน Siam Takashimaya", 80, 180000, 18, 2400000, "negotiating"],
    ["เซ็นทรัล เชียงใหม่ / Pop-up", 3, 0, "ลานกลาง ชั้น G", 30, 45000, 20, 380000, "pending"],
    ["เซ็นทรัล ภูเก็ต / Pop-up ปีใหม่", 4, 0, "Floresta ชั้น 1", 30, 52000, 20, 420000, "rejected"],
  ].forEach(([name, d, p, location, area, rent, gp, targetSales, status]) =>
    add("deals", { name, dealerId: dealers[d as number], projectId: prj[p as number], location, area, rent, gp, targetSales, owner: person(15), startDate: day(between(5, 30)), endDate: day(between(40, 90)), status }),
  );

  // ---------- Products & purchasing ----------
  const productRows = [
    ["เสื้อเชิ้ตลินิน สีขาว", "SH-LN-WH", "เสื้อ", 320, 990, 145, 40],
    ["เสื้อเชิ้ตลินิน สีครีม", "SH-LN-CR", "เสื้อ", 320, 990, 32, 40],
    ["เสื้อยืด Oversize โลโก้", "TS-OV-01", "เสื้อ", 140, 450, 410, 100],
    ["เดรสผ้าฝ้าย Midi", "DR-CT-MD", "เดรส", 480, 1590, 64, 30],
    ["กางเกงขากว้าง ลินิน", "PT-LN-WD", "กางเกง", 360, 1190, 9, 30],
    ["กางเกงยีนส์ทรงตรง", "PT-JN-ST", "กางเกง", 420, 1390, 88, 30],
    ["แจ็กเก็ตเดนิม Winter", "JK-DN-01", "แจ็กเก็ต", 690, 2290, 41, 20],
    ["ผ้าพันคอผ้าไหม", "AC-SC-SL", "เครื่องประดับ", 210, 790, 120, 30],
    ["กระเป๋าผ้า Tote", "AC-TT-01", "กระเป๋า", 95, 390, 18, 50],
    ["หมวกบักเก็ต", "AC-BK-01", "เครื่องประดับ", 110, 420, 76, 25],
    ["ถุงกระดาษแบรนด์ (ใหญ่)", "PK-BG-L", "บรรจุภัณฑ์", 12, 0, 340, 500],
    ["ไม้แขวนเสื้อไม้", "DP-HG-01", "อุปกรณ์ร้าน", 35, 0, 600, 200],
  ] as const;
  const prd = productRows.map(([name, sku, category, cost, price, stock, reorderLevel]) =>
    add("products", { name, sku, category, unit: category === "บรรจุภัณฑ์" ? "ใบ" : category === "อุปกรณ์ร้าน" ? "ชิ้น" : "ตัว", cost, price, stock, reorderLevel, location: pick(["A-01", "A-02", "B-03", "C-01"]), status: "active" }),
  );
  [
    [0, 4, 120, 360, -6, "PO-6910"], [1, 0, 200, 300, -18, "PO-6902"], [5, 4, 100, 95, -3, "PO-6911"],
    [3, 3, 40, 1450, -25, "PO-6895"], [7, 10, 1000, 11, -9, "PO-6908"], [1, 3, 80, 320, -1, "PO-6912"],
  ].forEach(([s, p, quantity, unitCost, d, poNumber]) =>
    add("purchases", { name: `สั่งซื้อ ${productRows[p as number][0]}`, supplierId: sup[s as number], productId: prd[p as number], quantity, unitCost, total: (quantity as number) * (unitCost as number), orderDate: day(d as number), dueDate: day((d as number) + 14), poNumber, requestor: person(14), status: (d as number) < -10 ? "received" : "draft" }),
  );
  [[2, 30, 8, 0, "จ่ายของแล้ว"], [0, 12, 9, 1, "อนุมัติแล้ว"], [6, 10, 13, 2, "รออนุมัติ"], [8, 40, 5, 0, "รออนุมัติ"]].forEach(([p, quantity, who, prj_, status], i) =>
    add("stock_issues", { name: code("WD", i + 1), productId: prd[p as number], quantity, requester: person(who as number), projectId: prj[prj_ as number], date: day(-i * 2), status }),
  );
  [[2, 410, 406, "ปรับยอดแล้ว"], [4, 9, 9, "ตรวจแล้ว"], [8, 18, 15, "นับแล้ว"]].forEach(([p, systemQty, countedQty, status], i) =>
    add("stock_counts", { name: `ตรวจนับ ${productRows[p as number][1]}`, productId: prd[p as number], systemQty, countedQty, counter: person(9), date: day(-i - 1), status }),
  );

  // ---------- Sales history: ~4 months of daily store sales + B2B orders ----------
  // Confirmed sales are tallied per team and month so the sales-target page agrees with them.
  const teamOf = (channel: string) =>
    channel === "B2B" ? "ทีมขายองค์กร (B2B)" : channel === "หน้าร้าน" ? "ทีมขายหน้าร้าน" : channel === "Pop-up" ? "ทีม Pop-up" : "ทีมออนไลน์";
  const tally = new Map<string, number>();
  const addSale = (data: Record<string, unknown>) => {
    const key = `${String(data.date).slice(0, 7)}|${teamOf(String(data.channel))}`;
    if (data.status === "confirmed") tally.set(key, (tally.get(key) || 0) + Number(data.amount));
    return add("sales", data);
  };
  const channels = ["หน้าร้าน", "ออนไลน์ (Shopee)", "ออนไลน์ (LINE)", "Pop-up"];
  for (let d = -120; d <= 0; d++) {
    const weekend = [0, 6].includes(new Date(day(d) + "T00:00:00Z").getUTCDay());
    const trend = 1 + (d + 120) / 400; // growing business
    for (const channel of channels.slice(0, d > -30 ? 4 : 3)) {
      if (rand() < 0.25) continue;
      const base = channel === "หน้าร้าน" ? 18000 : channel === "Pop-up" ? 26000 : 9000;
      addSale({
        name: `ยอดขาย${channel} ${day(d)}`,
        date: day(d), channel,
        amount: round(base * trend * (weekend ? 1.6 : 1) * (0.6 + rand() * 0.8)),
        projectId: channel === "Pop-up" ? prj[0] : "",
        status: d === 0 && rand() < 0.5 ? "draft" : "confirmed",
      });
    }
  }
  for (let i = 0; i < 14; i++) {
    const c = pick([0, 1, 2, 3, 7, 9, 11]);
    addSale({ name: `งานบูธ/ขายส่ง ${customerRows[c][0].replace(/^บริษัท /, "")}`, customerId: cus[c], date: day(between(-115, -2)), channel: "B2B", amount: round(between(45000, 260000), 100), projectId: prj[pick([1, 4, 6])], status: "confirmed" });
  }

  // ---------- Expenses ----------
  const fixed = [["ค่าเช่าสำนักงาน พระราม 9", "ค่าเช่า", 85000, 5], ["ค่าเช่าคลังบางนา", "ค่าเช่า", 42000, 5], ["ค่าไฟฟ้า สำนักงาน+คลัง", "ค่าไฟฟ้า", 18500, 20], ["เงินเดือนพนักงาน", "บุคลากร", 684500, 28], ["ค่าอินเทอร์เน็ต & Cloud", "ค่าบริการ", 7900, 10]] as const;
  for (let m = 3; m >= 0; m--)
    for (const [name, category, amount, dom] of fixed) {
      const date = `${month(-m * 30)}-${String(dom).padStart(2, "0")}`;
      if (date > day(0)) continue;
      add("expenses", { name, category, amount: round(amount * (0.95 + rand() * 0.1)), date, docType: "ใบกำกับภาษีเต็มรูป", payStatus: "โอนแล้ว", reviewStatus: "บันทึกแล้ว", vatMode: "included", status: "paid" });
    }
  const variable = [
    ["ค่าขนส่งสินค้าไปบูธ", "ขนส่ง", 6, 3500, 12000], ["ค่ายิงโฆษณา Facebook/IG", "การตลาด", 2, 15000, 45000], ["ค่าวัสดุตกแต่งบูธ", "จัดซื้อ", 3, 8000, 65000],
    ["ค่าแรงพนักงานพาร์ตไทม์ (PC)", "บุคลากร", 5, 6000, 22000], ["ค่าพรมและงานติดตั้ง", "ค่าพรม", 3, 9000, 28000], ["ค่ามัดจำพื้นที่ Pop-up", "ค่ามัดจำ", 4, 30000, 90000],
    ["ค่าเดินทาง/ที่พัก ทีมขาย", "อื่นๆ", 0, 1200, 8500],
  ] as const;
  for (let i = 0; i < 46; i++) {
    const [name, category, s, lo, hi] = pick(variable);
    const d = between(-118, 0);
    const status = d > -7 ? pick(["pending", "pending", "approved"]) : pick(["paid", "paid", "approved"]);
    add("expenses", { name, category, supplierId: s < 8 ? sup[s] : "", amount: round(between(lo, hi), 50), date: day(d), docType: pick(["ใบกำกับภาษีเต็มรูป", "ใบเสร็จ", "ใบกำกับภาษีอย่างย่อ"]), payStatus: status === "paid" ? "โอนแล้ว" : "ยังไม่จ่าย", reviewStatus: status === "pending" ? "รอตรวจ" : "บันทึกแล้ว", projectId: prj[pick([0, 1, 2, 4])], status });
  }

  // ---------- Documents flow: quotation -> SO -> invoice -> payment ----------
  const qtItems = [["ออกแบบและผลิตบูธ 6x6 ม.", 1, 185000], ["ระบบไฟและเสียง", 1, 42000], ["พนักงาน PC (คน/วัน)", 12, 900], ["ชุดเสื้อผ้ายูนิฟอร์ม", 40, 650], ["ติดตั้งและรื้อถอน", 1, 25000]] as const;
  const qts: string[] = [];
  ["ตอบรับ", "ตอบรับ", "ส่งแล้ว", "ส่งแล้ว", "ร่าง", "ปฏิเสธ", "ส่งแล้ว", "ตอบรับ"].forEach((status, i) => {
    const lines = qtItems.filter(() => rand() < 0.7).map(([name, qty, price]) => ({ name, qty, price }));
    qts.push(add("quotations", { name: code("QT", i + 1), customerId: cus[[0, 3, 1, 9, 11, 7, 2, 4][i]], date: day(-40 + i * 5), validUntil: day(-10 + i * 5), lines: lines.length ? lines : [{ name: qtItems[0][0], qty: 1, price: qtItems[0][2] }], discount: i % 3 === 0 ? 5000 : 0, vatMode: "excluded", owner: person([1, 2, 3][i % 3]), status }));
  });
  [[0, 0, "ออกใบแจ้งหนี้แล้ว"], [1, 3, "กำลังจัดส่ง"], [7, 4, "รอดำเนินการ"]].forEach(([q, c, status], i) =>
    add("sales_orders", { name: code("SO", i + 1), customerId: cus[c as number], quotationId: qts[q as number], date: day(-30 + i * 8), deliveryDate: day(-15 + i * 12), lines: [{ name: "งานบูธตามใบเสนอราคา", qty: 1, price: [235000, 312000, 198000][i] }], vatMode: "excluded", projectId: prj[[0, 4, 1][i]], status }),
  );
  const invoiceRows = [
    [0, -50, 30, 235000, "paid"], [3, -45, 60, 312000, "partial"], [1, -38, 30, 128000, "issued"], [9, -35, 45, 86000, "issued"],
    [2, -28, 30, 54000, "paid"], [7, -20, 30, 97500, "issued"], [11, -12, 30, 410000, "issued"], [4, -8, 30, 65000, "issued"],
    [5, -70, 15, 23800, "issued"], [0, -5, 45, 158000, "issued"],
  ] as const;
  invoiceRows.forEach(([c, d, credit, subtotal, status], i) => {
    const total = Math.round(subtotal * 1.07 * 100) / 100;
    const inv = add("invoices", { name: `INV-${yy}${String(i + 101).padStart(4, "0")}`, customerId: cus[c], projectId: prj[pick([0, 1, 4])], date: day(d), dueDate: day(d + credit), subtotal, vat: 7, total, status, paid: status === "paid" ? total : status === "partial" ? round(total / 2, 1) : 0, description: "ค่าบริการออกแบบ ผลิต และติดตั้งบูธ" });
    if (status !== "issued")
      add("payments", { name: `รับชำระ INV-${yy}${String(i + 101).padStart(4, "0")}`, invoiceId: inv, direction: "income", date: day(d + credit - 3), amount: status === "paid" ? total : round(total / 2, 1), method: "โอนธนาคาร", reference: `KBANK-${between(100000, 999999)}` });
  });
  [[0, -25, 30, 64200, "3", "จ่ายแล้ว"], [3, -12, 30, 118000, "3", "รอจ่าย"], [5, -40, 15, 46500, "3", "รอจ่าย"], [6, -6, 7, 9800, "1", "รอตรวจ"], [2, -3, 15, 15400, "3", "โต้แย้ง"], [1, -20, 45, 186000, "0", "รอจ่าย"]].forEach(([s, d, credit, amount, whtRate, status], i) =>
    add("bills", { name: code("AP", i + 1), supplierId: sup[s as number], invoiceNo: `IV${between(10000, 99999)}`, date: day(d as number), dueDate: day((d as number) + (credit as number)), amount, whtRate, projectId: prj[pick([0, 1, 2])], status }),
  );

  // ---------- Sales pipeline ----------
  [
    ["Pop-up ปีใหม่ เซ็นทรัล ลาดพร้าว", 0, "proposal", 380000], ["ยูนิฟอร์มพนักงาน 300 ชุด", 3, "negotiation", 520000], ["บูธ Money Expo", 9, "meeting", 450000],
    ["ตกแต่งร้าน Flagship", 11, "contact", 1200000], ["ของที่ระลึกงานสัมมนา", 4, "lead", 85000], ["Pop-up สงกรานต์", 1, "won", 360000],
    ["บูธงานคอนโด", 4, "lost", 210000], ["Collab คอลเลกชันพิเศษ", 2, "proposal", 640000],
  ].forEach(([name, c, stage, amount], i) =>
    add("leads", { name, customerId: cus[c as number], stage, amount, assignee: person([1, 2, 3][i % 3]), nextDate: day(between(-3, 14)), activity: pick(["ส่งใบเสนอราคาแล้ว รอคำตอบ", "นัดประชุมที่ออฟฟิศลูกค้า", "ลูกค้าขอส่วนลดเพิ่ม 5%", "ส่ง Portfolio ทางอีเมล"]) }),
  );
  // This month: targets set a little above or below the pace so some teams are behind; last month: closed.
  const teams = [["ทีมขายองค์กร (B2B)", 1.3, 18], ["ทีมขายหน้าร้าน", 1.12, 0], ["ทีมออนไลน์", 0.95, 0], ["ทีม Pop-up", 1.2, 6]] as const;
  for (const [name, stretch, visits] of teams)
    for (const [m, current] of [[month(0), true], [month(-31), false]] as const) {
      const actual = tally.get(`${m}|${name}`) || 0;
      if (!actual) continue;
      const target = round(actual * (current ? stretch : stretch - 0.15), 10000);
      add("sales_targets", { name, month: m, target, actual, visits, status: actual >= target ? "ถึงเป้า" : current ? "กำลังดำเนินการ" : "ไม่ถึงเป้า" });
    }

  // ---------- Marketing ----------
  const cmp = [
    ["Winter Linen Launch", 2, "Facebook / IG / TikTok", -15, 30, 180000, 420000, "running"],
    ["11.11 Shopee Mega Sale", 5, "Shopee / LINE OA", -3, 3, 60000, 0, "running"],
    ["Bangkok Fashion Expo", 1, "อีเวนต์ / สื่อสิ่งพิมพ์", -20, 8, 95000, 0, "running"],
    ["Back to Office", 0, "Facebook", -80, -50, 70000, 265000, "completed"],
  ].map(([name, p, channel, s, e, budget, revenue, status]) =>
    add("campaigns", { name, projectId: prj[p as number], channel, startDate: day(s as number), endDate: day(e as number), budget, revenue, owner: person(4), status }),
  );
  [
    ["รีวิวคอลเลกชัน Winter Linen", "TikTok", "วิดีโอ", 0, -6, 4500, 86000, 7400, "เผยแพร่แล้ว"], ["Lookbook Winter Linen", "Instagram", "โพสต์", 0, -4, 0, 24000, 2100, "เผยแพร่แล้ว"],
    ["ไลฟ์ขาย 11.11", "Facebook", "ไลฟ์", 1, 2, 3000, 0, 0, "กำลังทำ"], ["Teaser บูธ Fashion Expo", "TikTok", "วิดีโอ", 2, 1, 2000, 0, 0, "รออนุมัติ"],
    ["บทความวิธีดูแลผ้าลินิน", "เว็บไซต์", "บทความ", 0, -20, 0, 5200, 310, "เผยแพร่แล้ว"], ["โฆษณาลด 20% LINE OA", "LINE OA", "โฆษณา", 1, -1, 6500, 41000, 3800, "เผยแพร่แล้ว"],
    ["ไอเดีย Collab ศิลปิน", "Instagram", "โพสต์", 0, 20, 0, 0, 0, "ไอเดีย"],
  ].forEach(([name, channel, type, c, d, spend, reach, engagement, status]) =>
    add("content", { name, channel, type, campaignId: cmp[c as number], publishDate: day(d as number), spend, reach, engagement, owner: person(5), status }),
  );
  [["งบ Q4 ออนไลน์", 0, 250000, 168000, "อนุมัติ"], ["งบอีเวนต์ Q4", 2, 300000, 214500, "อนุมัติ"], ["งบ Q3 ออนไลน์", 3, 200000, 198000, "ปิดงบ"]].forEach(([name, c, budget, spent, status]) =>
    add("marketing_budget", { name, campaignId: cmp[c as number], period: String(name).includes("Q3") ? `Q3/${yy}` : `Q4/${yy}`, budget, spent, status }),
  );
  [["ซื้อ 2 ชิ้น ลด 15%", "ลดเมื่อซื้อครบ 2 ชิ้น", -10, 20, 15, 30000, 300000, 186000, "กำลังจัด"], ["สมาชิกใหม่รับคูปอง 200", "คูปอง LINE OA", -40, -10, 200, 20000, 500, 640, "จบแล้ว"], ["Year-end Sale", "ลดสูงสุด 50%", 35, 50, 50, 80000, 1200000, 0, "วางแผน"]].forEach(([name, mechanic, s, e, discount, budget, target, result, status]) =>
    add("promotions", { name, mechanic, startDate: day(s as number), endDate: day(e as number), discount, budget, target, result, status }),
  );

  // ---------- Operations: tasks, tickets, assets, documents ----------
  const taskRows = [
    ["ส่งแบบ 3D บูธ Fashion Expo ให้ลูกค้า", 1, "Design", 13, -2, "urgent", "progress"], ["สั่งผลิตป้ายไวนิลบูธ", 1, "Purchasing", 14, 0, "high", "pending"],
    ["เช็กสต็อกก่อนขนไปบูธ", 1, "Warehouse", 8, 2, "high", "pending"], ["จองรถ 6 ล้อขนของ", 1, "Operations", 8, 3, "normal", "pending"],
    ["สรุปยอดขาย Pop-up สัปดาห์ที่แล้ว", 0, "Sales", 2, -3, "normal", "review"], ["ถ่าย Lookbook Winter Linen ชุดที่ 2", 2, "Marketing", 5, 4, "high", "progress"],
    ["ตามเก็บเงิน INV ค้างชำระ", 0, "Finance", 6, -1, "urgent", "progress"], ["ปิดงบเดือนก่อน", 5, "Finance", 6, -4, "high", "progress"],
    ["สัมภาษณ์ตำแหน่ง Sales Executive", 0, "HR", 10, 1, "normal", "pending"], ["ต่ออายุ Microsoft 365", 5, "IT", 11, 6, "normal", "pending"],
    ["ทำสัญญาเช่าพื้นที่ไอคอนสยาม", 3, "Legal", 15, 9, "high", "pending"], ["ออกแบบ Layout ร้านไอคอนสยาม", 3, "Design", 12, 20, "normal", "progress"],
    ["เตรียมสคริปต์ไลฟ์ 11.11", 2, "Marketing", 5, 1, "high", "progress"], ["อบรมพนักงาน PC ใหม่", 0, "HR", 10, 5, "normal", "pending"],
    ["ส่งรายงาน VAT ภพ.30", 5, "Finance", 7, 8, "urgent", "pending"], ["ตรวจรับผ้าลินินล็อตใหม่", 2, "Warehouse", 9, -1, "high", "pending"],
    ["อัปเดตราคาสินค้าบนเว็บ", 5, "IT", 11, 3, "normal", "progress"], ["เสนอราคาลูกค้า Money Expo", 1, "Sales", 3, 2, "high", "pending"],
    ["ส่งมอบงานอีเวนต์ไทยเบฟ (ปิดโครงการ)", 4, "Operations", 0, -6, "normal", "review"], ["ประชุมสรุปผลแคมเปญ Back to Office", 3, "Marketing", 4, -30, "normal", "done"],
    ["รื้อถอนบูธ The Promenade", 6, "Operations", 8, -90, "normal", "done"], ["ทำ Perspective ร้านไอคอนสยาม", 3, "Design", 13, -15, "high", "done"],
  ] as const;
  taskRows.forEach(([name, p, department, who, due, priority, status]) =>
    add("tasks", { name, projectId: prj[p], department, assignee: person(who), dueDate: day(due), priority, status }),
  );
  [
    ["คอมพิวเตอร์ฝ่ายบัญชีเปิดไม่ติด", "IT", "", 11, "high", 0, "progress"], ["ลูกค้าขอเปลี่ยนไซซ์เสื้อ (ออนไลน์)", "Customer Service", 10, 2, "normal", 1, "open"],
    ["พัสดุตีกลับ Shopee", "Customer Service", 10, 9, "normal", 2, "open"], ["ขอสิทธิ์เข้าระบบ ERP ใหม่", "IT", "", 11, "normal", 3, "resolved"],
    ["ลูกค้า VIP แจ้งสินค้าชำรุด", "Customer Service", 0, 3, "urgent", -1, "progress"],
  ].forEach(([name, type, c, who, priority, due, status]) =>
    add("tickets", { name, type, customerId: c === "" ? "" : cus[c as number], assignee: person(who as number), priority, dueDate: day(due as number), status }),
  );
  [
    ["MacBook Pro 14 (Design)", "IT", 89900, 2, 12, "in_use"], ["Notebook Lenovo ThinkPad", "IT", 32900, 6, 11, "in_use"], ["ชั้นวางบูธ Modular ชุด A", "อุปกรณ์บูธ", 145000, 1, 8, "available"],
    ["หุ่นโชว์ (Mannequin)", "อุปกรณ์บูธ", 3800, 24, 8, "in_use"], ["เครื่องพิมพ์ Canon", "อุปกรณ์สำนักงาน", 18500, 1, 11, "repair"], ["โต๊ะประชุม 10 ที่นั่ง", "เฟอร์นิเจอร์", 42000, 1, 10, "in_use"],
  ].forEach(([name, category, price, quantity, who, status], i) =>
    add("assets", { name, category, price, quantity, code: `AS-${String(i + 1).padStart(3, "0")}`, owner: person(who as number), buyDate: day(-between(100, 900)), warranty: day(between(-100, 500)), place: "สำนักงานใหญ่", status }),
  );
  [["สัญญาเช่าพื้นที่ เซ็นทรัลเวิลด์", 0, "สัญญา", "Legal"], ["Layout บูธ Fashion Expo v3", 1, "Layout", "Design"], ["Perspective ร้านไอคอนสยาม", 3, "Perspective", "Design"], ["ใบเสร็จค่ามัดจำพื้นที่", 0, "ใบเสร็จ", "Finance"]].forEach(([name, p, category, department]) =>
    add("documents", { name, projectId: prj[p as number], category, department }),
  );

  // ---------- Legal & IT & Admin ----------
  [["สัญญาเช่าพื้นที่ Pop-up เซ็นทรัลเวิลด์", 0, "บริษัท เซ็นทรัล รีเทล คอร์ปอเรชั่น จำกัด", 255000, -25, 25, "signed"], ["สัญญาจ้างผลิต OEM", 2, "บริษัท ไทยการ์เมนต์ แฟคตอรี่ จำกัด", 1200000, -200, 165, "signed"], ["สัญญาเช่าร้านไอคอนสยาม 3 ปี", 3, "บริษัท ไอคอนสยาม จำกัด", 6480000, 30, 1125, "review"], ["MOU ไทยเบฟ x ศิริ", 4, "บริษัท ไทยเบฟเวอเรจ จำกัด (มหาชน)", 520000, -70, 20, "expired"]].forEach(([name, p, counterparty, value, s, e, status]) =>
    add("contracts", { name, projectId: prj[p as number], counterparty, value, startDate: day(s as number), endDate: day(e as number), status }),
  );
  [["เครื่องหมายการค้า SIRI STUDIO", "เครื่องหมายการค้า", "ค.123456", -1500, 2150, "จดทะเบียนแล้ว"], ["ลายผ้า Siri Signature", "ลิขสิทธิ์", "ลข.98765", -400, 25000, "จดทะเบียนแล้ว"], ["โลโก้ใหม่ 2026", "เครื่องหมายการค้า", "", -30, 3620, "ยื่นคำขอ"]].forEach(([name, type, registrationNo, filing, expiry, status]) =>
    add("ip_assets", { name, type, registrationNo, filingDate: day(filing as number), expiryDate: day(expiry as number), owner: person(0), status }),
  );
  [["นโยบายคุ้มครองข้อมูลส่วนบุคคล", "ข้อมูลส่วนบุคคล (PDPA)", -300, 60, "ประกาศใช้"], ["ระเบียบการเบิกค่าใช้จ่าย", "การเงิน", -500, 20, "รอทบทวน"], ["คู่มือพนักงาน 2026", "บุคคล", -200, 165, "ประกาศใช้"], ["นโยบายรหัสผ่านและการใช้งานคอมพิวเตอร์", "ความปลอดภัย", -90, 275, "ประกาศใช้"]].forEach(([name, category, eff, exp, status]) =>
    add("policies", { name, category, effectiveDate: day(eff as number), expiryDate: day(exp as number), owner: person(10), status }),
  );
  add("cases", { name: "ข้อพิพาทค่าจ้างผลิตป้าย", caseNo: "", counterparty: "หจก. ป้ายดีไซน์ พริ้นท์", lawyer: "สำนักงานกฎหมาย ธรรมนิติ", nextHearing: day(18), amount: 15400, status: "เจรจา", notes: "งานพิมพ์สีเพี้ยน ขอลดราคา" });
  [["Microsoft 365 Business", "Microsoft", 16, 72000, 21, "รอต่ออายุ"], ["Adobe Creative Cloud", "Adobe", 3, 68400, 140, "ใช้งาน"], ["Shopify", "Shopify", 1, 14400, 200, "ใช้งาน"], ["Canva Teams", "Canva", 5, 9000, 9, "รอต่ออายุ"], ["EliteFlow", "EliteFlow", 16, 0, 365, "ใช้งาน"]].forEach(([name, vendor, seats, cost, exp, status]) =>
    add("software", { name, vendor, seats, cost, expiryDate: day(exp as number), owner: person(11), status }),
  );
  [["อีเมลฟิชชิงแอบอ้างธนาคาร", "เหตุการณ์", "กลาง", -4, "แก้แล้ว"], ["สำรองข้อมูลบัญชีประจำเดือน", "สำรองข้อมูล", "ต่ำ", -1, "ปิด"], ["Router สำนักงานเฟิร์มแวร์เก่า", "ช่องโหว่", "สูง", -2, "กำลังแก้"]].forEach(([name, category, severity, d, status]) =>
    add("security", { name, category, severity, date: day(d as number), owner: person(11), status }),
  );
  [["Toyota Hilux Revo", "2ขก 4581", 8, 84210, 12, 45, 6, "ใช้งานอยู่"], ["Isuzu 6 ล้อ", "71-2245", 9, 156300, 70, 120, -3, "ซ่อมบำรุง"], ["Honda City (ฝ่ายขาย)", "8กท 902", 1, 41250, 200, 230, 40, "พร้อมใช้"]].forEach(([name, plate, who, mileage, tax, ins, service, status]) =>
    add("vehicles", { name, plate, driver: person(who as number), mileage, taxExpiry: day(tax as number), insuranceExpiry: day(ins as number), nextService: day(service as number), status }),
  );
  [["แอร์ห้องประชุมไม่เย็น", "ซ่อมอาคาร", 6, "ห้องประชุมใหญ่", "กำลังดำเนินการ"], ["จองห้องประชุม Pitch ลูกค้า", "จองห้องประชุม", 1, "ห้องประชุมเล็ก", "เสร็จแล้ว"], ["เบิกกระดาษ A4 และหมึก", "อุปกรณ์สำนักงาน", 7, "ฝ่ายบัญชี", "แจ้งแล้ว"]].forEach(([name, category, who, location, status]) =>
    add("services", { name, category, requester: person(who as number), location, date: day(-between(0, 5)), owner: person(0), status }),
  );

  // ---------- HR ----------
  staff.forEach((s, i) => {
    if (i === 9) return add("attendance", { name: s[0], employeeId: emp[i], date: day(0), shiftStart: "09:00", checkIn: "-", status: "ลา" });
    const late = [2, 5, 13].includes(i);
    add("attendance", { name: s[0], employeeId: emp[i], date: day(0), shiftStart: "09:00", checkIn: late ? `09:${between(10, 35)}` : `08:${between(30, 58)}`, location: s[2] === "Warehouse" ? "คลังบางนา" : i === 3 ? "ลูกค้า (นอกสถานที่)" : "สำนักงานใหญ่", status: late ? "สาย" : i === 3 ? "ทำงานนอกสถานที่" : "ปกติ" });
  });
  [[9, "ลาป่วย", -1, 1, "approved"], [2, "ลาพักร้อน", 6, 8, "pending"], [12, "ลากิจ", 3, 3, "pending"], [7, "ลาพักร้อน", -20, -18, "approved"], [5, "ลาป่วย", -9, -9, "rejected"]].forEach(([e, type, s, en, status]) =>
    add("leaves", { name: `${type} ${person(e as number)}`, employeeId: emp[e as number], type, startDate: day(s as number), endDate: day(en as number), status }),
  );
  staff.forEach(([name, , , , , salary], i) => {
    const allowance = [1, 2, 3].includes(i) ? round(salary * 0.15, 100) : 0,
      deduction = round(Math.min(salary * 0.05, 750) + salary * 0.03, 10);
    add("payroll", { name: `เงินเดือน ${month(-28)} ${name}`, employeeId: emp[i], date: `${month(-28)}-28`, base: salary, allowance, deduction, net: salary + allowance - deduction, status: "paid" });
  });
  [["ภัทรา สุขสวัสดิ์", "Sales Executive", "JobThai", 2, 26000, 82, "สัมภาษณ์"], ["ธีรวัฒน์ แสงทอง", "Sales Executive", "LinkedIn", 4, 30000, 75, "คัดกรอง"], ["ศิรินภา ดวงดี", "พนักงานคลัง", "แนะนำ", -3, 15000, 88, "เสนองาน"], ["อนันตา บุญรอด", "Graphic Designer", "JobsDB", -10, 28000, 60, "ไม่ผ่าน"], ["กฤษดา มณีวงศ์", "Content Creator", "เครือข่าย EliteFlow", 5, 25000, 0, "สมัคร"]].forEach(([name, position, source, d, expectedSalary, score, status]) =>
    add("recruitment", { name, position, source, interviewDate: day(d as number), expectedSalary, score, phone: `08${between(1, 9)}-${between(100, 999)}-${between(1000, 9999)}`, status }),
  );
  [[1, "ยอดขายทีม B2B (ล้านบาท)", 3.6, 2.9], [4, "Reach โซเชียล (พันคน)", 500, 410], [6, "ปิดงบภายในวันที่ 7", 3, 3], [8, "ความแม่นยำสต็อก (%)", 99, 97], [12, "ส่งแบบตรงเวลา (%)", 95, 88]].forEach(([e, objective, target, actual]) =>
    add("kpi", { name: `KPI ${person(e as number)}`, employeeId: emp[e as number], period: `Q4/${yy}`, objective, target, actual, status: "ระหว่างรอบ" }),
  );

  // ---------- Events ----------
  [["คุณวิภาวดี (เซ็นทรัล)", "VIP", "บริษัท เซ็นทรัล รีเทล", "ยืนยัน"], ["นิตยสาร Vogue Thailand", "สื่อ", "Vogue", "ลงทะเบียน"], ["คุณอนันต์ (ไทยเบฟ)", "พาร์ทเนอร์", "ไทยเบฟเวอเรจ", "ยืนยัน"], ["Influencer @linenlover", "สื่อ", "", "ลงทะเบียน"], ["ผู้ชมทั่วไป (ลงทะเบียนออนไลน์ 240 คน)", "ทั่วไป", "", "ลงทะเบียน"]].forEach(([name, guestType, company, status]) =>
    add("event_guests", { name, eventId: events[0], guestType, company, status }),
  );
  [["ค่าเช่าพื้นที่บูธ", 0, 160000, 160000, "บริษัท ไบเทค", "จ่ายแล้ว"], ["ผลิตบูธ", 0, 150000, 92000, "Siam Display", "อนุมัติ"], ["แสง เสียง เวที", 1, 60000, 0, "ไลท์ติ้ง แอนด์ ซาวด์", "วางแผน"], ["ค่าอาหารแขก VIP", 1, 40000, 0, "", "วางแผน"]].forEach(([name, ev, budget, spent, vendor, status]) =>
    add("event_budget", { name, eventId: events[ev as number], budget, spent, vendor, status }),
  );
  [["ไบเทค ฮอลล์ 98 (บูธ 6x6)", "สถานที่", 0, 5, 0, 160000, "ยืนยัน"], ["ชุดไฟ LED + เครื่องเสียง", "เวที & แสงเสียง", 0, 5, 0, 45000, "จองแล้ว"], ["ลานกิจกรรม ไอคอนสยาม", "สถานที่", 1, 18, 300, 120000, "สอบถาม"]].forEach(([name, type, ev, d, capacity, cost, status]) =>
    add("venues", { name, type, eventId: events[ev as number], bookingDate: day(d as number), capacity, cost, contact: "ฝ่ายขายพื้นที่", status }),
  );
  return { customers: cus, suppliers: sup, products: prd, projects: prj, employees: emp, staff: staff.map((s) => ({ name: s[0], department: s[2] })) };
}
