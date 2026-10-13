"use client";
import { useState } from "react";
import {
  ShoppingCart,
  Clock3,
  Truck,
  CheckCircle2,
  Package,
  Wallet,
  Sparkles,
  TriangleAlert,
  ArrowRight,
  ArrowUpRight,
  Users,
  TrendingUp,
  Target,
  Percent,
  CalendarDays,
  Megaphone,
} from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { Records } from "./records";
import { StockTransfers } from "./stock-transfers";
import { PurchaseLifecycle } from "./purchase-lifecycle";
import { ProjectGallery } from "./project-gallery";
import { Empty, money, displayDate } from "./shared";
import {
  NumberCard,
  LineChart,
  Donut,
  StatusBars,
  amountSeries,
  groupedValues,
} from "./dashboard-charts";
import { projectNumbers, projectWorkflow } from "@/lib/zetta";
const titles = {
  purchasing: ["Procurement / Warehouse Dashboard", "จัดซื้อ / คลังสินค้า"],
  warehouse: ["Procurement / Warehouse Dashboard", "จัดซื้อ / คลังสินค้า"],
  finance: ["Finance Dashboard", "การเงิน"],
  sales: ["Sales Dashboard", "ฝ่ายขาย"],
  marketing: ["Marketing & Event Dashboard", "การตลาด & อีเวนต์"],
  design: ["Store Design Dashboard", "ออกแบบร้านค้า"],
  crm: ["Customer Management Dashboard", "CRM / บริหารลูกค้า"],
};
const procurementStages = [
  ["draft", "รออนุมัติ"],
  ["approved", "อนุมัติแล้ว"],
  ["pending_vendor", "รอผู้ขายยืนยัน"],
  ["in_progress", "กำลังจัดซื้อ"],
  ["pending_delivery", "รอส่งของ"],
  ["delivered", "ส่งของแล้ว"],
  ["received", "เสร็จสิ้น"],
  ["cancelled", "ยกเลิก"],
] as const;
type View = keyof typeof titles;
export function DepartmentDashboard({
  view,
  entities,
  ctx,
  notify,
  changed,
  navigate,
  edit,
}: {
  view: View;
  entities: Entity[];
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
  navigate: (v: string, id?: string, tab?: string) => void;
  edit: (kind: string, row?: Entity) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  const [kind, setKind] = useState(
      view === "warehouse"
        ? "products"
        : view === "purchasing"
          ? "purchases"
          : view === "finance"
            ? "expenses"
            : view === "sales"
              ? "sales"
              : view === "crm"
                ? "leads"
                : view === "marketing"
                  ? "campaigns"
                  : "tasks",
    ),
    [selected, setSelected] = useState("");
  const rows = (kind: string) => entities.filter((e) => e.kind === kind),
    purchases = rows("purchases"),
    products = rows("products"),
    suppliers = rows("suppliers"),
    expenses = rows("expenses").filter((r) =>
      ["approved", "paid"].includes(String(r.data.status)),
    ),
    sales = rows("sales").filter((r) => r.data.status === "confirmed"),
    projects = rows("projects"),
    payments = rows("payments"),
    leads = rows("leads"),
    customers = rows("customers"),
    tasks = rows("tasks"),
    project =
      projects.find((p) => p.id === selected) ||
      (ctx.demo
        ? projects.find(
            (p) => String(p.data.name).toLowerCase() === "the promenade",
          )
        : undefined) ||
      projects[0],
    sum = (rs: Entity[], f: string) =>
      rs.reduce((s, r) => s + Number(r.data[f] || 0), 0),
    low = products.filter(
      (p) => Number(p.data.stock || 0) <= Number(p.data.reorderLevel || 0),
    );
  const n = project ? projectNumbers(project, entities) : null,
    projectTasks = tasks.filter((t) => t.data.projectId === project?.id),
    projectSales = sales.filter((s) => s.data.projectId === project?.id),
    late = tasks.filter(
      (t) =>
        t.data.status !== "done" &&
        t.data.dueDate &&
        String(t.data.dueDate) < today,
    );
  const tabOptions =
    view === "purchasing" || view === "warehouse"
      ? [
          ["purchases", "Purchase Requests"],
          ["products", "Inventory"],
          ["suppliers", "Suppliers"],
        ]
      : view === "finance"
        ? [
            ["expenses", "Expenses"],
            ["payments", "Payments"],
            ["invoices", "Invoices"],
          ]
        : view === "sales"
          ? [
              ["sales", "Orders / Sales"],
              ["leads", "Leads"],
              ["customers", "Customers"],
            ]
          : view === "crm"
            ? [
                ["leads", "Pipeline / Deals"],
                ["customers", "Customers"],
              ]
            : view === "marketing"
              ? [
                  ["campaigns", "Marketing"],
                  ["events", "Events"],
                ]
              : [
                  ["tasks", "Design Tasks"],
                  ["projects", "Projects"],
                ];
  return (
    <div className="zd-dashboard">
      <div className="z-heading">
        <div>
          <h1>{titles[view][0]}</h1>
          <p>{titles[view][1]}</p>
        </div>
        <button className="secondary" onClick={() => navigate("assistant")}>
          <Sparkles size={14} />
          AI Insights
        </button>
      </div>
      {(view === "purchasing" || view === "warehouse") && (
        <>
          <div className="zd-six">
            <NumberCard
              label="Purchase Requests"
              value={purchases.length}
              note="รายการทั้งหมด"
              icon={ShoppingCart}
            />
            <NumberCard
              label="Waiting Approval"
              value={purchases.filter((p) => p.data.status === "draft").length}
              note="รายการรออนุมัติ"
              tone="amber"
              icon={Clock3}
            />
            <NumberCard
              label="Pending Delivery"
              value={
                purchases.filter((p) =>
                  [
                    "approved",
                    "pending_vendor",
                    "in_progress",
                    "pending_delivery",
                    "delivered",
                  ].includes(String(p.data.status)),
                ).length
              }
              note="รอส่ง / รอรับสินค้า"
              tone="blue"
              icon={Truck}
            />
            <NumberCard
              label="Completed"
              value={
                purchases.filter((p) => p.data.status === "received").length
              }
              note="ดำเนินการเสร็จสิ้น"
              tone="green"
              icon={CheckCircle2}
            />
            <NumberCard
              label="Central Warehouse"
              value={sum(products, "stock")}
              note="จำนวนสินค้า"
              icon={Package}
            />
            <NumberCard
              label="Purchase Value"
              value={sum(
                purchases.filter((p) => p.data.status !== "cancelled"),
                "total",
              )}
              note="มูลค่ารวม (บาท)"
              icon={Wallet}
            />
          </div>
          <div className="zd-main-grid">
            <section className="z-card">
              <CardTitle
                title="รายการขอซื้อสินค้าล่าสุด"
                action={() => setKind("purchases")}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PR No.</th>
                      <th>วันที่ขอซื้อ</th>
                      <th>Supplier</th>
                      <th>รายการสินค้า</th>
                      <th>จำนวน</th>
                      <th>มูลค่า (บาท)</th>
                      <th>สถานะ</th>
                      <th>ผู้รับผิดชอบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.slice(0, 5).map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => edit("purchases", p)}
                          >
                            {String(p.data.name)}
                          </button>
                        </td>
                        <td>{displayDate(p.data.orderDate)}</td>
                        <td>
                          {String(
                            suppliers.find((s) => s.id === p.data.supplierId)
                              ?.data.name || "—",
                          )}
                        </td>
                        <td>
                          {String(
                            products.find((s) => s.id === p.data.productId)
                              ?.data.name || "—",
                          )}
                        </td>
                        <td>{money(p.data.quantity)}</td>
                        <td>{money(p.data.total)}</td>
                        <td>
                          <span
                            className={
                              "z-badge " +
                              (p.data.status === "received"
                                ? "z-approved"
                                : p.data.status === "draft"
                                  ? "z-pending"
                                  : "z-progress")
                            }
                          >
                            {p.data.status === "draft"
                              ? "รออนุมัติ"
                              : p.data.status === "received"
                                ? "เสร็จสิ้น"
                                : "รอจัดส่ง"}
                          </span>
                        </td>
                        <td>{String(p.data.requestor || "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!purchases.length && <Empty title="ยังไม่มีรายการขอซื้อ" />}
            </section>
            <section className="z-card zd-insights">
              <CardTitle title="AI Insights" />
              <Insight
                icon={TriangleAlert}
                title={`มีใบขอซื้อรออนุมัติ ${purchases.filter((p) => p.data.status === "draft").length} รายการ`}
                detail={`มูลค่ารวม ${money(
                  sum(
                    purchases.filter((p) => p.data.status === "draft"),
                    "total",
                  ),
                )} บาท`}
                click={() => setKind("purchases")}
              />
              <Insight
                icon={Truck}
                title={`ใบสั่งซื้อเกินกำหนดส่ง ${purchases.filter((p) => p.data.status !== "received" && p.data.dueDate && String(p.data.dueDate) < today).length} รายการ`}
                detail="ตรวจตามกำหนดส่งในใบสั่งซื้อ"
                click={() => setKind("purchases")}
              />
              <Insight
                icon={Package}
                title={`สินค้า ${low.length} รายการถึงจุดสั่งซื้อ`}
                detail="ตรวจสต็อกก่อนสั่งเพิ่ม"
                click={() => setKind("products")}
              />
              <small className="zd-computed">
                สรุปจากข้อมูลจริง · ถาม AI เพื่อวิเคราะห์เพิ่มเติม
              </small>
            </section>
          </div>
          <div className="zd-four">
            <section className="z-card">
              <CardTitle title="มูลค่าการสั่งซื้อรายเดือน (บาท)" />
              <LineChart
                points={amountSeries(purchases, "total", "orderDate", "month")}
              />
            </section>
            <section className="z-card">
              <CardTitle title="สัดส่วนการสั่งซื้อตามหมวดหมู่" />
              <Donut
                items={groupedValues(
                  purchases.map((p) => ({
                    ...p,
                    data: {
                      ...p.data,
                      category:
                        p.data.category ||
                        products.find((s) => s.id === p.data.productId)?.data
                          .category,
                    },
                  })),
                  "category",
                  "total",
                )}
                unit="บาท"
              />
            </section>
            <section className="z-card">
              <CardTitle title="สถานะการสั่งซื้อ" />
              <StatusBars
                items={[
                  {
                    label: "รออนุมัติ",
                    value: purchases.filter((p) => p.data.status === "draft")
                      .length,
                  },
                  {
                    label: "อนุมัติแล้ว",
                    value: purchases.filter((p) => p.data.status === "approved")
                      .length,
                  },
                  {
                    label: "รอจัดส่ง",
                    value: purchases.filter((p) =>
                      ["pending_delivery", "in_progress"].includes(
                        String(p.data.status),
                      ),
                    ).length,
                  },
                  {
                    label: "เสร็จสิ้น",
                    value: purchases.filter((p) => p.data.status === "received")
                      .length,
                  },
                  {
                    label: "ยกเลิก",
                    value: purchases.filter(
                      (p) => p.data.status === "cancelled",
                    ).length,
                  },
                ]}
              />
            </section>
            <section className="z-card">
              <CardTitle title="Supplier Performance" />
              {suppliers.slice(0, 5).map((s) => {
                const orders = purchases.filter(
                    (p) => p.data.supplierId === s.id,
                  ),
                  done = orders.filter(
                    (o) => o.data.status === "received",
                  ).length;
                return (
                  <div className="zd-supplier" key={s.id}>
                    <span>{String(s.data.name)}</span>
                    <strong>
                      {orders.length
                        ? Math.round((done / orders.length) * 100) + "%"
                        : "—"}
                    </strong>
                    <small>
                      รับแล้ว {done}/{orders.length} ใบ
                    </small>
                  </div>
                );
              })}
              {!suppliers.length && <Empty title="ยังไม่มี Supplier" />}
            </section>
          </div>
          <section className="z-card">
            <CardTitle title="ภาพรวมกระบวนการจัดซื้อ" />
            <div className="zd-process">
              {procurementStages.map(([status, label], i) => (
                <div key={String(label)}>
                  <span>{i + 1}</span>
                  <strong>{label}</strong>
                  <small>
                    {purchases.filter((p) => p.data.status === status).length}{" "}
                    รายการ
                  </small>
                  {i < 6 && <ArrowRight size={16} />}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {view === "finance" && (
        <>
          <div className="zd-five">
            <NumberCard
              label="รายรับวันนี้ (บาท)"
              value={sum(
                payments.filter(
                  (p) => p.data.direction === "income" && p.data.date === today,
                ),
                "amount",
              )}
              tone="green"
              icon={Wallet}
            />
            <NumberCard
              label="รายจ่ายวันนี้ (บาท)"
              value={sum(
                payments.filter(
                  (e) =>
                    e.data.direction === "expense" && e.data.date === today,
                ),
                "amount",
              )}
              tone="rose"
              icon={Wallet}
            />
            <NumberCard
              label="ใบแจ้งหนี้ค้างชำระ (บาท)"
              value={
                sum(
                  rows("invoices").filter((p) => p.data.status !== "paid"),
                  "total",
                ) -
                sum(
                  rows("invoices").filter((p) => p.data.status !== "paid"),
                  "paid",
                )
              }
              tone="amber"
            />
            <NumberCard
              label="ใบแจ้งหนี้รอชำระ"
              value={
                rows("invoices").filter((p) => p.data.status !== "paid").length
              }
              tone="blue"
            />
            <NumberCard
              label="กระแสเงินสด"
              value={
                sum(
                  payments.filter((p) => p.data.direction === "income"),
                  "amount",
                ) -
                sum(
                  payments.filter((p) => p.data.direction === "expense"),
                  "amount",
                )
              }
              tone="green"
            />
          </div>
          <div className="zd-main-grid">
            <section className="z-card">
              <CardTitle title="สรุปค่าใช้จ่ายตามหมวดหมู่" />
              <Donut
                items={groupedValues(expenses, "category", "amount")}
                unit="บาท"
              />
            </section>
            <section className="z-card zd-insights">
              <CardTitle title="AI อ่านเอกสารอัตโนมัติ" />
              <p>ใบเสร็จ / Invoice · Vendor · VAT · Amount · Date</p>
              <p>ส่งเอกสารเข้าระบบและตรวจทานข้อมูลที่ AI สกัด</p>
              <button className="primary" onClick={() => navigate("inbox")}>
                เปิด Data Inbox
                <ArrowRight size={13} />
              </button>
              <hr />
              <h3>AI Alert</h3>
              <p>
                มี{" "}
                {
                  rows("invoices").filter(
                    (p) =>
                      p.data.status !== "paid" &&
                      p.data.dueDate &&
                      String(p.data.dueDate) < today,
                  ).length
                }{" "}
                ใบแจ้งหนี้เกินกำหนดชำระ
              </p>
              <button
                className="text-button"
                onClick={() => setKind("invoices")}
              >
                ดูรายละเอียด
                <ArrowRight size={13} />
              </button>
            </section>
          </div>
          <div className="zd-main-grid">
            <section className="z-card">
              <CardTitle title="กระแสเงินสด (Cash Flow)" />
              <LineChart
                points={amountSeries(
                  payments.map((p) => ({
                    ...p,
                    data: {
                      ...p.data,
                      amount:
                        (p.data.direction === "expense" ? -1 : 1) *
                        Number(p.data.amount || 0),
                    },
                  })),
                )}
              />
            </section>
            <section className="z-card">
              <CardTitle title="ยอดรับชำระ / ค่าใช้จ่าย" />
              <StatusBars
                items={[
                  {
                    label: "รับเงิน",
                    value: sum(
                      payments.filter((p) => p.data.direction === "income"),
                      "amount",
                    ),
                  },
                  {
                    label: "จ่ายเงิน",
                    value: sum(
                      payments.filter((p) => p.data.direction === "expense"),
                      "amount",
                    ),
                  },
                  {
                    label: "ค่าใช้จ่ายที่อนุมัติ",
                    value: sum(expenses, "amount"),
                  },
                ]}
              />
            </section>
          </div>
        </>
      )}
      {view === "sales" && (
        <>
          <div className="zd-five">
            <NumberCard
              label="ยอดขายวันนี้ (บาท)"
              value={sum(
                sales.filter((s) => String(s.data.date) === today),
                "amount",
              )}
              tone="green"
              icon={TrendingUp}
            />
            <NumberCard
              label="เป้าหมาย (บาท)"
              value={sum(rows("deals"), "targetSales")}
              tone="blue"
              icon={Target}
            />
            <NumberCard
              label="ทำได้"
              value={
                (sum(rows("deals"), "targetSales")
                  ? Math.round(
                      (sum(sales, "amount") /
                        sum(rows("deals"), "targetSales")) *
                        100,
                    )
                  : 0) + "%"
              }
              tone="amber"
              icon={Percent}
            />
            <NumberCard
              label="ออเดอร์วันนี้"
              value={sales.filter((s) => String(s.data.date) === today).length}
            />
            <NumberCard
              label="เฉลี่ย/บิล (บาท)"
              value={sum(sales, "amount") / Math.max(1, sales.length)}
              tone="blue"
            />
          </div>
          <div className="zd-main-grid">
            <section className="z-card">
              <CardTitle title="ยอดขายตามช่องทาง" />
              <StatusBars items={groupedValues(sales, "channel", "amount")} />
              <h3>ยอดขายรายวัน</h3>
              <LineChart points={amountSeries(sales)} color="#318cea" />
            </section>
            <section className="z-card">
              <CardTitle title="AI สรุปยอดขาย" />
              <Insight
                icon={TrendingUp}
                title={`ยอดขายที่ยืนยัน ${money(sum(sales, "amount"))} บาท`}
                detail={`${sales.length} รายการ`}
                click={() => setKind("sales")}
              />
              <Insight
                icon={Package}
                title={`สต็อกต่ำ ${low.length} รายการ`}
                detail="ตรวจสินค้าและเตรียมเติมสต็อก"
                click={() => navigate("warehouse")}
              />
              <h3>สัดส่วนยอดขายตามช่องทาง</h3>
              <Donut items={groupedValues(sales, "channel", "amount")} />
            </section>
          </div>
        </>
      )}
      {view === "crm" && (
        <>
          <div className="zd-five">
            <NumberCard
              label="ลูกค้าทั้งหมด"
              value={customers.length}
              icon={Users}
            />
            <NumberCard
              label="Leads ใหม่"
              value={leads.filter((l) => l.data.stage === "lead").length}
              tone="blue"
            />
            <NumberCard
              label="ลูกค้าปัจจุบัน"
              value={customers.filter((l) => l.data.status === "active").length}
              tone="green"
            />
            <NumberCard
              label="ลูกค้า VIP"
              value={customers.filter((l) => l.data.segment === "vip").length}
              tone="amber"
            />
            <NumberCard label="มูลค่ารวม (บาท)" value={sum(leads, "amount")} />
          </div>
          <div className="zd-crm-grid">
            <section className="z-card">
              <CardTitle title="Sales Pipeline" />
              <div className="zd-funnel">
                {[
                  "lead",
                  "contact",
                  "meeting",
                  "proposal",
                  "negotiation",
                  "won",
                ].map((stage, i) => (
                  <div
                    key={stage}
                    style={{
                      width: 100 - i * 9 + "%",
                      background: [
                        "#3790fb",
                        "#55b8f4",
                        "#27c28b",
                        "#99d62a",
                        "#f2ad2b",
                        "#f16d3a",
                      ][i],
                    }}
                  >
                    <span>{stage}</span>
                    <strong>
                      {leads.filter((l) => l.data.stage === stage).length}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="z-card">
              <CardTitle title="ออเดอร์ล่าสุด / Deals" />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>มูลค่า (บาท)</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, 6).map((l) => (
                      <tr key={l.id}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => edit("leads", l)}
                          >
                            {String(
                              customers.find((c) => c.id === l.data.customerId)
                                ?.data.name || l.data.name,
                            )}
                          </button>
                        </td>
                        <td>{money(l.data.amount)}</td>
                        <td>
                          <span className="z-badge">
                            {String(l.data.stage)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!leads.length && <Empty title="ยังไม่มีโอกาสขาย" />}
            </section>
            <section className="z-card zd-insights">
              <CardTitle title="AI Summary" />
              <Insight
                icon={Users}
                title={`Leads ที่มีนัดติดตาม ${leads.filter((l) => l.data.nextDate && String(l.data.nextDate) <= today && !["won", "lost"].includes(String(l.data.stage))).length} รายการ`}
                detail="ตรวจนัดติดตามและติดต่อกลับ"
                click={() => setKind("leads")}
              />
            </section>
          </div>
          <div className="zd-main-grid">
            <section className="z-card">
              <CardTitle title="กิจกรรมติดต่อล่าสุด" />
              {leads
                .filter((l) => l.data.activity)
                .slice(0, 5)
                .map((l) => (
                  <div className="z-timeline" key={l.id}>
                    <Users size={14} />
                    <div>
                      <small>{displayDate(l.updated_at)}</small>
                      <p>{String(l.data.activity)}</p>
                    </div>
                  </div>
                ))}
              {!leads.some((l) => l.data.activity) && (
                <Empty title="ยังไม่มีกิจกรรมติดต่อ" />
              )}
            </section>
            <section className="z-card">
              <CardTitle title="มูลค่าโอกาสขาย" />
              <LineChart
                points={amountSeries(leads, "amount", "created_at", "month")}
                color="#318cea"
              />
            </section>
          </div>
        </>
      )}
      {(view === "marketing" || view === "design") && (
        <>
          {!project ? (
            <Empty title="ยังไม่มีโครงการ" />
          ) : (
            <>
              <div className="zd-project-title">
                <h2>
                  {view === "design" ? "Project" : "EVENT"} :{" "}
                  {String(project.data.name)}
                </h2>
                <select
                  value={project.id}
                  aria-label="เลือกโครงการของแผนก"
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {projects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {String(p.data.name)}
                    </option>
                  ))}
                </select>
                <span
                  className={
                    "z-badge " +
                    (project.data.status === "active"
                      ? "z-approved"
                      : "z-pending")
                  }
                >
                  {project.data.status === "active"
                    ? "กำลังดำเนินการ"
                    : "รอตรวจทาน"}
                </span>
                <small>กำหนดส่ง : {displayDate(project.data.endDate)}</small>
              </div>
              <div className="zd-five">
                {view === "marketing" ? (
                  <>
                    <NumberCard
                      label="เป้าหมายยอดขาย (บาท)"
                      value={n?.target || 0}
                      tone="green"
                    />
                    <NumberCard
                      label="ยอดขายปัจจุบัน (บาท)"
                      value={n?.sales || 0}
                      tone="blue"
                    />
                    <NumberCard
                      label="ความคืบหน้า"
                      value={(n?.progress || 0) + "%"}
                    />
                    <NumberCard
                      label="ค่าเช่า / งบประมาณ (บาท)"
                      value={Number(project.data.budget || 0)}
                    />
                    <NumberCard
                      label="งานที่ต้องติดตาม"
                      value={
                        projectTasks.filter((t) => t.data.status !== "done")
                          .length
                      }
                    />
                  </>
                ) : (
                  <>
                    <NumberCard
                      label="ความคืบหน้า"
                      value={(n?.progress || 0) + "%"}
                      tone="green"
                    />
                    <NumberCard
                      label="งานที่ต้องทำ"
                      value={
                        projectTasks.filter((t) => t.data.status !== "done")
                          .length
                      }
                      tone="blue"
                    />
                    <NumberCard
                      label="งานรออนุมัติ"
                      value={
                        projectTasks.filter((t) => t.data.status === "review")
                          .length
                      }
                      tone="amber"
                    />
                    <NumberCard
                      label="ล่าช้า"
                      value={
                        late.filter((t) => t.data.projectId === project.id)
                          .length
                      }
                      tone="rose"
                    />
                    <NumberCard
                      label="วันเหลือ"
                      value={
                        project.data.endDate
                          ? Math.max(
                              0,
                              Math.ceil(
                                (Number(
                                  new Date(String(project.data.endDate)),
                                ) -
                                  Date.now()) /
                                  86400000,
                              ),
                            ) + " วัน"
                          : "—"
                      }
                    />
                  </>
                )}
              </div>
              <section className="z-card">
                <div className="z-tabs">
                  {[
                    "Layout Plan",
                    "Perspective 3D",
                    "Site Photo",
                    "Documents",
                    "Timeline",
                  ].map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        navigate(
                          "projects",
                          project.id,
                          t === "Site Photo"
                            ? "ภาพหน้างานจริง"
                            : t === "Documents"
                              ? "เอกสารไฟล์"
                              : t,
                        )
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <ProjectGallery
                  project={project}
                  ctx={ctx}
                  open={(tab) => navigate("projects", project.id, tab)}
                />
                {ctx.demo && (
                  <small className="zd-computed">
                    ภาพตัวอย่างจาก PPTX · ไฟล์โครงการจริงอยู่ในหน้ารายละเอียด
                  </small>
                )}
              </section>
              <div className="zd-three">
                <section className="z-card">
                  <CardTitle
                    title={
                      view === "design"
                        ? "งาน Design Team"
                        : "ยอดขายรายวัน (บาท)"
                    }
                  />
                  {view === "marketing" ? (
                    <LineChart points={amountSeries(projectSales)} />
                  ) : (
                    projectTasks
                      .filter((t) => t.department === "Design")
                      .map((t) => (
                        <div className="z-requirement" key={t.id}>
                          <div>
                            <strong>{String(t.data.name)}</strong>
                            <small>{String(t.data.assignee || "—")}</small>
                          </div>
                          <span className="z-badge">
                            {String(t.data.status)}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => edit("tasks", t)}
                          >
                            Edit
                          </button>
                        </div>
                      ))
                  )}
                </section>
                <section className="z-card">
                  <CardTitle title="Timeline ความคืบหน้า" />
                  <div className="zd-small-workflow">
                    {projectWorkflow.map((s, i) => (
                      <button
                        key={s.key}
                        onClick={() =>
                          navigate("projects", project.id, "Timeline")
                        }
                      >
                        <span>{i + 1}</span>
                        <s.icon size={17} />
                        <small>{s.label}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="z-card zd-insights">
                  <CardTitle title="AI Insight" />
                  <Insight
                    icon={CheckCircle2}
                    title={`งานเสร็จแล้ว ${n?.done || 0} จาก ${n?.tasks.length || 0} งาน`}
                    detail="อ้างอิงสถานะงานล่าสุด"
                    click={() => navigate("projects", project.id)}
                  />
                  <Insight
                    icon={Clock3}
                    title={`มี ${late.filter((t) => t.data.projectId === project.id).length} งานเกินกำหนด`}
                    detail="ตรวจวันครบกำหนดและผู้รับผิดชอบ"
                    click={() => navigate("projects", project.id)}
                  />
                </section>
              </div>
            </>
          )}
        </>
      )}
      {(view === "purchasing" || view === "warehouse") && (
        <PurchaseLifecycle
          rows={purchases}
          ctx={ctx}
          changed={() => {
            setRefresh((r) => r + 1);
            changed();
          }}
          notify={notify}
        />
      )}
      {(view === "purchasing" || view === "warehouse") &&
        (ctx.member.role === "owner" ||
          ctx.member.departments.includes("Warehouse")) && (
          <StockTransfers
            ctx={ctx}
            entities={entities}
            changed={() => {
              setRefresh((r) => r + 1);
              changed();
            }}
            notify={notify}
          />
        )}
      <section className="z-card zd-record-tools">
        <div className="z-tabs">
          {tabOptions.map(([k, label]) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <Records
          key={kind}
          kind={kind}
          refresh={refresh}
          ctx={ctx}
          notify={notify}
          changed={changed}
        />
      </section>
    </div>
  );
}
function CardTitle({ title, action }: { title: string; action?: () => void }) {
  return (
    <div className="z-card-heading">
      <h2>{title}</h2>
      {action && (
        <button className="text-button" onClick={action}>
          ดูทั้งหมด
          <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );
}
function Insight({
  icon: Icon,
  title,
  detail,
  click,
}: {
  icon: typeof Sparkles;
  title: string;
  detail: string;
  click: () => void;
}) {
  return (
    <button className="zd-insight" onClick={click}>
      <Icon size={20} />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <ArrowRight size={14} />
    </button>
  );
}
