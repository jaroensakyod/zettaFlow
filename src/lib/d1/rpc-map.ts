// The RPCs the app calls with `sb.rpc(name, args)`, each mapped to its TypeScript port on D1. A handler takes the
// app's named arguments exactly as supabase-js sent them to PostgREST (an omitted argument takes the Postgres default;
// an explicit null stays null), picks the tenant the Postgres function ran as, calls the port and returns what
// supabase-js gave the app: jsonb → the value, a table row → the row object, setof → an array, scalar → the scalar,
// void → null.
//
// Who may call what follows the GRANTs of supabase/schema.sql:
// - service: granted to service_role only (webhooks, cron, the AI worker, the platform admin console, share page).
//   Anyone else gets Postgres's "permission denied for function <name>".
// - member: granted to authenticated (service_role kept its default grant). The function asks member_role(p_company);
//   caller.tenantFor() answers that. For a non-member (or the service role, whose auth.uid() is null) the handler gives
//   what the Postgres function gave a non-member when that is not a plain 'ไม่มีสิทธิ์': its own message, or the
//   empty answer of a read (null, [], 0).
// - person: granted to authenticated, no company argument (feed likes, company cards, one's own picture, ...): the
//   port runs as the signed-in person, without a company.
// The anon role was revoked from every one of these functions.
import { AppError } from "../domain";
import type { Sql, Stmt } from "./driver";
import { Tenant } from "./tenant";
import type { RpcCaller, RpcHandler } from "./rpc-types";
import { fail, serviceTenant, systemTenant } from "./common";
import { archiveEntity, saveEntity } from "./entities";
import { EntityRows, stockMove } from "./entity-insert";
import { purchaseAction, transferProjectStock, updateProjectStage } from "./operations";
import { approveDeal, queueNudges, saveEntityAs, saveTemplate, setTemplateTarget, webApprovalAct } from "./approvals";
import { addPlatformCustomer, adminGrantPlan, adminRevokeGrant, platformCustomerOnSignup } from "./billing-admin";
import { buyFeedAd, feedAdTrack, feedAdsLive, myFeedAds, setFeedAdStatus } from "./billing-ads";
import { expireSubscriptions, hasAddon, trialUsage } from "./billing-plan";
import { buyModule, confirmPayment, confirmTopup, requestPayment, requestTopup, shopActivate, shopBuy } from "./billing-shop";
import { acceptInvitations, companyCard, companyCover, createCompany, editMember, endSupportAccess, setMemberAccess, inviteMember, presencePing, saveCompany, sendMessage, supportReply, supportSeen, supportSend, type SignedInUser } from "./company";
import { clearSampleData, loadSampleData } from "./company-sample";
import { claimNotifications, createShare, noteDelete, noteSave, revokeShare, saveDashboardLayout, shareFailed, shareLockout, shareMetrics } from "./company-share";
import { documentNumber, financeCloseStep, financeSaveBudgets, financeSaveTargets, goalSet, issueDocument, issuedDocumentsList, postExpense, seedAccountsStmts } from "./finance";
import {
  addAttachment,
  claimIngestion,
  commentDesignRevision,
  completeIngestion,
  completeSortedIngestion,
  createDesignRevision,
  decideIngestion,
  itemFileCount,
  linkAttachment,
  peekCode,
  purgeVoiceFiles,
  retryIngestion,
  reviewDesignRevision,
  submitIngestion,
} from "./ingestion";
import {
  lineAddEvidence,
  lineApprovalAct,
  lineApprove,
  lineDecide,
  lineDocuments,
  lineDraftDecide,
  lineEvidenceCheck,
  lineExpensePaid,
  lineExpenseSummary,
  lineKeywordApprove,
  lineQuickStats,
  lineSetApprovers,
  lineSlipCheck,
  pairLineGroup,
  pairLineUser,
  removeLineApprover,
  setLineGroupListen,
  unlinkLineGroup,
  updateLineGroup,
} from "./line";
import { b2bInbox, b2bOpen, b2bPost, b2bRead, b2bSend, b2bUnread, myAvatar, setMyAvatar } from "./network-chat";
import {
  b2bDealCancel,
  b2bDealCancelAnswer,
  b2bDealCheck,
  b2bDealDecide,
  b2bDealDeliver,
  b2bDealInvoice,
  b2bDealPay,
  b2bDealProgress,
  b2bDealQuote,
  b2bDealReceive,
  b2bDealRequest,
  b2bDealWithdraw,
  b2bDealsOf,
  b2bDealTake,
} from "./network-deals";
import {
  feedAlerts,
  feedComment,
  feedCompanies,
  feedCompanyProfile,
  feedDelete,
  feedFollow,
  feedFollowList,
  feedLike,
  feedList,
  feedPost,
  feedProposalStatus,
  feedProposals,
  feedPropose,
  feedSave,
  feedShare,
  feedSuggest,
  feedView,
} from "./network-feed";
import { analyticsSeries, calendarEntries, dashboardSummary, templateBreakdowns, templateMetrics, usageSummary } from "./reports";

