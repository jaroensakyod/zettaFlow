import { z } from "zod";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { supabaseServer, configured } from "./supabase/server";
import {
  demoEnabled,
  demoRead,
  demoContext,
  demoMutate,
  demoAudit,
  demoMovement,
  demoApprove,
  publicDemoAllowed,
  PUBLIC_DEMO_COOKIE,
} from "./demo";
import { derive, needsApprover, stockEffect, stockLocked, convertData, conversions, fitToPage } from "./dept-rules";
import {
  assert,
  AppError,
  canRead,
  canWrite,
  validateEntity,
  entityDepartment,
  requireOwner,
  templateSchema,
  validateValues,
  dashboardSummary,
  codePrefixes,
  thaiYear,
  formatCode,
} from "./domain";
import { catalog } from "./catalog";
import type { Context, Entity, Template, Ingestion, HomeData } from "./types";
export function dbError(error: { message: string; code?: string } | null) {
  if (error?.code === "23505")
    throw new AppError("รหัสหรือเลขอ้างอิงนี้มีอยู่แล้ว กรุณาใช้ค่าอื่น", 409);
  if (error?.code === "42501") throw new AppError("ไม่มีสิทธิ์ดำเนินการ", 403);
  if (error?.code === "PGRST202" || error?.code === "42P01")
    throw new AppError(
      "ฐานข้อมูลยังไม่พร้อม กรุณารัน SQL migrations ของ EliteFlow",
      503,
    );
  if (error) throw new AppError(error.message, 400);
}
export async function context(): Promise<Context> {
  if (
    demoEnabled() ||
    (publicDemoAllowed() &&
      (await cookies()).get(PUBLIC_DEMO_COOKIE)?.value === "1")
  )
    return demoContext();
  assert(configured(), "ตั้งค่า Supabase ก่อนใช้งาน", 503);
  const sb = await supabaseServer();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  assert(user && !error, "กรุณาเข้าสู่ระบบ", 401);
  const { error: inviteError } = await sb.rpc("accept_invitations");
  dbError(inviteError);
  const { data: members, error: memberError } = await sb
    .from("memberships")
    .select("*")
    .eq("user_id", user.id)
    .eq("disabled", false);
  dbError(memberError);
  assert(members?.length, "สร้างบริษัทเพื่อเริ่มใช้งาน", 428);
  const selected = (await cookies()).get("ef_company")?.value;
  const member = members.find((m) => m.company_id === selected) || members[0];
  const { data: company, error: companyError } = await sb
    .from("companies")
    .select("*")
    .eq("id", member.company_id)
    .single();
  dbError(companyError);
  assert(company, "ไม่พบบริษัท", 403);
  return {
    user: {
      id: user.id,
      email: user.email || "",
      name: user.user_metadata.name || user.email,
    },
    member,
    company,
    demo: false,
  };
}
export async function listEntities(
  ctx: Context,
  kind?: string,
  page = 0,
  search = "",
  archived = false,
) {
  if (kind) assert(catalog[kind], "ไม่พบโมดูล", 404);
  if (ctx.demo) {
    let rows = (await demoRead()).entities.filter(
      (e) =>
        canRead(ctx, e.department) &&
        !!e.archived_at === archived &&
        (!kind || e.kind === kind),
    );
    if (search)
      rows = rows.filter((e) =>
        JSON.stringify(e.data).toLowerCase().includes(search.toLowerCase()),
      );
    rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { rows: rows.slice(page * 25, page * 25 + 25), count: rows.length };
  }
  const sb = await supabaseServer();
  let query = sb
    .from("entities")
    .select("*", { count: "exact" })
    .eq("company_id", ctx.company.id)
    .order("updated_at", { ascending: false })
    .range(page * 25, page * 25 + 24);
  query = archived
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null);
  if (kind) query = query.eq("kind", kind);
  if (search)
    query = query.ilike("data->>name", `%${search.replace(/[%_]/g, "")}%`);
  const { data, error, count } = await query;
  dbError(error);
  return { rows: (data || []) as Entity[], count: count || 0 };
}
/** Every live record of one kind the user may read (newest first), for pages that summarise a whole list. */
export async function allEntities(ctx: Context, kind: string, limit = 2000) {
  if (ctx.demo)
    return (await demoRead()).entities
      .filter((e) => e.kind === kind && !e.archived_at && canRead(ctx, e.department))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("entities")
    .select("*")
    .eq("company_id", ctx.company.id)
    .eq("kind", kind)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  dbError(error);
  return (data || []) as Entity[];
}
export async function entityOptions(ctx: Context) {
  if (ctx.demo)
    return (await demoRead()).entities
      .filter((e) => !e.archived_at && canRead(ctx, e.department))
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        name: String(e.data.name || e.data.sku || e.id),
      }));
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("entities")
    .select("id,kind,data")
    .eq("company_id", ctx.company.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1000);
  dbError(error);
  return (data || []).map((e) => ({
    id: e.id,
    kind: e.kind,
    name: String(e.data.name || e.data.sku || e.id),
  }));
}
export async function saveEntity(
  ctx: Context,
  kind: string,
  input: unknown,
  id?: string,
  version?: number,
) {
  const data = validateEntity(kind, input),
    department = entityDepartment(kind, data);
  assert(canWrite(ctx, department), "ไม่มีสิทธิ์แก้ไขแผนกนี้", 403);
  if (!id && needsApprover(kind, data.status) && !["owner", "manager"].includes(ctx.member.role))
    throw new AppError("ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้", 403);
  if (
    ["deals", "expenses", "leaves", "payroll"].includes(kind) &&
    ["approved", "paid"].includes(String(data.status))
  )
    assert(
      ["owner", "manager"].includes(ctx.member.role),
      "ต้องให้ผู้มีสิทธิ์อนุมัติ",
      403,
    );
  if (ctx.demo)
    return demoMutate((s) => {
      for (const field of catalog[kind].fields.filter(
        (f) => f.type === "relation",
      ))
        if (data[field.key])
          assert(
            s.entities.some(
              (e) =>
                e.id === data[field.key] &&
                e.kind === field.resource &&
                !e.archived_at,
            ),
            "ข้อมูลอ้างอิงไม่ถูกต้อง",
          );
      const old = id
        ? s.entities.find(
            (e) =>
              e.id === id && e.kind === kind && e.company_id === ctx.company.id,
          )
        : undefined;
      if (id) {
        assert(old && canWrite(ctx, old.department), "ไม่พบรายการ", 404);
        assert(old.version === version, "ข้อมูลเปลี่ยนแล้ว กรุณารีเฟรช", 409);
        assert(!old.archived_at, "รายการนี้เก็บเข้าคลังแล้ว", 409);
      }
      if (old && needsApprover(kind, data.status, old.data.status))
        assert(["owner", "manager"].includes(ctx.member.role), "ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้", 403);
      if (old && stockLocked(kind, old.data.status))
        assert(["productId", "quantity", "countedQty"].every((k) => old.data[k] === data[k]), "ปรับสต็อกไปแล้ว แก้จำนวนไม่ได้", 409);
      Object.assign(data, derive(kind, data));
      if (kind === "deals" && data.status === "approved")
        assert(
          old?.data.status === "approved",
          "ใช้ปุ่มอนุมัติดีลเพื่อสร้าง Workflow",
        );
      if (kind === "products") {
        assert(
          !s.entities.some(
            (e) =>
              e.kind === "products" &&
              !e.archived_at &&
              e.id !== id &&
              e.data.sku === data.sku,
          ),
          "SKU ซ้ำ",
          409,
        );
        data.stock = old?.data.stock || 0;
      }
      if (kind === "purchases") {
        assert(
          old?.data.status !== "received",
          "ใบสั่งซื้อรับแล้วแก้ไขไม่ได้",
          409,
        );
        data.status = "draft";
      }
      if (kind === "payments")
        assert(!old, "การชำระเงินแก้ไขไม่ได้ ใช้เก็บเข้าคลังเพื่อยกเลิก", 409);
      if (kind === "invoices") {
        data.paid = old?.data.paid || 0;
        assert(Number(data.total) >= Number(data.paid), "ยอดต่ำกว่ายอดรับชำระ");
        data.status =
          Number(data.paid) >= Number(data.total)
            ? "paid"
            : Number(data.paid) > 0
              ? "partial"
              : "issued";
      }
      const prefix = codePrefixes[kind];
      if (prefix && !data.code) {
        const books = (s.accounting ||= { journals: [], wht: [], counters: {} }),
          key = prefix;
        data.code = old?.data.code || formatCode(prefix, thaiYear(), (books.counters[key] = (books.counters[key] || 0) + 1));
      }
      const record: Entity = {
        id: id || randomUUID(),
        company_id: ctx.company.id,
        kind,
        department,
        data,
        created_by: old?.created_by || ctx.user.id,
        created_at: old?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: (old?.version || 0) + 1,
        archived_at: null,
      };
      const oldStatus = old?.data.status;
      if (old) Object.assign(old, record);
      else s.entities.unshift(record);
      const product = data.productId ? s.entities.find((e) => e.id === data.productId && e.kind === "products") : undefined;
      const move = stockEffect(kind, data, oldStatus, Number(product?.data.stock || 0));
      if (move && product) demoMovement(s, product.id, move.type, move.quantity, kind + ":" + record.id, String(data.name || ""));
      if (kind === "payments" && data.invoiceId) {
        const inv = s.entities.find(
          (e) => e.id === data.invoiceId && e.kind === "invoices",
        );
        assert(inv, "ไม่พบใบแจ้งหนี้");
        const total = s.entities
          .filter(
            (e) =>
              e.kind === "payments" &&
              !e.archived_at &&
              e.data.invoiceId === inv.id &&
              e.data.direction === "income",
          )
          .reduce((a, e) => a + Number(e.data.amount), 0);
        assert(total <= Number(inv.data.total), "รับชำระเกินยอด");
        inv.data.paid = total;
        inv.data.status =
          total === Number(inv.data.total)
            ? "paid"
            : total > 0
              ? "partial"
              : "issued";
        inv.version++;
      }
      demoAudit(s, old ? "updated" : "created", record.id);
      return record;
    });
  const sb = await supabaseServer();
  const { data: record, error } = await sb.rpc("save_entity", {
    p_company: ctx.company.id,
    p_kind: kind,
    p_data: data,
    p_id: id || null,
    p_version: version || null,
  });
  dbError(error);
  return record as Entity;
}
/** The code the next new customer / supplier will get (does not reserve it). */
export async function nextCode(ctx: Context, kind: string) {
  const prefix = codePrefixes[kind];
  assert(prefix, "ไม่มีรหัสอัตโนมัติ", 404);
  if (ctx.demo) {
    const n = ((await demoRead()).accounting?.counters[prefix] || 0) + 1;
    return { code: formatCode(prefix, thaiYear(), n) };
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("peek_code", { p_company: ctx.company.id, p_kind: kind });
  dbError(error);
  return { code: String(data || "") };
}
export async function archiveEntity(
  ctx: Context,
  id: string,
  archive: boolean,
) {
  assert(
    ["owner", "manager"].includes(ctx.member.role),
    "ไม่มีสิทธิ์เก็บเข้าคลัง",
    403,
  );
  if (ctx.demo)
    return demoMutate((s) => {
      const record = s.entities.find((e) => e.id === id);
      assert(record && canWrite(ctx, record.department), "ไม่พบรายการ", 404);
      assert(
        !(record.kind === "products" && Number(record.data.stock) !== 0),
        "ต้องทำยอดสต็อกเป็นศูนย์ก่อน",
      );
      assert(
        !(record.kind === "purchases" && record.data.status === "received"),
        "ใบสั่งซื้อรับแล้วเก็บเข้าคลังไม่ได้",
      );
      record.archived_at = archive ? new Date().toISOString() : null;
      record.version++;
      if (record.kind === "payments" && record.data.invoiceId) {
        const inv = s.entities.find((e) => e.id === record.data.invoiceId);
        assert(inv, "ไม่พบใบแจ้งหนี้");
        const paid = s.entities
          .filter(
            (e) =>
              e.kind === "payments" &&
              !e.archived_at &&
              e.data.invoiceId === inv.id &&
              e.data.direction === "income",
          )
          .reduce((sum, e) => sum + Number(e.data.amount), 0);
        assert(paid <= Number(inv.data.total), "รับชำระเกินยอด");
        inv.data.paid = paid;
        inv.data.status =
          paid >= Number(inv.data.total)
            ? "paid"
            : paid > 0
              ? "partial"
              : "issued";
        inv.version++;
      }
      demoAudit(s, archive ? "archived" : "restored", id);
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("archive_entity", {
    p_company: ctx.company.id,
    p_id: id,
    p_archive: archive,
  });
  dbError(error);
}
export async function movement(
  ctx: Context,
  input: {
    productId: string;
    type: string;
    quantity: number;
    reference: string;
    notes?: string;
  },
) {
  assert(canWrite(ctx, "Warehouse"), "ไม่มีสิทธิ์คลังสินค้า", 403);
  if (ctx.demo)
    return demoMutate((s) =>
      demoMovement(
        s,
        input.productId,
        input.type,
        input.quantity,
        input.reference,
      ),
    );
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("post_stock_movement", {
    p_company: ctx.company.id,
    p_product: input.productId,
    p_type: input.type,
    p_quantity: input.quantity,
    p_reference: input.reference,
    p_notes: input.notes || "",
  });
  dbError(error);
  return data;
}
export async function purchaseAction(ctx: Context, id: string, action: string) {
  assert(canWrite(ctx, "Purchasing"), "ไม่มีสิทธิ์จัดซื้อ", 403);
  assert(
    [
      "approve",
      "receive",
      "request_vendor",
      "vendor_confirm",
      "dispatch",
      "deliver",
      "cancel",
    ].includes(action),
    "คำสั่งไม่ถูกต้อง",
  );
  if (ctx.demo)
    return demoMutate((s) => {
      const r = s.entities.find(
        (e) => e.id === id && e.kind === "purchases" && !e.archived_at,
      );
      assert(r, "ไม่พบใบสั่งซื้อ", 404);
      if (action === "approve") {
        assert(
          ["owner", "manager"].includes(ctx.member.role),
          "ไม่มีสิทธิ์อนุมัติ",
          403,
        );
        assert(r.data.status === "draft", "รายการนี้อนุมัติแล้ว", 409);
        r.data.status = "approved";
        r.data.poNumber ||=
          "PO-" + r.id.replaceAll("-", "").slice(0, 12).toUpperCase();
      } else if (action === "receive") {
        assert(canWrite(ctx, "Warehouse"), "ไม่มีสิทธิ์คลังสินค้า", 403);
        assert(
          [
            "approved",
            "pending_vendor",
            "in_progress",
            "pending_delivery",
            "delivered",
          ].includes(String(r.data.status)),
          "ต้องอนุมัติก่อนรับ หรือรับสินค้าไปแล้ว",
          409,
        );
        demoMovement(
          s,
          String(r.data.productId),
          "in",
          Number(r.data.quantity),
          "PO:" + id,
        );
        r.data.status = "received";
      } else if (action === "cancel") {
        assert(
          !["received", "cancelled"].includes(String(r.data.status)),
          "รายการนี้รับแล้วหรือยกเลิกแล้ว",
          409,
        );
        assert(
          r.data.status === "draft" ||
            ["owner", "manager"].includes(ctx.member.role),
          "ให้หัวหน้างานยกเลิกใบสั่งซื้อที่อนุมัติแล้ว",
          403,
        );
        r.data.status = "cancelled";
      } else {
        const transitions: Record<string, [string, string]> = {
          request_vendor: ["approved", "pending_vendor"],
          vendor_confirm: ["pending_vendor", "in_progress"],
          dispatch: ["in_progress", "pending_delivery"],
          deliver: ["pending_delivery", "delivered"],
        };
        const [previous, next] = transitions[action];
        assert(
          r.data.status === previous,
          "ขั้นตอนนี้ไม่สอดคล้องกับสถานะปัจจุบัน",
          409,
        );
        r.data.status = next;
      }
      r.version++;
      r.updated_at = new Date().toISOString();
      demoAudit(s, "purchase_" + action, id);
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("purchase_action", {
    p_company: ctx.company.id,
    p_id: id,
    p_action: action,
  });
  dbError(error);
}
export async function summary(ctx: Context) {
  if (ctx.demo) {
    const s = await demoRead();
    return {
      summary: {
        ...dashboardSummary(
          s.entities.filter((e) => canRead(ctx, e.department)),
        ),
        widgets: s.templates
          .filter((t) => canRead(ctx, t.department))
          .flatMap((t) =>
            t.fields
              .filter((f) => f.type === "number")
              .map((f) => {
                const values = s.ingestions
                  .filter(
                    (i) =>
                      i.status === "approved" &&
                      i.template.id === t.id &&
                      canRead(ctx, i.template.department),
                  )
                  .map((i) => i.values[f.key])
                  .filter((v) => typeof v === "number") as number[];
                return {
                  key: t.id + ":" + f.key,
                  name: t.name,
                  label: f.label,
                  total: values.reduce((s, v) => s + v, 0),
                  count: values.length,
                };
              }),
          ),
      },
      recent: s.entities
        .filter((e) => !e.archived_at && canRead(ctx, e.department))
        .slice(0, 12),
      audit: ctx.member.role === "owner" ? s.audit.slice(0, 15) : [],
    };
  }
  const sb = await supabaseServer();
  const { data: result, error } = await sb.rpc("dashboard_summary", {
    p_company: ctx.company.id,
  });
  dbError(error);
  const [
    { data: series, error: seriesError },
    { data: widgets, error: widgetError },
  ] = await Promise.all([
    sb.rpc("analytics_series", { p_company: ctx.company.id }),
    sb.rpc("template_metrics", { p_company: ctx.company.id }),
  ]);
  dbError(seriesError);
  dbError(widgetError);
  const { data: recent, error: e } = await sb
    .from("entities")
    .select("*")
    .eq("company_id", ctx.company.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(12);
  dbError(e);
  const { data: audit } =
    ctx.member.role === "owner"
      ? await sb
          .from("audit_events")
          .select("*")
          .eq("company_id", ctx.company.id)
          .order("created_at", { ascending: false })
          .limit(15)
      : { data: [] };
  return { summary: { ...result, series, widgets }, recent, audit };
}
const counted = (kind: unknown, status: unknown) =>
  kind === "sales"
    ? status === "confirmed"
    : ["approved", "paid"].includes(String(status));
export async function home(ctx: Context): Promise<HomeData> {
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  if (ctx.demo) {
    const rows = (await demoRead()).entities.filter(
      (e) => !e.archived_at && canRead(ctx, e.department),
    );
    return {
      finance: rows
        .filter(
          (e) =>
            (e.kind === "sales" || e.kind === "expenses") &&
            counted(e.kind, e.data.status) &&
            String(e.data.date || "") >= since,
        )
        .map((e) => ({
          kind: e.kind as "sales" | "expenses",
          date: String(e.data.date),
          amount: Number(e.data.amount || 0),
          projectId: e.data.projectId ? String(e.data.projectId) : null,
        })),
      projects: rows
        .filter((e) => e.kind === "projects")
        .map((e) => ({ id: e.id, name: String(e.data.name) })),
      tasks: rows.filter((e) => e.kind === "tasks").slice(0, 300),
    };
  }
  const sb = await supabaseServer();
  const [finance, projects, tasks] = await Promise.all([
    sb
      .from("entities")
      .select(
        "kind,date:data->>date,amount:data->>amount,status:data->>status,projectId:data->>projectId",
      )
      .eq("company_id", ctx.company.id)
      .is("archived_at", null)
      .in("kind", ["sales", "expenses"])
      .gte("data->>date", since)
      .limit(5000),
    sb
      .from("entities")
      .select("id,name:data->>name")
      .eq("company_id", ctx.company.id)
      .is("archived_at", null)
      .eq("kind", "projects")
      .order("updated_at", { ascending: false })
      .limit(200),
    sb
      .from("entities")
      .select("*")
      .eq("company_id", ctx.company.id)
      .is("archived_at", null)
      .eq("kind", "tasks")
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);
  dbError(finance.error);
  dbError(projects.error);
  dbError(tasks.error);
  return {
    finance: (
      (finance.data || []) as unknown as {
        kind: "sales" | "expenses";
        date: string;
        amount: string;
        status: string;
        projectId: string | null;
      }[]
    )
      .filter((r) => counted(r.kind, r.status))
      .map((r) => ({
        kind: r.kind,
        date: r.date,
        amount: Number(r.amount || 0),
        projectId: r.projectId || null,
      })),
    projects: ((projects.data || []) as unknown as { id: string; name: string }[]),
    tasks: (tasks.data || []) as Entity[],
  };
}
export async function templates(ctx: Context) {
  if (ctx.demo)
    return (await demoRead()).templates.filter((t) =>
      canRead(ctx, t.department),
    );
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("data_templates")
    .select("*")
    .eq("company_id", ctx.company.id)
    .order("created_at");
  dbError(error);
  return (data || []) as Template[];
}
export async function saveTemplate(ctx: Context, input: unknown, id?: string) {
  requireOwner(ctx);
  const result = templateSchema.safeParse(input);
  assert(
    result.success,
    "Template ไม่ถูกต้อง: " +
      (!result.success
        ? result.error.issues.map((i) => i.message).join(", ")
        : ""),
  );
  const t = result.data;
  if (ctx.demo)
    return demoMutate((s) => {
      const old = id ? s.templates.find((t) => t.id === id) : null;
      if (id) assert(old, "ไม่พบ Template", 404);
      const next: Template = {
        ...t,
        id: id || randomUUID(),
        company_id: ctx.company.id,
        version: (old?.version || 0) + 1,
      };
      if (old) Object.assign(old, next);
      else s.templates.push(next);
      demoAudit(s, "template_saved", next.id);
      return next;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("save_template", {
    p_company: ctx.company.id,
    p_name: t.name,
    p_department: t.department,
    p_fields: t.fields,
    p_steps: t.steps,
    p_id: id || null,
  });
  dbError(error);
  return data;
}
export async function ingestions(ctx: Context) {
  if (ctx.demo)
    return (await demoRead()).ingestions.filter((i) =>
      canRead(ctx, i.template.department),
    );
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("ingestions")
    .select("*")
    .eq("company_id", ctx.company.id)
    .order("created_at", { ascending: false })
    .limit(100);
  dbError(error);
  return (data || []) as Ingestion[];
}
export async function decide(
  ctx: Context,
  id: string,
  input: { status: string; values: Record<string, unknown>; reason: string },
) {
  assert(
    ["owner", "manager"].includes(ctx.member.role),
    "ไม่มีสิทธิ์อนุมัติ",
    403,
  );
  if (ctx.demo)
    return demoMutate((s) => {
      const i = s.ingestions.find((i) => i.id === id);
      assert(i && canRead(ctx, i.template.department), "ไม่พบรายการ", 404);
      demoApprove(s, id, input.values, input.status, input.reason);
    });
  const items = await ingestions(ctx);
  const i = items.find((i) => i.id === id);
  assert(i, "ไม่พบรายการ", 404);
  if (input.status === "approved")
    validateValues(i.template, input.values, true);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("decide_ingestion", {
    p_company: ctx.company.id,
    p_id: id,
    p_status: input.status,
    p_values: input.values,
    p_reason: input.reason || "",
  });
  dbError(error);
}
/** Owner points a Data Template (and every LINE group using it) at a workspace page; approved items are copied there. */
export async function setTemplateTarget(ctx: Context, id: string, input: unknown) {
  requireOwner(ctx);
  const { kind, map } = z
    .object({ kind: z.string().max(40).nullable(), map: z.record(z.string().max(40), z.string().max(40)).default({}) })
    .parse(input);
  assert(!kind || catalog[kind], "ไม่พบหน้าปลายทาง");
  if (ctx.demo)
    return demoMutate((s) => {
      const t = s.templates.find((t) => t.id === id);
      assert(t, "ไม่พบ Template", 404);
      t.target_kind = kind;
      t.field_map = map;
      demoAudit(s, "template_target", id);
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_template_target", { p_company: ctx.company.id, p_id: id, p_kind: kind, p_map: map });
  dbError(error);
}
/** Next step for a document (quotation → SO → invoice, paid bill → payment, hired applicant → employee). Runs once per source. */
export async function convertEntity(ctx: Context, kind: string, id: string) {
  const rule = conversions.find((c) => c.from === kind);
  assert(rule, "แปลงเอกสารนี้ไม่ได้", 404);
  let src: Entity | undefined;
  if (ctx.demo) src = (await demoRead()).entities.find((e) => e.id === id && e.kind === kind && !e.archived_at);
  else {
    const sb = await supabaseServer();
    const { data, error } = await sb.from("entities").select("*").eq("company_id", ctx.company.id).eq("kind", kind).eq("id", id).is("archived_at", null).maybeSingle();
    dbError(error);
    src = data || undefined;
  }
  assert(src && canRead(ctx, src.department), "ไม่พบรายการ", 404);
  assert(rule.when.includes(String(src.data.status)), "ทำได้เมื่อสถานะเป็น " + rule.when.join(" / "));
  const { data, exists } = convertData(src);
  assert(!(await allEntities(ctx, rule.to, 5000)).some(exists), "สร้างไปแล้ว", 409);
  const created = await saveEntity(ctx, rule.to, fitToPage(rule.to, data));
  if (rule.done) await saveEntity(ctx, kind, { ...src.data, status: rule.done }, src.id, src.version);
  return { kind: rule.to, record: created };
}
