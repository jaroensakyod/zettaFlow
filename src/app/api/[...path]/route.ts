import { currencies, thbRate } from "@/lib/fx";
import { forCompany } from "@/lib/llm";
import { adStudio, buyAd, liveAds, setAdStatus, trackAd } from "@/lib/ads";
import { lineGroupMessages, lineGroupsOverview } from "@/lib/line-hub";
import { NextResponse, after, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  context,
  listEntities,
  nextCode,
  entityOptions,
  saveEntity,
  convertEntity,
  archiveEntity,
  movement,
  purchaseAction,
  summary,
  home,
  homeFinance,
  templates,
  saveTemplate,
  setTemplateTarget,
  ingestions,
  decide,
  dbError,
} from "@/lib/data";
import {
  supabaseServer,
  supabaseAdmin,
  configured,
} from "@/lib/supabase/server";
import {
  demoEnabled,
  demoRead,
  demoMutate,
  demoAudit,
  PUBLIC_DEMO_COOKIE,
  READ_ONLY_DEMO,
} from "@/lib/demo";
import {
  assert,
  AppError,
  canRead,
  canWrite,
  requireOwner,
  safeCsv,
  validDate,
} from "@/lib/domain";
import { catalog, companyFields, departmentNames } from "@/lib/catalog";
import { submit, processJobs, processNotifications, tokenHash, lineName } from "@/lib/ai";
import { upload, files, download, prepareUpload, finishUpload, MAX_UPLOAD } from "@/lib/files";
import { flowReply, businessAnswer } from "@/lib/flow";
import { aiEnabled } from "@/lib/llm";
import {
  feedList,
  feedSuggest,
  feedPost,
  feedDelete,
  feedLike,
  feedComment,
  feedFollow,
  feedImage,
  companyLogo,
  feedProposals,
  feedPropose,
  feedProposalStatus,
  feedCompanies,
  feedProfile,
  feedFollowList,
  companyCover,
  feedView,
  feedShare,
  feedSave,
  feedAlerts,
} from "@/lib/feed";
import { financeOverview, saveBudgets, saveTargets, setClosingStep } from "@/lib/finance-center";
import { linePageData } from "@/lib/line-page";
import { homeExtra, saveNote, deleteNote, setGoal } from "@/lib/home-extra";
import { shopState, shopActive, shopBuy, shopActivate } from "@/lib/app-shop";
import { projectsOverview, projectDetail } from "@/lib/projects";
import { receiptsList } from "@/lib/receipts";
import { b2bInbox, b2bOpen, b2bRead, b2bSend, b2bUnread } from "@/lib/b2b";
import { designData, designAction } from "@/lib/design";
import { coinStore, requestTopup, pendingTopups, confirmTopup, buyModule } from "@/lib/coins";
import { taxReport, incomeReport, ledger, ledgerDetail, expiries } from "@/lib/dept-views";
import { ordersList, recordOrderPayment, setOrderWaiting } from "@/lib/orders";
import { quotesList, updateQuote, quoteForm } from "@/lib/quotes";
import { accountingOverview, importReceipt, postExpense, expenseBooks, whtCertificateHtml, linkAttachment } from "@/lib/accounting";
import { scanExpenseDocument, demoScanAllowed } from "@/lib/expenses";
import { sampleData } from "@/lib/sample-data";
import { importRows } from "@/lib/importer";
import { directory } from "@/lib/directory";
import { stageData, changeStage } from "@/lib/project-stages";
import { transferData, transferStock } from "@/lib/transfers";
import {
  dashboardWidgets,
  saveLayout,
  billing,
  requestPayment,
  pendingPayments,
  confirmPayment,
  platformAdmin,
  checkSlip,
  listShares,
  createShare,
  revokeShare,
  openShare,
  draftTemplate,
  entitled,
} from "@/lib/platform";
import {
  publicContent,
  supportThread,
  supportSeen,
  supportSend,
  adminInbox,
  adminThread,
  adminReply,
  adminList,
  adminSave,
  adminDelete,
  promoMediaUpload,
} from "@/lib/engage";
import { presence } from "@/lib/presence";
import { validVisibility } from "@/lib/company-visibility";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function body(req: NextRequest) {
  assert(
    Number(req.headers.get("content-length") || 0) < 4500000,
    "ข้อมูลใหญ่เกินไป",
    413,
  );
  try {
    return z.record(z.string(), z.unknown()).parse(await req.json());
  } catch {
    throw new AppError("JSON ไม่ถูกต้อง");
  }
}
async function handle(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname.slice(5).split("/"),
      method = req.method;
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      assert(
        !origin ||
          origin === req.nextUrl.origin ||
          origin === `${req.nextUrl.protocol}//${req.headers.get("host")}` ||
          origin === process.env.NEXT_PUBLIC_APP_URL,
        "Origin ไม่ถูกต้อง",
        403,
      );
    }
    if (path[0] === "fx" && method === "GET") {
      // Baht per 1 unit of a document currency on its date, for the expense form.
      const q = req.nextUrl.searchParams;
      const currency = z.enum(currencies).parse(q.get("currency"));
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(q.get("date") || undefined);
      return response({ currency, date, rate: await thbRate(currency, date) });
    }
    if (path[0] === "config")
      return response({
        configured: configured(),
        demo:
          demoEnabled() ||
          (await cookies()).get(PUBLIC_DEMO_COOKIE)?.value === "1",
        ai: aiEnabled(),
        line: !!process.env.LINE_CHANNEL_SECRET,
        worker: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
    if (path[0] === "auth") {
      const input = await body(req);
      const action = input.action;
      (await cookies()).delete(PUBLIC_DEMO_COOKIE);
      if (demoEnabled()) {
        assert(
          action === "logout",
          "Demo ไม่มีบัญชีจริงสำหรับสมัคร เข้าสู่ระบบ หรือเปลี่ยนรหัสผ่าน",
        );
        return response({ demo: true });
      }
      assert(configured(), "ตั้งค่า Supabase ก่อน", 503);
      const sb = await supabaseServer();
      if (action === "logout") {
        await sb.auth.signOut({ scope: "local" });
        const prefix =
          "sb-" +
          new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
            ".",
          )[0] +
          "-auth-token";
        const jar = await cookies();
        for (const cookie of jar.getAll())
          if (cookie.name.startsWith(prefix)) jar.delete(cookie.name);
        return response({ ok: true });
      }
      if (action === "reset") {
        const email = z.email().parse(input.email);
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: new URL(
            "/auth/callback?next=/reset-password",
            process.env.NEXT_PUBLIC_APP_URL ||
              `${req.nextUrl.protocol}//${req.headers.get("host")}`,
          ).toString(),
        });
        dbError(error);
        return response({
          message: "หากมีบัญชี ระบบจะส่งอีเมลตั้งรหัสผ่านใหม่",
        });
      }
      // Email link opened on /auth/confirm: the person pressed the button, so mail scanners that only GET the
      // link cannot use up the one-time token.
      if (action === "verify") {
        const { token_hash, type } = z
          .object({ token_hash: z.string().min(10).max(500), type: z.enum(["recovery", "signup", "email", "invite", "magiclink", "email_change"]) })
          .parse(input);
        const { error } = await sb.auth.verifyOtp({ token_hash, type });
        if (error) return response({ error: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้เลย", expired: true }, 400);
        await sb.rpc("accept_invitations");
        return response({ next: type === "recovery" ? "/reset-password" : "/workspace/dashboard" });
      }
      if (action === "password") {
        const password = z.string().min(7).max(200).parse(input.password);
        const { error } = await sb.auth.updateUser({ password });
        dbError(error);
        return response({ ok: true });
      }
      const credentials = z
        .object({
          email: z.email(),
          password: z
            .string()
            .min(action === "register" ? 7 : 1)
            .max(200),
        })
        .parse(input);
      if (action === "register") {
        const name = z.string().min(1).max(200).parse(input.name);
        const { data, error } = await sb.auth.signUp({
          ...credentials,
          options: {
            data: { name },
            emailRedirectTo: new URL(
              "/auth/callback",
              process.env.NEXT_PUBLIC_APP_URL ||
                `${req.nextUrl.protocol}//${req.headers.get("host")}`,
            ).toString(),
          },
        });
        dbError(error);
        return response({ verify: !data.session });
      }
      assert(action === "login", "คำสั่งไม่ถูกต้อง");
      const { error } = await sb.auth.signInWithPassword(credentials);
      dbError(error);
      return response({ ok: true });
    }
    if (path[0] === "onboarding") {
      const input = await body(req);
      assert(!demoEnabled(), "demo มีบริษัทตัวอย่างแล้ว");
      const sb = await supabaseServer();
      const {
        data: { user },
      } = await sb.auth.getUser();
      assert(user, "เข้าสู่ระบบก่อน", 401);
      const name = z.string().trim().min(1).max(200).parse(input.name);
      const { data, error } = await sb.rpc("create_company", { p_name: name });
      dbError(error);
      (await cookies()).set("ef_company", data, {
        httpOnly: true,
        sameSite: "lax",
        secure: !!process.env.VERCEL,
        path: "/",
      });
      return response({ ok: true });
    }
    if (path[0] === "public-content")
      return response(await publicContent(demoEnabled()));
    if (path[0] === "public-share") {
      const input = method === "POST" ? await body(req) : {};
      const password = z.string().max(100).default("").parse(input.password);
      return response(
        await openShare(
          z.string().max(80).parse(path[1]),
          password,
          demoEnabled(),
          req.headers.get("x-real-ip") ||
            req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
            "unknown",
        ),
      );
    }
    const fileId =
      method === "GET" && path[0] === "files" && /^[0-9a-f-]{36}$/i.test(path[1] || "") ? path[1] : undefined;
    const ctx = await context({ fileId });
    // AI calls in this request count against this company's trial and are logged per company.
    if (!ctx.demo) forCompany(ctx.company.id);
    // Public showcase is read-only: only reads and side-effect-free helpers.
    if (
      ctx.demo &&
      !demoEnabled() &&
      method !== "GET" &&
      !(path[0] === "presence" || path[0] === "assistant" || path[0] === "flow" || path[0] === "expense-scan" || (path[0] === "templates" && path[1] === "draft"))
    )
      throw new AppError(READ_ONLY_DEMO, 403);
    if (path[0] === "companies") {
      if (ctx.demo)
        return response([
          { id: ctx.company.id, name: ctx.company.name, role: ctx.member.role },
        ]);
      const sb = await supabaseServer();
      if (method === "GET") {
        const { data, error } = await sb
          .from("memberships")
          .select("company_id,role,companies(id,name)")
          .eq("user_id", ctx.user.id)
          .eq("disabled", false);
        dbError(error);
        return response(
          (data || []).map((m) => ({
            id: m.company_id,
            role: m.role,
            name: (m.companies as unknown as { name: string }).name,
          })),
        );
      }
      const input = await body(req);
      const id = z.uuid().parse(input.id);
      const { data, error } = await sb
        .from("memberships")
        .select("id")
        .eq("user_id", ctx.user.id)
        .eq("company_id", id)
        .eq("disabled", false)
        .single();
      assert(data && !error, "ไม่มีสิทธิ์บริษัทนี้", 403);
      (await cookies()).set("ef_company", id, {
        httpOnly: true,
        sameSite: "lax",
        secure: !!process.env.VERCEL,
        path: "/",
      });
      return response({ ok: true });
    }
    if (path[0] === "workspace") {
      const result = await summary(ctx);
      const { widgets } = await dashboardWidgets(ctx);
      return response({
        context: ctx,
        ...result,
        summary: { ...result.summary, widgets },
        platformAdmin: platformAdmin(ctx),
      });
    }
    if (path[0] === "home") {
      if (path[1] === "extra" && method === "GET") return response(await homeExtra(ctx));
      if (path[1] === "notes" && method === "PUT") return response(await saveNote(ctx, await body(req)));
      if (path[1] === "notes" && method === "DELETE") return response(await deleteNote(ctx, z.string().max(10).parse(path[2])));
      if (path[1] === "goal" && method === "PUT") return response(await setGoal(ctx, await body(req)));
      if (path[1] === "finance" && method === "GET") {
        const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          q = new URL(req.url).searchParams;
        return response(await homeFinance(ctx, day.parse(q.get("from")), day.parse(q.get("to"))));
      }
      return response(await home(ctx));
    }
    if (path[0] === "feed") {
      if (path[1] === "image" || path[1] === "logo" || path[1] === "cover") {
        const media =
          path[1] === "image"
            ? await feedImage(ctx, path.slice(2).join("/"))
            : path[1] === "cover"
              ? await companyCover(ctx, path[2])
              : await companyLogo(ctx, path[2]);
        if (!media) return new Response(null, { status: 404 });
        if ("redirect" in media) return NextResponse.redirect(media.redirect!);
        return new Response(new Uint8Array(media.bytes), {
          headers: {
            "Content-Type": media.mime,
            "Cache-Control": path[1] === "image" ? "private, max-age=86400, immutable" : "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (path[1] === "suggest") return response(await feedSuggest(ctx));
      if (path[1] === "companies") return response(await feedCompanies(ctx, req.nextUrl.searchParams.get("q")));
      // Company profile pages: GET /feed/profile[/<id>], GET /feed/follows/<id>?dir=followers|following.
      if (path[1] === "profile") return response(await feedProfile(ctx, path[2] || null));
      if (path[1] === "follows") return response(await feedFollowList(ctx, path[2] || null, req.nextUrl.searchParams.get("dir")));
      if (path[1] === "alerts") return response(await feedAlerts(ctx));
      if (path[1] === "views" && method === "POST") {
        await feedView(ctx, await body(req));
        return response({ ok: true });
      }
      if (path[1] === "proposals") {
        if (method === "GET")
          return response(await feedProposals(ctx, req.nextUrl.searchParams.get("post")));
        await feedProposalStatus(ctx, path[2], await body(req));
        return response({ ok: true });
      }
      if (path[1] === "follow")
        return response({ following: await feedFollow(ctx, path[2]) });
      if (!path[1]) {
        if (method === "GET")
          return response(
            await feedList(
              ctx,
              req.nextUrl.searchParams.get("filter"),
              req.nextUrl.searchParams.get("before"),
            ),
          );
        assert(
          Number(req.headers.get("content-length") || 0) <= 4500000,
          "รูปรวมกันใหญ่เกินไป",
          413,
        );
        return response(await feedPost(ctx, await req.formData()), 201);
      }
      if (method === "DELETE") {
        await feedDelete(ctx, path[1]);
        return response({ ok: true });
      }
      if (path[2] === "like") return response(await feedLike(ctx, path[1]));
      if (path[2] === "share") return response(await feedShare(ctx, path[1]));
      if (path[2] === "save") return response(await feedSave(ctx, path[1]));
      if (path[2] === "propose")
        return response(await feedPropose(ctx, path[1], await body(req)), 201);
      if (path[2] === "comments")
        return response(await feedComment(ctx, path[1], await body(req)), 201);
    }
    if (path[0] === "dashboard") {
      if (method === "GET")
        return response(
          await dashboardWidgets(
            ctx,
            req.nextUrl.searchParams.get("edit") === "true",
          ),
        );
      await saveLayout(ctx, await body(req));
      return response({ ok: true });
    }
    if (path[0] === "billing") {
      if (path[1] === "admin") {
        if (method === "GET") return response(await pendingPayments(ctx));
        const input = z
          .object({
            status: z.enum(["verified", "rejected"]),
            note: z.string().max(500).optional(),
          })
          .parse(await body(req));
        await confirmPayment(ctx, z.uuid().parse(path[2]), input.status, input.note);
        return response({ ok: true });
      }
      if (method === "GET")
        return response({ ...(await billing(ctx)), platformAdmin: platformAdmin(ctx) });
      return response(await requestPayment(ctx, await body(req)), 201);
    }
    if (path[0] === "shop") {
      if (path[1] === "active") return response(await shopActive(ctx));
      if (method === "GET") return response(await shopState(ctx));
      if (path[1] === "buy" && method === "POST")
        return response(await shopBuy(ctx, z.string().regex(/^[a-z_]{1,40}$/).parse(path[2])), 201);
      if (path[1] === "activate" && method === "POST") return response(await shopActivate(ctx, await body(req)));
    }
    if (path[0] === "coins") {
      if (path[1] === "admin") {
        if (method === "GET") return response(await pendingTopups(ctx));
        const input = z
          .object({
            status: z.enum(["verified", "rejected"]),
            note: z.string().max(500).optional(),
          })
          .parse(await body(req));
        await confirmTopup(ctx, z.uuid().parse(path[2]), input.status, input.note);
        return response({ ok: true });
      }
      if (method === "GET") return response(await coinStore(ctx));
      if (path[1] === "topup") return response(await requestTopup(ctx, await body(req)), 201);
      if (path[1] === "buy")
        return response(await buyModule(ctx, z.string().regex(/^[a-z_]{1,40}$/).parse(path[2])), 201);
    }
    if (path[0] === "ads") {
      // ลงโฆษณา: GET studio (packages, my ads, coins), POST buy, PATCH pause/resume,
      // GET /ads/live for the feed, POST /ads/<id>/track {kind: view|click}.
      if (path[1] === "live") return response(await liveAds(ctx));
      if (path[2] === "track") {
        await trackAd(ctx, path[1], await body(req));
        return response({ ok: true });
      }
      if (method === "GET") return response(await adStudio(ctx));
      if (method === "POST") return response(await buyAd(ctx, await body(req)), 201);
      if (method === "PATCH") {
        await setAdStatus(ctx, path[1], await body(req));
        return response({ ok: true });
      }
    }
    if (path[0] === "tax-report") return response(await taxReport(ctx));
    if (path[0] === "income-report") return response(await incomeReport(ctx));
    // คำสั่งซื้อ: GET /orders, POST /orders/:id/pay {payerName,paidAt,payMethod,payReference}, POST /orders/:id/status {payStatus}.
    // ใบเสนอราคา: GET /quotes, POST /quotes/:id {status?, projectId?}.
    if (path[0] === "quotes" && !path[1] && method === "GET") return response(await quotesList(ctx));
    // Document-style form: GET /quotes/form?id= (letterhead, customers, projects, packages, next number, the quotation when editing).
    if (path[0] === "quotes" && path[1] === "form" && method === "GET") return response(await quoteForm(ctx, req.nextUrl.searchParams.get("id") ? z.uuid().parse(req.nextUrl.searchParams.get("id")) : undefined));
    if (path[0] === "quotes" && path[1] && path[1] !== "form" && method === "POST") return response(await updateQuote(ctx, z.uuid().parse(path[1]), await body(req)));
    if (path[0] === "orders") {
      if (!path[1] && method === "GET") return response(await ordersList(ctx));
      if (path[2] === "pay" && method === "POST") return response(await recordOrderPayment(ctx, z.uuid().parse(path[1]), await body(req)), 201);
      if (path[2] === "status" && method === "POST") return response(await setOrderWaiting(ctx, z.uuid().parse(path[1]), await body(req)));
    }
    if (path[0] === "ledger" && path[1] === "detail")
      return response(await ledgerDetail(ctx, z.string().max(20).parse(req.nextUrl.searchParams.get("kind")), z.uuid().parse(req.nextUrl.searchParams.get("id"))));
    if (path[0] === "ledger") return response(await ledger(ctx, req.nextUrl.searchParams.get("from") || "", req.nextUrl.searchParams.get("to") || ""));
    if (path[0] === "expiries") return response(await expiries(ctx));
    // บันทึกค่าใช้จ่าย form: AI reads one uploaded file into rows (nothing saved), and files uploaded before the
    // first save are linked to the expense afterwards.
    if (path[0] === "sample-data" && method === "POST") return response(await sampleData(ctx, await body(req)));
    if (path[0] === "expense-scan" && method === "POST") {
      // A file posted with the request is read without being stored: the public demo can try AI reading.
      if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) {
        assert(Number(req.headers.get("content-length") || 0) <= (demoEnabled() ? MAX_UPLOAD + 200000 : 4500000), "ไฟล์ใหญ่เกินไป", 413);
        if (ctx.demo && !demoEnabled()) demoScanAllowed(req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
        const file = (await req.formData()).get("file");
        assert(file instanceof File, "แนบไฟล์");
        return response(await scanExpenseDocument(ctx, {}, file));
      }
      return response(await scanExpenseDocument(ctx, await body(req)));
    }
    if (path[0] === "expense-files" && method === "POST") {
      const input = z.object({ attachmentId: z.uuid(), entityId: z.uuid() }).parse(await body(req));
      assert(canWrite(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
      await linkAttachment(ctx, input.attachmentId, input.entityId);
      return response({ ok: true });
    }
    if (path[0] === "receipts")
      return response(method === "GET" ? await accountingOverview(ctx) : await importReceipt(ctx, await body(req)), method === "GET" ? 200 : 201);
    // Financial Center: GET /finance?year=2026, POST /finance/budgets {year,budgets}, /finance/targets, /finance/closing.
    if (path[0] === "finance") {
      if (!path[1] && method === "GET") return response(await financeOverview(ctx, req.nextUrl.searchParams.get("year") ?? undefined));
      if (path[1] === "budgets" && method === "POST") return response(await saveBudgets(ctx, await body(req)));
      if (path[1] === "targets" && method === "POST") return response(await saveTargets(ctx, await body(req)));
      if (path[1] === "closing" && method === "POST") return response(await setClosingStep(ctx, await body(req)));
    }
    if (path[0] === "accounting") {
      const id = z.uuid().parse(path[2]);
      if (path[1] === "post" && method === "POST") return response(await postExpense(ctx, id));
      if (path[1] === "books" && method === "GET") return response(await expenseBooks(ctx, id));
    }
    if (path[0] === "wht" && method === "GET")
      return new Response(await whtCertificateHtml(ctx, z.uuid().parse(path[1])), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        },
      });
    if (path[0] === "import" && method === "POST") {
      assert(Number(req.headers.get("content-length") || 0) <= 4500000, "ไฟล์สูงสุด 4 MB", 413);
      const file = (await req.formData()).get("file");
      assert(file instanceof File, "แนบไฟล์ CSV หรือ Excel");
      return response(await importRows(ctx, z.string().max(40).parse(path[1]), file));
    }
    if (path[0] === "entities" && path[2] === "next-code" && method === "GET")
      return response(await nextCode(ctx, path[1]));
    if (path[0] === "directory" && method === "GET") return response(await directory(ctx, z.string().max(40).parse(path[1])));
    if (path[0] === "presence" && method === "POST") return response(await presence(ctx, await body(req)));
    if (path[0] === "support") {
      if (method === "GET") {
        const thread = await supportThread(ctx);
        if (req.nextUrl.searchParams.get("seen") === "true") await supportSeen(ctx);
        return response(thread);
      }
      return response(await supportSend(ctx, await body(req)), 201);
    }
    if (path[0] === "admin") {
      if (path[1] === "support") {
        if (!path[2]) return response(await adminInbox(ctx));
        if (method === "GET") return response(await adminThread(ctx, path[2]));
        return response(await adminReply(ctx, path[2], await body(req)), 201);
      }
      if (path[1] === "promo-media" && method === "POST") return response(await promoMediaUpload(ctx, await body(req)));
      if (path[1] === "promos" || path[1] === "announcements") {
        if (method === "GET") return response(await adminList(ctx, path[1]));
        if (method === "DELETE") {
          await adminDelete(ctx, path[1], z.string().min(1).max(64).parse(path[2]));
          return response({ ok: true });
        }
        await adminSave(ctx, path[1], await body(req), path[2]);
        return response({ ok: true });
      }
    }
    if (path[0] === "slips") return response(await checkSlip(ctx, await body(req)));
    if (path[0] === "shares") {
      if (method === "GET") return response(await listShares(ctx));
      if (method === "DELETE") {
        await revokeShare(ctx, z.uuid().parse(path[1]));
        return response({ ok: true });
      }
      return response(
        await createShare(
          ctx,
          await body(req),
          process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
        ),
        201,
      );
    }
    if (path[0] === "calendar") {
      const month = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(req.nextUrl.searchParams.get("month"));
      if (ctx.demo)
        return response(
          (await demoRead()).entities.filter(
            (e) =>
              !e.archived_at &&
              canRead(ctx, e.department) &&
              ["tasks", "events", "deals", "projects"].includes(e.kind) &&
              [e.data.startDate, e.data.dueDate, e.data.date].some((d) =>
                String(d || "").startsWith(month),
              ),
          ),
        );
      const sb = await supabaseServer();
      const { data, error } = await sb.rpc("calendar_entries", {
        p_company: ctx.company.id,
        p_month: month,
      });
      dbError(error);
      return response(data);
    }
    if (path[0] === "assistant") {
      const input = await body(req);
      const prompt = z.string().trim().min(1).max(1500).parse(input.prompt);
      return response(await businessAnswer(ctx, prompt));
    }
    if (path[0] === "flow") {
      if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) {
        assert(Number(req.headers.get("content-length") || 0) <= 4500000, "ไฟล์สูงสุด 4 MB", 413);
        const form = await req.formData(),
          file = form.get("file");
        assert(file instanceof File, "แนบไฟล์");
        return response(await flowReply(ctx, {}, file));
      }
      return response(await flowReply(ctx, await body(req)));
    }
    if (path[0] === "options") return response(await entityOptions(ctx));
    if (path[0] === "convert" && method === "POST")
      return response(
        await convertEntity(ctx, z.string().max(40).parse(path[1]), z.uuid().parse(path[2]), z.object({ to: z.string().max(40).optional() }).catch({}).parse(await body(req).catch(() => ({}))).to),
        201,
      );
    if (path[0] === "projects" && method === "GET")
      return response(path[1] ? await projectDetail(ctx, z.uuid().parse(path[1])) : await projectsOverview(ctx));
    if (path[0] === "entities") {
      if (method === "GET")
        return response(
          await listEntities(
            ctx,
            path[1],
            Math.max(
              0,
              Math.min(
                100000,
                Number(req.nextUrl.searchParams.get("page")) || 0,
              ),
            ),
            req.nextUrl.searchParams.get("q")?.slice(0, 200) || "",
            req.nextUrl.searchParams.get("archived") === "true",
          ),
        );
      const input = await body(req);
      if (method === "POST")
        return response(await saveEntity(ctx, path[1], input.data), 201);
      if (method === "PATCH")
        return response(
          await saveEntity(
            ctx,
            path[1],
            input.data,
            z.uuid().parse(path[2]),
            z.number().int().parse(input.version),
          ),
        );
      if (method === "DELETE") {
        await archiveEntity(
          ctx,
          z.uuid().parse(path[2]),
          input.archived !== false,
        );
        return response({ ok: true });
      }
    }
    if (path[0] === "stock") {
      if (method === "GET") {
        if (ctx.demo) return response((await demoRead()).movements);
        const sb = await supabaseServer();
        const { data, error } = await sb
          .from("stock_movements")
          .select("*")
          .eq("company_id", ctx.company.id)
          .order("created_at", { ascending: false })
          .limit(100);
        dbError(error);
        return response(data);
      }
      const input = z
        .object({
          productId: z.uuid(),
          type: z.enum(["in", "out"]),
          quantity: z.number().int().positive().max(999999999),
          reference: z.string().trim().min(1).max(200),
          notes: z.string().max(2000).optional(),
        })
        .parse(await body(req));
      return response(await movement(ctx, input), 201);
    }
    if (path[0] === "purchase") {
      const input = await body(req);
      await purchaseAction(
        ctx,
        z.uuid().parse(path[1]),
        z
          .enum([
            "approve",
            "receive",
            "request_vendor",
            "vendor_confirm",
            "dispatch",
            "deliver",
            "cancel",
          ])
          .parse(input.action),
      );
      return response({ ok: true });
    }
    if (path[0] === "deal") {
      assert(
        ["owner", "manager"].includes(ctx.member.role) &&
          canWrite(ctx, "Business Development"),
        "ไม่มีสิทธิ์อนุมัติ",
        403,
      );
      const id = z.uuid().parse(path[1]);
      if (ctx.demo)
        await demoMutate((s) => {
          const deal = s.entities.find(
            (e) => e.id === id && e.kind === "deals",
          );
          assert(
            deal && deal.data.status === "pending",
            "ดีลไม่ได้รออนุมัติ",
            409,
          );
          let projectId = String(deal.data.projectId || "");
          const at = new Date().toISOString();
          if (!projectId) {
            projectId = randomUUID();
            s.entities.unshift({
              id: projectId,
              company_id: ctx.company.id,
              kind: "projects",
              department: "Operations",
              data: {
                name: deal.data.name,
                status: "active",
                priority: "normal",
                budget: deal.data.rent,
              },
              created_by: ctx.user.id,
              created_at: at,
              updated_at: at,
              version: 1,
              archived_at: null,
            });
          }
          for (const [department, name] of [
            ["Design", "เขียนแบบ / Perspective"],
            ["Purchasing", "ขอใบเสนอราคา"],
            ["Warehouse", "เตรียมสินค้า"],
            ["Marketing", "เตรียมสื่อ"],
            ["Sales", "วางแผนการขาย"],
          ])
            s.entities.unshift({
              id: randomUUID(),
              company_id: ctx.company.id,
              kind: "tasks",
              department,
              data: {
                name,
                department,
                projectId,
                dealId: id,
                status: "pending",
                priority: "normal",
              },
              created_by: ctx.user.id,
              created_at: at,
              updated_at: at,
              version: 1,
              archived_at: null,
            });
          deal.data.status = "approved";
          deal.data.projectId = projectId;
          deal.version++;
          demoAudit(s, "deal_approved", id);
        });
      else {
        const sb = await supabaseServer();
        const { error } = await sb.rpc("approve_deal", {
          p_company: ctx.company.id,
          p_id: id,
        });
        dbError(error);
      }
      return response({ ok: true });
    }
    if (path[0] === "company") {
      requireOwner(ctx);
      const input = await body(req);
      const profile = z
        .record(z.string(), z.string().max(150000))
        .parse(input.profile);
      assert(profile.name?.trim(), "กรอกชื่อบริษัท");
      for (const [k, v] of Object.entries(profile)) {
        if (!v) continue;
        if (k === "logo" || k === "cover")
          assert(
            v.length <= (k === "logo" ? 60000 : 150000) &&
              /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/.test(v),
            "รูปภาพไม่ถูกต้องหรือใหญ่เกินไป",
          );
        else assert(v.length <= 3000, "ข้อมูลบริษัทยาวเกินไป");
      }
      assert(
        !profile.taxId || /^\d{13}$/.test(profile.taxId),
        "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก",
      );
      assert(!profile.bio || profile.bio.length <= 160, "Bio ยาวได้ไม่เกิน 160 ตัวอักษร");
      assert(
        !profile.visibility || validVisibility(profile.visibility),
        "การตั้งค่าการมองเห็นไม่ถูกต้อง",
      );
      assert(
        !profile.founded || validDate(profile.founded),
        "วันที่ก่อตั้งไม่ถูกต้อง",
      );
      assert(
        Object.keys(profile).every((k) =>
          companyFields.some((f) => f.key === k),
        ),
        "ฟิลด์บริษัทไม่ถูกต้อง",
      );
      const settings = input.settings
        ? z
            .object({
              theme: z.enum(["violet", "ocean", "forest"]),
              brand: z.enum(["EliteFlow", "ZettaFlow"]).optional(),
            })
            .parse(input.settings)
        : undefined;
      if (ctx.demo)
        await demoMutate((s) => {
          s.company.profile = profile;
          s.company.name = profile.name;
          if (settings) s.company.settings = settings;
          demoAudit(s, "company_updated", ctx.company.id);
        });
      else {
        const sb = await supabaseServer();
        const { error } = await sb.rpc("save_company", {
          p_company: ctx.company.id,
          p_profile: profile,
          p_settings: settings || null,
        });
        dbError(error);
      }
      return response({ ok: true });
    }
    if (path[0] === "team") {
      requireOwner(ctx);
      if (method === "GET") {
        if (ctx.demo) {
          const s = await demoRead();
          return response({ members: s.members, invites: s.invites });
        }
        const sb = await supabaseServer();
        const [{ data: members, error }, { data: invites, error: e }] =
          await Promise.all([
            sb.from("memberships").select("*").eq("company_id", ctx.company.id),
            sb.from("invitations").select("*").eq("company_id", ctx.company.id),
          ]);
        dbError(error);
        dbError(e);
        return response({ members, invites });
      }
      const input = z
        .object({
          email: z.email().optional(),
          role: z.enum(["manager", "staff", "viewer"]),
          departments: z.array(z.string().min(1).max(100)).min(1).max(20),
          disabled: z.boolean().optional(),
        })
        .parse(await body(req));
      if (ctx.demo)
        await demoMutate((s) => {
          if (path[1]) {
            const m = s.members.find((m) => m.id === path[1]);
            assert(m && m.role !== "owner", "แก้ไขเจ้าของบริษัทไม่ได้");
            Object.assign(m, {
              role: input.role,
              departments: input.departments,
              disabled: input.disabled || false,
            });
          } else {
            assert(input.email, "กรอกอีเมล");
            s.invites.push({
              ...input,
              id: randomUUID(),
              company_id: ctx.company.id,
              expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
            });
          }
          demoAudit(s, "team_updated", String(input.email || path[1]));
        });
      else {
        const sb = await supabaseServer();
        const { error } = path[1]
          ? await sb.rpc("edit_member", {
              p_company: ctx.company.id,
              p_id: z.uuid().parse(path[1]),
              p_role: input.role,
              p_departments: input.departments,
              p_disabled: input.disabled || false,
            })
          : await sb.rpc("invite_member", {
              p_company: ctx.company.id,
              p_email: z.email().parse(input.email),
              p_role: input.role,
              p_departments: input.departments,
            });
        dbError(error);
      }
      return response({ ok: true });
    }
    // B2B chat: GET /b2b (inbox), GET /b2b/unread, POST /b2b/open {company, post?},
    // GET /b2b/<thread> (messages, marks read), POST /b2b/<thread> {body, post?}.
    if (path[0] === "b2b") {
      if (!path[1] && method === "GET") return response(await b2bInbox(ctx));
      if (path[1] === "unread") return response({ unread: await b2bUnread(ctx) });
      if (path[1] === "open" && method === "POST") return response(await b2bOpen(ctx, await body(req)));
      if (path[1] && method === "GET") return response(await b2bRead(ctx, path[1]));
      if (path[1] && method === "POST") return response(await b2bSend(ctx, path[1], await body(req)), 201);
    }
    if (path[0] === "chat") {
      const department =
        req.nextUrl.searchParams.get("department") || "Operations";
      assert(canRead(ctx, department), "ไม่มีสิทธิ์ห้องนี้", 403);
      if (method === "GET") {
        if (ctx.demo)
          return response(
            (await demoRead()).messages
              .filter((m) => m.department === department)
              .slice(-100),
          );
        const sb = await supabaseServer();
        const { data, error } = await sb
          .from("messages")
          .select("*")
          .eq("company_id", ctx.company.id)
          .eq("department", department)
          .order("created_at", { ascending: false })
          .limit(100);
        dbError(error);
        return response((data || []).reverse());
      }
      assert(canWrite(ctx, department), "ไม่มีสิทธิ์ส่งข้อความ", 403);
      const input = await body(req);
      const message = z.string().trim().min(1).max(4000).parse(input.body);
      if (ctx.demo)
        await demoMutate((s) =>
          s.messages.push({
            id: randomUUID(),
            company_id: ctx.company.id,
            department,
            channel: department,
            body: message,
            user_id: ctx.user.id,
            name: ctx.user.name,
            created_at: new Date().toISOString(),
          }),
        );
      else {
        const sb = await supabaseServer();
        const { error } = await sb.rpc("send_message", {
          p_company: ctx.company.id,
          p_department: department,
          p_body: message,
        });
        dbError(error);
      }
      return response({ ok: true });
    }
    if (path[0] === "templates") {
      if (method === "GET") return response(await templates(ctx));
      if (path[1] === "draft")
        return response(await draftTemplate(ctx, await body(req)));
      if (path[2] === "target") {
        await setTemplateTarget(ctx, z.uuid().parse(path[1]), await body(req));
        return response({ ok: true });
      }
      return response(await saveTemplate(ctx, await body(req), path[1]));
    }
    if (path[0] === "ingestions") {
      if (path[2] === "retry" && method === "POST") {
        assert(
          !ctx.demo && process.env.SUPABASE_SERVICE_ROLE_KEY,
          "ตั้งค่า Supabase worker ก่อน",
          503,
        );
        const sb = await supabaseServer();
        const id = z.uuid().parse(path[1]);
        const { error } = await sb.rpc("retry_ingestion", {
          p_company: ctx.company.id,
          p_id: id,
        });
        dbError(error);
        after(() => processJobs(id).then(() => {}));
        return response({ ok: true });
      }
      if (method === "GET") {
        // ?kind=<page> lists what LINE groups sent for that page and is still open.
        const kind = req.nextUrl.searchParams.get("kind");
        const listed = await ingestions(ctx, kind && catalog[kind] ? kind : undefined, req.nextUrl.searchParams.get("history") === "1");
        // Show the LINE display name of whoever sent it, not the raw LINE id.
        const rows = await Promise.all(
          listed.map(async (i) => {
            const g = (i as { group_id?: string | null }).group_id;
            return g && i.source_user ? { ...i, sender_name: await lineName(g, i.source_user) } : i;
          }),
        );
        if (
          !ctx.demo &&
          process.env.SUPABASE_SERVICE_ROLE_KEY &&
          rows.some(
            (i) =>
              i.status === "queued" ||
              (i.status === "processing" &&
                i.lease_until &&
                Date.parse(i.lease_until) < Date.now()),
          )
        )
          after(async () => {
            await processJobs();
            await processNotifications();
          });
        return response(rows);
      }
      if (method === "POST") {
        assert(
          ctx.demo || process.env.SUPABASE_SERVICE_ROLE_KEY,
          "ตั้งค่า Service role เพื่อประมวลผลบน server",
          503,
        );
        const input = z
          .object({
            templateId: z.uuid(),
            raw: z.string().max(15000),
            attachmentId: z.uuid().optional(),
          })
          .parse(await body(req));
        const item = await submit(ctx, input);
        if (!ctx.demo)
          after(async () => {
            await processJobs(item.id);
            await processNotifications();
          });
        return response(item, 202);
      }
      const input = z
        .object({
          status: z.enum(["approved", "rejected"]),
          values: z.record(z.string(), z.unknown()),
          reason: z.string().max(2000).default(""),
        })
        .parse(await body(req));
      await decide(ctx, z.uuid().parse(path[1]), input);
      // The decision is announced back in the LINE group that asked (queued by the database).
      if (!ctx.demo) after(processNotifications);
      return response({ ok: true });
    }
    if (path[0] === "receipt-docs" && method === "GET") return response(await receiptsList(ctx));
    if (path[0] === "transfers") {
      if (method === "GET") return response(await transferData(ctx));
      return response(await transferStock(ctx, await body(req)));
    }
    if (path[0] === "project-stages") {
      if (method === "GET")
        return response(
          await stageData(
            ctx,
            z.uuid().parse(req.nextUrl.searchParams.get("project")),
          ),
        );
      return response(await changeStage(ctx, await body(req)));
    }
    if (path[0] === "design") {
      if (method === "GET")
        return response(
          await designData(
            ctx,
            z.uuid().parse(req.nextUrl.searchParams.get("project")),
          ),
        );
      return response(await designAction(ctx, await body(req)));
    }
    if (path[0] === "files") {
      if (method === "GET" && path[1]) {
        const { file, bytes } = await download(ctx, z.uuid().parse(path[1]));
        // Photos and PDFs open in the page (receipt panels, LINE review); everything else, or ?download=1, downloads.
        const inline = ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.mime) && !req.nextUrl.searchParams.has("download");
        return new Response(new Uint8Array(bytes), {
          headers: {
            "Content-Type": file.mime,
            "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
          },
        });
      }
      if (method === "GET")
        return response(
          await files(ctx, req.nextUrl.searchParams.get("entity") || undefined),
        );
      // Direct upload: the browser sends the file to storage itself, so its size is not limited by this request.
      if (path[1] === "direct" && path[2] === "complete") return response(await finishUpload(ctx, await body(req)), 201);
      if (path[1] === "direct") return response(await prepareUpload(ctx, await body(req)));
      // Through the server: demo mode (local files). Hosting caps a request near 4.5 MB, local dev does not.
      assert(
        Number(req.headers.get("content-length") || 0) <= (demoEnabled() ? MAX_UPLOAD + 200000 : 4500000),
        "ไฟล์ใหญ่เกินไป",
        413,
      );
      const form = await req.formData();
      const file = form.get("file");
      assert(file instanceof File, "เลือกไฟล์");
      return response(
        await upload(
          ctx,
          file,
          z.string().min(1).max(100).parse(form.get("department")),
          form.get("entity") ? z.uuid().parse(form.get("entity")) : null,
        ),
        201,
      );
    }
    if (path[0] === "export") {
      const kind = req.nextUrl.searchParams.get("kind") || "customers";
      assert(catalog[kind], "ไม่พบโมดูล");
      let rows = [] as import("@/lib/types").Entity[];
      for (let p = 0; p < 400; p++) {
        const result = await listEntities(ctx, kind, p);
        rows.push(...result.rows);
        if (rows.length >= result.count) break;
      }
      const cols = catalog[kind].columns;
      const csv = safeCsv([
        ["id", ...cols],
        ...rows.map((e) => [
          e.id,
          ...cols.map(
            (c) =>
              e.data[c] ?? (e as unknown as Record<string, unknown>)[c] ?? "",
          ),
        ]),
      ]);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${kind}.csv"`,
          "Cache-Control": "private,no-store",
        },
      });
    }
    if (path[0] === "line-page" && method === "GET") {
      // LINE Integration page: groups + stats + approvers + activity + package in one read.
      return response(await linePageData(ctx));
    }
    if (path[0] === "line-groups" && method === "GET") {
      // หน้า LINE: groups with activity, or one group's messages (?group=…).
      if (ctx.demo) return response([]);
      const group = req.nextUrl.searchParams.get("group");
      return response(group ? await lineGroupMessages(ctx, z.string().min(1).max(100).parse(group)) : await lineGroupsOverview(ctx));
    }
    if (path[0] === "integrations") {
      if (method === "GET") {
        if (ctx.demo)
          return response({
            groups: [],
            notifications: [],
            configured: false,
          });
        requireOwner(ctx);
        const sb = await supabaseServer();
        const [{ data: groups }, { data: notifications }] = await Promise.all([
          sb.from("line_groups").select("*").eq("company_id", ctx.company.id),
          sb
            .from("notification_outbox")
            .select("*")
            .eq("company_id", ctx.company.id)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        return response({
          groups,
          notifications,
          configured: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
        });
      }
      if (method === "PATCH" || method === "DELETE") {
        requireOwner(ctx);
        assert(!ctx.demo, "เชื่อม LINE จริงก่อนจึงตั้งค่ากลุ่มได้", 503);
        const sb = await supabaseServer();
        const group = z.string().min(1).max(100).parse(path[1]);
        if (method === "DELETE") {
          const { error } = await sb.rpc("unlink_line_group", {
            p_company: ctx.company.id,
            p_group: group,
          });
          dbError(error);
          return response({ ok: true });
        }
        const input = z
          .object({
            templateId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
            name: z.string().max(100).default(""),
            keywords: z.array(z.string().trim().min(2).max(50)).min(1).max(10),
            department: z.string().max(60).nullable().default(null),
          })
          .parse(await body(req));
        const { error } = await sb.rpc("update_line_group", {
          p_company: ctx.company.id,
          p_group: group,
          p_template: input.templateId,
          p_name: input.name,
          p_keywords: input.keywords,
          p_department: input.department || null,
        });
        dbError(error);
        return response({ ok: true });
      }
      assert(
        !ctx.demo &&
          process.env.LINE_CHANNEL_SECRET &&
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        "ตั้งค่า LINE และ Service role บน Vercel ก่อน",
        503,
      );
      const input = await body(req);
      assert(
        ctx.member.role !== "viewer",
        "Viewer เชื่อมบัญชีเพื่อส่งงานไม่ได้",
        403,
      );
      const userLink = input.action === "user";
      if (!userLink) requireOwner(ctx);
      const token = randomBytes(24).toString("hex");
      const sb = supabaseAdmin();
      let templateId: null | string = null;
      // A group code without a template pairs the group in AI sorting mode.
      if (!userLink && input.templateId) {
        templateId = z.uuid().parse(input.templateId);
        assert(
          (await templates(ctx)).some((t) => t.id === templateId),
          "ไม่พบ Template",
        );
      }
      // The department chosen with the group code: the group is paired straight into it.
      const department = !userLink && input.department ? z.enum(departmentNames as unknown as [string, ...string[]]).parse(input.department) : null;
      const { error } = await sb.from("line_pairings").insert({
        token_hash: tokenHash(token),
        company_id: ctx.company.id,
        template_id: templateId,
        department,
        user_id: userLink ? ctx.user.id : null,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      });
      dbError(error);
      return response({
        command: `#${userLink ? "user" : "connect"} ${token}`,
      });
    }
    throw new AppError("ไม่พบ API", 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return response(
        { error: e.issues.map((i) => i.message).join(" · ") },
        400,
      );
    return response(
      {
        error:
          e instanceof AppError
            ? e.message
            : "ระบบไม่พร้อม กรุณาตรวจการตั้งค่าและลองใหม่",
      },
      e instanceof AppError ? e.status : 500,
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