type Args = Record<string, unknown>;
/**
 * An argument as PostgREST passed it: omitted → the function's default (null when it has none), explicit null → null.
 * Typed `never` so it fits whatever the port's parameter is; the ports check the values like the SQL did.
 */
const g = (a: Args, k: string, dflt: unknown = null): never => (a[k] === undefined ? dflt : a[k]) as never;
/** void → null, as supabase-js gives it. */
const out = (v: unknown) => (v === undefined ? null : v);

const denied = (name: string): never => {
  throw new AppError(`permission denied for function ${name}`, 403);
};
/** What the Postgres function gave a caller who is not a member of p_company. */
type NotMember = { error: string; status?: number } | { value: unknown };
const NOT_MEMBER = Symbol("not a member");

/** A function granted to service_role only. */
const service =
  (name: string, fn: (sql: Sql, a: Args, caller: RpcCaller) => Promise<unknown> | unknown): RpcHandler =>
  async (caller, a) => {
    if (!caller.service) denied(name);
    return out(await fn(caller.sql, a, caller));
  };
/** A function granted to authenticated (and, by Supabase's default, service_role) without a company: runs as the person. */
const person =
  (name: string, fn: (t: Tenant, a: Args, caller: RpcCaller) => Promise<unknown> | unknown): RpcHandler =>
  async (caller, a) => {
    if (!caller.service && !caller.userId) denied(name);
    return out(await fn(personTenant(caller), a, caller));
  };
/** auth.uid() / auth.jwt() of the caller, with no company (role and departments are not used by these ports). */
const personTenant = (caller: RpcCaller) => new Tenant(caller.sql, { userId: caller.userId ?? "", email: caller.email ?? "", companyId: "", role: "viewer", departments: [] });

/** The caller as a member of p_company (or NOT_MEMBER when member_role(p_company) is null). */
async function memberOf(caller: RpcCaller, company: unknown): Promise<Tenant | typeof NOT_MEMBER> {
  if (caller.service || !caller.userId || typeof company !== "string" || !company) return NOT_MEMBER;
  try {
    return await caller.tenantFor(company);
  } catch (e) {
    if (e instanceof AppError && e.status === 403) return NOT_MEMBER;
    throw e;
  }
}
/**
 * A member function of p_company (or of `key`). `notMember` is what Postgres did for a non-member when it differs
 * from tenantFor's 'ไม่มีสิทธิ์' (403).
 */
const member =
  (name: string, notMember: NotMember | null, fn: (t: Tenant, a: Args, caller: RpcCaller) => Promise<unknown> | unknown, key = "p_company"): RpcHandler =>
  async (caller, a) => {
    if (!caller.service && !caller.userId) denied(name);
    const t = await memberOf(caller, a[key]);
    if (t === NOT_MEMBER) {
      if (notMember && "value" in notMember) return notMember.value;
      if (notMember) fail(notMember.error, notMember.status ?? 403);
      fail("ไม่มีสิทธิ์", 403);
    }
    return out(await fn(t as Tenant, a, caller));
  };

const OWNER: NotMember = { error: "เฉพาะเจ้าของบริษัท" };
const NONE: NotMember = { error: "ไม่มีสิทธิ์" };
const EMPTY: NotMember = { value: [] };
const NULL: NotMember = { value: null };

