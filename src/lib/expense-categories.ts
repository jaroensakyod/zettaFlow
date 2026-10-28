// หมวดหมู่หลักของค่าใช้จ่าย: grouped, each with an emoji for the pickers and the ledger account it books to by default.
// Purchases of things the business keeps (computers, furniture, vehicles, software licences) go to asset accounts;
// "ส่วนตัว" goes to the owner's drawings. An accountant can override the account on each expense.
export type ExpenseCategory = { name: string; emoji: string; account: string };
export type ExpenseCategoryGroup = { name: string; emoji: string; items: ExpenseCategory[] };

const c = (name: string, emoji: string, account: string): ExpenseCategory => ({ name, emoji, account });

export const expenseCategoryGroups: ExpenseCategoryGroup[] = [
  {
    name: "ขาย การตลาด และการเดินทาง",
    emoji: "🛍️",
    items: [
      c("ส่งเสริมการขาย", "📣", "5310"),
      c("รับรอง/เลี้ยงลูกค้า", "🍽️", "5320"),
      c("ค่าเดินทางและที่พัก", "🧳", "5270"),
      c("ค่าน้ำมัน/แก๊ส/รถยนต์", "⛽", "5271"),
      c("ค่าขนส่งลูกค้า/ลอจิสติกส์", "🚚", "5250"),
    ],
  },
  {
    name: "ค่าเช่า ประกัน และค่าธรรมเนียม",
    emoji: "🏬",
    items: [
      c("ค่าเช่า", "🏬", "5210"),
      c("เงินมัดจำ/ประกัน", "🔐", "1160"),
      c("เบี้ยประกัน", "🛡️", "5410"),
      c("ค่าธรรมเนียมธนาคาร", "🏦", "5420"),
      c("ภาษีและทะเบียน", "🧾", "5430"),
    ],
  },
  {
    name: "สินค้า/วัตถุดิบ/แพคเกจจิ้ง",
    emoji: "📦",
    items: [
      c("ซื้อสินค้าไว้ขาย", "🛒", "5010"),
      c("ซื้อของ/วัสดุไว้ให้บริการ", "🧰", "5010"),
      c("สินค้าตัวอย่าง/ของแจกแถม", "🎁", "5020"),
    ],
  },
  {
    name: "ซื้อของไว้ใช้ในธุรกิจ",
    emoji: "🏷️",
    items: [
      c("คอมพิวเตอร์/อุปกรณ์ไอที", "💻", "1240"),
      c("เฟอร์นิเจอร์/อุปกรณ์สำนักงาน", "🪑", "1250"),
      c("เฟอร์นิเจอร์และตกแต่งสำนักงาน", "🛋️", "1250"),
      c("ยานพาหนะ", "🚗", "1260"),
      c("ซอฟท์แวร์คอมพิวเตอร์", "💿", "1270"),
    ],
  },
  {
    name: "สำนักงาน (OFFICE)",
    emoji: "🗂️",
    items: [
      c("ค่าส่งเอกสาร/เมสเซนเจอร์/ไปรษณีย์", "📮", "5250"),
      c("โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น", "📱", "5280"),
      c("วัสดุสำนักงาน/เครื่องเขียน", "✏️", "5290"),
      c("ค่าเช่าออฟฟิศ", "🏢", "5210"),
      c("โทรศัพท์", "☎️", "5221"),
      c("ค่าไฟ", "💡", "5220"),
      c("อินเตอร์เน็ต", "🌐", "5221"),
      c("ค่าน้ำ", "🚰", "5220"),
    ],
  },
  {
    name: "ค่าจ้าง/บริการ",
    emoji: "🤝",
    items: [c("บริการทั่วไป/ฟรีแลนซ์", "🧑‍💻", "5230"), c("บริการด้านบัญชี", "📊", "5230")],
  },
  {
    name: "เงินเดือน/สวัสดิการ",
    emoji: "👥",
    items: [
      c("เงินเดือน/ค่าจ้าง", "💰", "5110"),
      c("เบี้ยเลี้ยง", "🍱", "5120"),
      c("ประกันสังคม", "🏥", "5130"),
      c("สวัสดิการพนักงาน", "🎉", "5120"),
      c("ค่าล่วงเวลา", "⏰", "5110"),
      c("ค่าคอมมิชชั่นพนักงานขาย", "🏆", "5140"),
    ],
  },
  {
    name: "เบ็ดเตล็ด",
    emoji: "🧩",
    items: [
      c("ส่วนตัว", "👤", "3120"),
      c("ค่านายหน้าและส่วนแบ่งการขาย", "💼", "5140"),
      c("ซ่อมแซมบำรุงรักษา", "🔧", "5440"),
      c("ดอกเบี้ยเงินกู้ยืม", "📈", "5450"),
      c("ค่าใช้จ่ายทั่วไป", "📋", "5900"),
    ],
  },
];

/** Categories from before this list; existing records keep them and stay valid. */
export const legacyExpenseCategories = ["ค่ามัดจำ", "ค่าเช่า", "ค่าไฟฟ้า", "ค่าบริการ", "ค่าพรม", "บุคลากร", "จัดซื้อ", "ขนส่ง", "การตลาด", "อื่นๆ"] as const;
const legacyEmoji: Record<string, string> = { ค่ามัดจำ: "🔐", ค่าไฟฟ้า: "💡", ค่าบริการ: "🤝", ค่าพรม: "🧶", บุคลากร: "👥", จัดซื้อ: "🛒", ขนส่ง: "🚚", การตลาด: "📣", อื่นๆ: "📋" };

const all = expenseCategoryGroups.flatMap((g) => g.items);
export const currentExpenseCategories = all.map((x) => x.name);
export const isLegacyCategory = (name: string) => !currentExpenseCategories.includes(name);
export const categoryEmoji = (name: string) => all.find((x) => x.name === name)?.emoji || legacyEmoji[name] || "📋";
/** "⛽ ค่าน้ำมัน/แก๊ส/รถยนต์" — what pickers and lists show; the stored value stays the plain name. */
export const categoryLabel = (name: string) => (name ? `${categoryEmoji(name)} ${name}` : "");
export const categoryAccount = (name: string) => all.find((x) => x.name === name)?.account;