/** The signed-in person for create_company / accept_invitations (Supabase only signs in people whose email is confirmed). */
const signedIn = (c: RpcCaller): SignedInUser => ({ userId: c.userId ?? "", email: c.email ?? "", name: c.name || null, emailConfirmed: !!c.userId });

/** post_stock_movement(): the port builds the batch; this runs it and returns the stock_movements row, like Postgres. */
async function postStockMovement(t: Tenant, a: Args) {
  const product = g(a, "p_product") as string | null,
    type = g(a, "p_type") as string,
    q = Number(g(a, "p_quantity")),
    reference = g(a, "p_reference") as string,
    notes = g(a, "p_notes", "") as string;
  const rows = new EntityRows(t);
  if (type !== "in" && type !== "out") {
    // Postgres checks the right and the product before the type (and the port only takes 'in' / 'out').
    await stockMove(t, { stmts: [] }, product, "in", 0, "", "", rows).catch((e) => {
      if (!/รายการรับ–จ่ายไม่ถูกต้อง/.test(String((e as Error).message))) throw e;
    });
    fail("รายการรับ–จ่ายไม่ถูกต้อง");
  }
  const plan = { stmts: [] as Stmt[] };
  await stockMove(t, plan, product, type as "in" | "out", q, reference, notes, rows);
  await t.atomic(plan.stmts);
  const [m] = await t.selectInternal<{ created_at: string }>("stock_movements", { where: { product_id: product, type, reference, created_by: t.viewer.userId }, order: [["created_at", "desc"]], limit: 1 });
  return m ?? null;
}

/** presence_ping after its sign-in check: membership of p_company (any role), then the port. */
const presenceMember = member("presence_ping", NONE, (t, a) => presencePing(t, g(a, "p_companies", [])));

export const rpcs: Record<string, RpcHandler> = {
  // ---------- company, members, support ----------
  create_company: async (c, a) => {
    if (!c.service && !c.userId) denied("create_company");
    return createCompany(c.sql, signedIn(c), g(a, "p_name"), {
      seedAccounts: (t) => seedAccountsStmts(t, t.viewer.companyId),
      afterOwnerJoined: (id) => platformCustomerOnSignup(c.sql, id),
    });
  },
  accept_invitations: async (c) => {
    if (!c.service && !c.userId) denied("accept_invitations");
    await acceptInvitations(c.sql, signedIn(c));
    return null;
  },
  save_company: member("save_company", OWNER, (t, a) => saveCompany(t, g(a, "p_profile"), g(a, "p_settings", null))),
  invite_member: member("invite_member", OWNER, (t, a) => inviteMember(t, g(a, "p_email"), g(a, "p_role"), g(a, "p_departments"))),
  edit_member: member("edit_member", OWNER, (t, a) => editMember(t, g(a, "p_id"), g(a, "p_role"), g(a, "p_departments"), g(a, "p_disabled"), g(a, "p_read_departments", null))),
  set_member_access: member("set_member_access", OWNER, (t, a) => setMemberAccess(t, g(a, "p_member"), g(a, "p_role"), g(a, "p_departments"), g(a, "p_read_departments"))),
  presence_ping: async (c, a) => {
    if (!c.service && !c.userId) denied("presence_ping");
    if (!c.userId) fail("ต้องเข้าสู่ระบบ");
    return presenceMember(c, a);
  },
  send_message: member("send_message", { error: "ไม่มีสิทธิ์ส่งข้อความ" }, (t, a) => sendMessage(t, g(a, "p_department"), g(a, "p_body"))),
  support_send: member("support_send", null, (t, a) => supportSend(t, g(a, "p_body"))),
  support_seen: member("support_seen", NULL, (t) => supportSeen(t)),
  support_reply: service("support_reply", (sql, a) => supportReply(sql, g(a, "p_company"), g(a, "p_name"), g(a, "p_body"))),
  end_support_access: person("end_support_access", (t, a) => endSupportAccess(t, g(a, "p_id"))),
  company_card: person("company_card", (t, a) => companyCard(t, g(a, "p_id"))),
  company_cover: person("company_cover", (t, a) => companyCover(t, g(a, "p_id"))),
  load_sample_data: member("load_sample_data", OWNER, (t, a) => loadSampleData(t, g(a, "p_rows"))),
  clear_sample_data: member("clear_sample_data", OWNER, (t) => clearSampleData(t)),
  create_share: member("create_share", OWNER, (t, a) => createShare(t, g(a, "p_hash"), g(a, "p_password"), g(a, "p_label"), g(a, "p_keys"), g(a, "p_expires"))),
  revoke_share: member("revoke_share", OWNER, (t, a) => revokeShare(t, g(a, "p_id"))),
  share_failed: service("share_failed", (sql, a) => shareFailed(sql, g(a, "p_token"), g(a, "p_client"))),
  share_lockout: service("share_lockout", (sql, a) => shareLockout(sql, g(a, "p_token"), g(a, "p_client"))),
  share_metrics: service("share_metrics", (sql, a) => shareMetrics(sql, g(a, "p_company"), g(a, "p_keys"))),
  save_dashboard_layout: member("save_dashboard_layout", OWNER, (t, a) => saveDashboardLayout(t, g(a, "p_layout"))),
  note_save: member("note_save", NONE, (t, a) => noteSave(t, g(a, "p_day"), g(a, "p_body"), g(a, "p_items"))),
  note_delete: member("note_delete", NONE, (t, a) => noteDelete(t, g(a, "p_day"))),
  claim_notifications: service("claim_notifications", (sql) => claimNotifications(sql)),

  // ---------- records ----------
  save_entity: member("save_entity", null, (t, a) => saveEntity(t, g(a, "p_kind"), g(a, "p_data"), g(a, "p_id", undefined) ?? undefined, g(a, "p_version", undefined) ?? undefined)),
  save_entity_as: service("save_entity_as", (sql, a) => saveEntityAs(sql, g(a, "p_company"), g(a, "p_user"), g(a, "p_kind"), g(a, "p_data"))),
  archive_entity: member("archive_entity", null, (t, a) => archiveEntity(t, g(a, "p_id"), g(a, "p_archive"))),
  peek_code: member("peek_code", NONE, (t, a) => peekCode(t, g(a, "p_kind"))),
  post_stock_movement: member("post_stock_movement", { error: "ไม่มีสิทธิ์คลังสินค้า" }, (t, a) => postStockMovement(t, a)),
  purchase_action: member("purchase_action", { error: "ไม่มีสิทธิ์จัดซื้อ" }, (t, a) => purchaseAction(t, g(a, "p_id"), g(a, "p_action"))),
  transfer_project_stock: member("transfer_project_stock", { error: "ไม่มีสิทธิ์โอนสินค้า" }, (t, a) =>
    transferProjectStock(t, g(a, "p_product"), g(a, "p_from"), g(a, "p_to"), g(a, "p_quantity"), g(a, "p_reference"), g(a, "p_reason")),
  ),
  update_project_stage: member("update_project_stage", null, (t, a) => updateProjectStage(t, g(a, "p_project"), g(a, "p_key"), g(a, "p_status"), g(a, "p_version"))),
  add_attachment: member("add_attachment", { error: "ไม่มีสิทธิ์จัดเก็บเอกสาร" }, (t, a) =>
    addAttachment(t, g(a, "p_id"), g(a, "p_entity"), g(a, "p_department"), g(a, "p_name"), g(a, "p_mime"), g(a, "p_size"), g(a, "p_path")),
  ),
  link_attachment: member("link_attachment", null, (t, a) => linkAttachment(t, g(a, "p_attachment"), g(a, "p_entity"))),
  create_design_revision: member("create_design_revision", null, (t, a) => createDesignRevision(t, g(a, "p_project"), g(a, "p_attachment"), g(a, "p_category"), g(a, "p_notes", ""))),
  review_design_revision: member("review_design_revision", null, (t, a) => reviewDesignRevision(t, g(a, "p_id"), g(a, "p_status"), g(a, "p_note", ""))),
  comment_design_revision: member("comment_design_revision", null, (t, a) => commentDesignRevision(t, g(a, "p_revision"), g(a, "p_body"))),

  // ---------- forms, approvals, ingestion ----------
  save_template: member("save_template", OWNER, (t, a) => saveTemplate(t, g(a, "p_name"), g(a, "p_department"), g(a, "p_fields"), g(a, "p_steps"), g(a, "p_id", null))),
  set_template_target: member("set_template_target", OWNER, (t, a) => setTemplateTarget(t, g(a, "p_id"), g(a, "p_kind"), g(a, "p_map"))),
  submit_ingestion: member("submit_ingestion", null, (t, a) => submitIngestion(t, g(a, "p_template"), g(a, "p_raw"), g(a, "p_attachment", null))),
  decide_ingestion: member("decide_ingestion", null, (t, a) => decideIngestion(t, g(a, "p_id"), g(a, "p_status"), g(a, "p_values"), g(a, "p_reason", ""))),
  retry_ingestion: member("retry_ingestion", null, (t, a) => retryIngestion(t, g(a, "p_id"))),
  web_approval_act: member("web_approval_act", { error: "ไม่พบรายการ", status: 404 }, (t, a) => webApprovalAct(t, g(a, "p_id"), g(a, "p_action"), g(a, "p_values"), g(a, "p_note", null))),
  approve_deal: member("approve_deal", null, (t, a) => approveDeal(t, g(a, "p_id"))),
  claim_ingestion: service("claim_ingestion", (sql, a) => claimIngestion(sql, g(a, "p_id", null))),
  complete_ingestion: service("complete_ingestion", (sql, a) => completeIngestion(sql, g(a, "p_id"), g(a, "p_lease"), g(a, "p_values"), g(a, "p_missing"), g(a, "p_engine"))),
  complete_sorted_ingestion: service("complete_sorted_ingestion", (sql, a) =>
    completeSortedIngestion(sql, g(a, "p_id"), g(a, "p_lease"), g(a, "p_kind"), g(a, "p_template"), g(a, "p_values"), g(a, "p_missing"), g(a, "p_engine")),
  ),
  item_file_count: service("item_file_count", (sql, a) => itemFileCount(serviceTenant(sql), g(a, "p_id"))),
  purge_voice_files: service("purge_voice_files", (sql, a) => purgeVoiceFiles(sql, g(a, "p_days", 90))),
  queue_nudges: service("queue_nudges", (sql) => queueNudges(systemTenant(sql))),

  // ---------- finance and documents ----------
  post_expense: member("post_expense", { error: "ไม่มีสิทธิ์ฝ่ายการเงิน" }, (t, a) => postExpense(t, g(a, "p_entity"), g(a, "p_lines"), g(a, "p_wht", null))),
  issue_document: member("issue_document", NONE, (t, a) => issueDocument(t, g(a, "p_kind"), g(a, "p_entity"))),
  document_number: member("document_number", NULL, (t, a) => documentNumber(t, g(a, "p_kind"), g(a, "p_entity"))),
  issued_documents_list: member("issued_documents_list", EMPTY, (t) => issuedDocumentsList(t)),
  finance_close_step: member("finance_close_step", { error: "ไม่มีสิทธิ์ปิดงบประจำปี" }, (t, a) => financeCloseStep(t, g(a, "p_year"), g(a, "p_step"), g(a, "p_done"))),
  finance_save_budgets: member("finance_save_budgets", { error: "ไม่มีสิทธิ์วางแผนงบประมาณ" }, (t, a) => financeSaveBudgets(t, g(a, "p_year"), g(a, "p_budgets"))),
  finance_save_targets: member("finance_save_targets", { error: "ไม่มีสิทธิ์วางแผนงบประมาณ" }, (t, a) =>
    financeSaveTargets(t, g(a, "p_year"), g(a, "p_revenue"), g(a, "p_profit"), g(a, "p_expense_cap")),
  ),
  goal_set: member("goal_set", { error: "เฉพาะเจ้าของหรือผู้จัดการตั้งเป้าหมายได้" }, (t, a) => goalSet(t, g(a, "p_month"), g(a, "p_target"))),

  // ---------- reports ----------
  dashboard_summary: member("dashboard_summary", { error: "ไม่มีสิทธิ์บริษัท" }, (t) => dashboardSummary(t)),
  analytics_series: member("analytics_series", EMPTY, (t) => analyticsSeries(t)),
  template_metrics: member("template_metrics", EMPTY, (t) => templateMetrics(t)),
  template_breakdowns: member("template_breakdowns", EMPTY, (t) => templateBreakdowns(t)),
  usage_summary: member("usage_summary", NULL, (t) => usageSummary(t)),
  calendar_entries: member("calendar_entries", { error: "ไม่มีสิทธิ์หรือเดือนไม่ถูกต้อง" }, (t, a) => calendarEntries(t, g(a, "p_month"))),

  // ---------- billing, coins, shop, ads, platform admin ----------
  // has_addon / trial_usage: security definer with no member check, granted to authenticated and service_role.
  has_addon: async (c, a) => {
    if (!c.service && !c.userId) denied("has_addon");
    return hasAddon(serviceTenant(c.sql, g(a, "c", "")), g(a, "a"), g(a, "c"));
  },
  trial_usage: async (c, a) => {
    if (!c.service && !c.userId) denied("trial_usage");
    return trialUsage(serviceTenant(c.sql, g(a, "c", "")), g(a, "c"));
  },
  request_payment: member("request_payment", OWNER, (t, a) =>
    requestPayment(t, g(a, "p_plan"), g(a, "p_cycle"), g(a, "p_attachment"), g(a, "p_slip"), g(a, "p_ref"), g(a, "p_addons", []), g(a, "p_extra_users", 0)),
  ),
  confirm_payment: service("confirm_payment", (sql, a) => confirmPayment(sql, g(a, "p_id"), g(a, "p_status"), g(a, "p_note", null))),
  request_topup: member("request_topup", OWNER, (t, a) => requestTopup(t, g(a, "p_coins"), g(a, "p_attachment"), g(a, "p_slip"), g(a, "p_ref"))),
  confirm_topup: service("confirm_topup", (sql, a) => confirmTopup(sql, g(a, "p_id"), g(a, "p_status"), g(a, "p_note", null))),
  buy_module: member("buy_module", OWNER, (t, a) => buyModule(t, g(a, "p_module"))),
  shop_buy: member("shop_buy", { error: "เฉพาะเจ้าของหรือผู้จัดการ" }, (t, a) => shopBuy(t, g(a, "p_item"))),
  shop_activate: member("shop_activate", { error: "เฉพาะเจ้าของหรือผู้จัดการ" }, (t, a) => shopActivate(t, g(a, "p_kind"), g(a, "p_item"))),
  buy_feed_ad: member("buy_feed_ad", { error: "เฉพาะเจ้าของบริษัทซื้อโฆษณาได้" }, (t, a) => buyFeedAd(t, g(a, "p_package"), g(a, "p_ad"))),
  set_feed_ad_status: member("set_feed_ad_status", null, (t, a) => setFeedAdStatus(t, g(a, "p_id"), g(a, "p_status"))),
  feed_ad_track: member("feed_ad_track", NULL, (t, a) => feedAdTrack(t, g(a, "p_ad"), g(a, "p_kind"))),
  feed_ads_live: member("feed_ads_live", EMPTY, (t) => feedAdsLive(t)),
  my_feed_ads: member("my_feed_ads", EMPTY, (t) => myFeedAds(t)),
  expire_subscriptions: service("expire_subscriptions", (sql) => expireSubscriptions(sql)),
  admin_grant_plan: service("admin_grant_plan", (sql, a) =>
    adminGrantPlan(sql, g(a, "p_company"), g(a, "p_plan"), g(a, "p_kind"), g(a, "p_days"), g(a, "p_extra_users"), g(a, "p_reason"), g(a, "p_by")),
  ),
  admin_revoke_grant: service("admin_revoke_grant", (sql, a) => adminRevokeGrant(sql, g(a, "p_id"), g(a, "p_by"))),
  add_platform_customer: service("add_platform_customer", (sql, a) => addPlatformCustomer(sql, g(a, "p_company"))),

  // ---------- LINE ----------
  pair_line_group: service("pair_line_group", (sql, a) => pairLineGroup(sql, g(a, "p_hash"), g(a, "p_group"))),
  pair_line_user: service("pair_line_user", (sql, a) => pairLineUser(sql, g(a, "p_hash"), g(a, "p_group"), g(a, "p_line_user"))),
  line_approve: service("line_approve", (sql, a) => lineApprove(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"))),
  line_decide: service("line_decide", (sql, a) => lineDecide(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"), g(a, "p_status"), g(a, "p_reason", ""))),
  line_approval_act: service("line_approval_act", (sql, a) => lineApprovalAct(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"), g(a, "p_action"), g(a, "p_note", null), g(a, "p_step", null))),
  line_keyword_approve: service("line_keyword_approve", (sql, a) => lineKeywordApprove(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_text"))),
  line_draft_decide: service("line_draft_decide", (sql, a) => lineDraftDecide(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"), g(a, "p_save"))),
  line_evidence_check: service("line_evidence_check", (sql, a) => lineEvidenceCheck(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"))),
  line_add_evidence: service("line_add_evidence", (sql, a) => lineAddEvidence(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"), g(a, "p_attachment"))),
  line_slip_check: service("line_slip_check", (sql, a) => lineSlipCheck(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"))),
  line_expense_paid: service("line_expense_paid", (sql, a) => lineExpensePaid(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_id"), g(a, "p_attachment"))),
  line_documents: service("line_documents", (sql, a) => lineDocuments(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_code", null), g(a, "p_id", null))),
  line_expense_summary: service("line_expense_summary", (sql, a) => lineExpenseSummary(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_from"), g(a, "p_to"))),
  line_quick_stats: service("line_quick_stats", (sql, a) => lineQuickStats(sql, g(a, "p_group"))),
  line_set_approvers: service("line_set_approvers", (sql, a) => lineSetApprovers(sql, g(a, "p_group"), g(a, "p_user"), g(a, "p_hash"), g(a, "p_add"), g(a, "p_remove"))),
  remove_line_approver: member("remove_line_approver", OWNER, (t, a) => removeLineApprover(t, g(a, "p_group"), g(a, "p_line_user"))),
  unlink_line_group: member("unlink_line_group", OWNER, (t, a) => unlinkLineGroup(t, g(a, "p_group"))),
  update_line_group: member("update_line_group", OWNER, (t, a) => updateLineGroup(t, g(a, "p_group"), g(a, "p_template"), g(a, "p_name"), g(a, "p_keywords"), g(a, "p_department"))),
  set_line_group_listen: member("set_line_group_listen", OWNER, (t, a) => setLineGroupListen(t, g(a, "p_group"), g(a, "p_listen"))),

  // ---------- feed ----------
  feed_list: member("feed_list", NONE, (t, a) => feedList(t, g(a, "p_filter", "all"), g(a, "p_before", null), g(a, "p_limit", 20))),
  feed_suggest: member("feed_suggest", EMPTY, (t) => feedSuggest(t)),
  feed_companies: member("feed_companies", NONE, (t, a) => feedCompanies(t, g(a, "p_search", null), g(a, "p_limit", 60))),
  feed_company_profile: member("feed_company_profile", NONE, (t, a) => feedCompanyProfile(t, g(a, "p_target"))),
  feed_follow_list: member("feed_follow_list", NONE, (t, a) => feedFollowList(t, g(a, "p_target"), g(a, "p_dir"))),
  feed_follow: member("feed_follow", NONE, (t, a) => feedFollow(t, g(a, "p_target"))),
  feed_post: member("feed_post", { error: "ไม่มีสิทธิ์โพสต์ในนามบริษัทนี้" }, (t, a) => feedPost(t, g(a, "p_id"), g(a, "p_kind"), g(a, "p_body"), g(a, "p_meta"), g(a, "p_images"))),
  feed_comment: member("feed_comment", { error: "ไม่มีสิทธิ์แสดงความคิดเห็น" }, (t, a) => feedComment(t, g(a, "p_post"), g(a, "p_body"))),
  feed_alerts: member("feed_alerts", NONE, (t) => feedAlerts(t)),
  feed_proposals: member("feed_proposals", NONE, (t, a) => feedProposals(t, g(a, "p_post", null))),
  feed_propose: member("feed_propose", { error: "ไม่มีสิทธิ์ส่งข้อเสนอในนามบริษัทนี้" }, (t, a) => feedPropose(t, g(a, "p_post"), g(a, "p_message"), g(a, "p_contact"))),
  feed_proposal_status: member("feed_proposal_status", null, (t, a) => feedProposalStatus(t, g(a, "p_id"), g(a, "p_status"))),
  feed_delete: person("feed_delete", (t, a) => feedDelete(t, g(a, "p_post"))),
  feed_like: person("feed_like", (t, a) => feedLike(t, g(a, "p_post"))),
  feed_save: person("feed_save", (t, a) => feedSave(t, g(a, "p_post"))),
  feed_share: person("feed_share", (t, a) => feedShare(t, g(a, "p_post"))),
  feed_view: person("feed_view", (t, a) => feedView(t, g(a, "p_posts"))),

  // ---------- B2B chat ----------
  b2b_inbox: member("b2b_inbox", NONE, (t) => b2bInbox(t)),
  b2b_unread: member("b2b_unread", { value: 0 }, (t) => b2bUnread(t)),
  b2b_open: member("b2b_open", NONE, (t, a) => b2bOpen(t, g(a, "p_target"), g(a, "p_post", null))),
  b2b_post: member("b2b_post", NONE, (t, a) => b2bPost(t, g(a, "p_post"))),
  b2b_read: member("b2b_read", null, (t, a) => b2bRead(t, g(a, "p_thread"), g(a, "p_before", null))),
  b2b_send: member("b2b_send", { error: "ไม่มีสิทธิ์ส่งข้อความในนามบริษัทนี้" }, (t, a) => b2bSend(t, g(a, "p_thread"), g(a, "p_body"), g(a, "p_post", null), g(a, "p_files", []))),
  my_avatar: person("my_avatar", (t) => myAvatar(t)),
  set_my_avatar: person("set_my_avatar", (t, a) => setMyAvatar(t, g(a, "p_on"))),

  // ---------- B2B deal room ----------
  b2b_deals_of: member("b2b_deals_of", null, (t, a) => b2bDealsOf(t, g(a, "p_thread"))),
  b2b_deal_take: member("b2b_deal_take", null, (t, a) => b2bDealTake(t, g(a, "p_deal"))),
  b2b_deal_request: member("b2b_deal_request", null, (t, a) => b2bDealRequest(t, g(a, "p_thread"), g(a, "p_title"), g(a, "p_data"))),
  b2b_deal_quote: member("b2b_deal_quote", null, (t, a) => b2bDealQuote(t, g(a, "p_thread"), g(a, "p_deal"), g(a, "p_title"), g(a, "p_data"))),
  b2b_deal_decide: member("b2b_deal_decide", null, (t, a) => b2bDealDecide(t, g(a, "p_card"), g(a, "p_decision"), g(a, "p_reason", null))),
  b2b_deal_withdraw: member("b2b_deal_withdraw", null, (t, a) => b2bDealWithdraw(t, g(a, "p_card"), g(a, "p_reason", null))),
  b2b_deal_progress: member("b2b_deal_progress", null, (t, a) => b2bDealProgress(t, g(a, "p_deal"), g(a, "p_percent"), g(a, "p_note"))),
  b2b_deal_deliver: member("b2b_deal_deliver", null, (t, a) => b2bDealDeliver(t, g(a, "p_deal"), g(a, "p_note"))),
  b2b_deal_invoice: member("b2b_deal_invoice", null, (t, a) => b2bDealInvoice(t, g(a, "p_deal"), g(a, "p_index"), g(a, "p_due", null))),
  b2b_deal_cancel: member("b2b_deal_cancel", null, (t, a) => b2bDealCancel(t, g(a, "p_deal"), g(a, "p_reason"))),
  b2b_deal_check: member("b2b_deal_check", null, (t, a) => b2bDealCheck(t, g(a, "p_card"), g(a, "p_ok"), g(a, "p_reason", null))),
  b2b_deal_pay: member("b2b_deal_pay", null, (t, a) => b2bDealPay(t, g(a, "p_card"), g(a, "p_data"))),
  b2b_deal_receive: member("b2b_deal_receive", null, (t, a) => b2bDealReceive(t, g(a, "p_card"), g(a, "p_ok"), g(a, "p_reason", null))),
  b2b_deal_cancel_answer: member("b2b_deal_cancel_answer", null, (t, a) => b2bDealCancelAnswer(t, g(a, "p_card"), g(a, "p_agree"), g(a, "p_reason", null))),
};
