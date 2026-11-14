import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  validLineSignature,
  tokenHash,
  processJobs,
  processNotifications,
  draftSaved,
  approvalAfter,
} from "@/lib/ai";
import { approvalAction, reasonPrompt, type ActResult } from "@/lib/line-mention";
import { draftAction, editPrompt, EDIT_MS, editText, listenPlan, LISTEN_MS, mentionOf, mentionPrompt, type ListenRow } from "@/lib/line-mention";
import { assert } from "@/lib/domain";
import { dbError } from "@/lib/data";
import { isQuestion, answerQuestion, lineReply, type QuickStats } from "@/lib/line";
import { decidedText, deptThai, groupRejection, parseDecision } from "@/lib/line-message";
import { classifyLineFile, LINE_MAX_BYTES, shrinkImage, VOICE_MAX_MS } from "@/lib/line-files";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
/** Short enough to keep LINE's free reply, long enough for a caption that follows a photo. */
const BURST_WAIT_MS = 6000;
/** What was decided, for the bot's answer: item name, its page, who asked and who decided. */
async function decidedItem(sb: ReturnType<typeof supabaseAdmin>, id: string) {
  const { data } = await sb.from("ingestions").select("values, target_kind, sender_name, decided_name").eq("id", id).maybeSingle();
  return {
    name: String((data?.values as { name?: string } | null)?.name || ""),
    kind: (data?.target_kind as string | null) || null,
    requester: (data?.sender_name as string | null) || null,
    decider: (data?.decided_name as string | null) || null,
  };
}

type Admin = ReturnType<typeof supabaseAdmin>;
let botDisplayName: string | null | undefined;
/** The bot's LINE name, so "@<name>" typed by hand also counts as a mention. */
async function botName() {
  if (botDisplayName !== undefined || !process.env.LINE_CHANNEL_ACCESS_TOKEN) return botDisplayName || null;
  const r = await fetch("https://api.line.me/v2/bot/info", {
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  }).catch(() => null);
  botDisplayName = r?.ok ? String(((await r.json()) as { displayName?: string }).displayName || "") || null : null;
  return botDisplayName;
}
/** Start (or move) listening to one member for a short while. */
async function listen(sb: Admin, companyId: string, groupId: string, userId: string, mode: ListenRow["mode"], ingestionId: string | null, ms: number) {
  await sb
    .from("line_listen")
    .upsert({ group_id: groupId, line_user: userId, company_id: companyId, mode, ingestion_id: ingestionId, until: new Date(Date.now() + ms).toISOString() });
}
/** Read a draft (or an item still in review) again with a correction and/or a new file; the worker sends a new summary. */
async function rereadDraft(sb: Admin, id: string, note: string, replyToken: string | null, attachmentId?: string | null) {
  const { data: item } = await sb.from("ingestions").select("id, raw, status").eq("id", id).maybeSingle();
  if (!item || !["draft", "review", "failed"].includes(item.status)) return false;
  await sb.from("notification_outbox").delete().eq("id", id);
  const { data: took, error } = await sb
    .from("ingestions")
    .update({
      raw: (String(item.raw || "") + (note ? "\n[แก้ไข] " + note : "")).slice(0, 15000),
      ...(attachmentId ? { attachment_id: attachmentId } : {}),
      status: "queued",
      missing: [],
      error: null,
      attempts: 0,
      lease_until: null,
      bot_message_id: null,
      reply_token: replyToken,
    })
    .eq("id", id)
    .in("status", ["draft", "review", "failed"])
    .select("id");
  dbError(error);
  return !!took?.length;
}
/** The buttons on a summary card: บันทึกได้เลย (to the website), แก้ไข (listen for the correction), ยกเลิก. */
async function draftButton(sb: Admin, event: { replyToken?: string; postback?: { data?: string }; source: { groupId: string; userId?: string } }) {
  const a = draftAction(String(event.postback?.data || ""));
  const groupId = event.source.groupId,
    userId = event.source.userId;
  if (!a || !userId) return;
  if (a.act === "edit") {
    const { data: i } = await sb.from("ingestions").select("id, company_id, status").eq("id", a.id).eq("group_id", groupId).maybeSingle();
    if (!i || i.status !== "draft") {
      await lineReply(event.replyToken, i && ["queued", "processing"].includes(i.status) ? "กำลังสรุปใหม่อยู่ค่ะ รอสักครู่นะคะ" : "รายการนี้บันทึกหรือยกเลิกไปแล้ว แก้จากการ์ดนี้ไม่ได้ค่ะ");
      return;
    }
    await listen(sb, i.company_id, groupId, userId, "edit", i.id, EDIT_MS);
    await lineReply(event.replyToken, editPrompt);
    return;
  }
  const { error } = await sb.rpc("line_draft_decide", { p_group: groupId, p_user: userId, p_id: a.id, p_save: a.act === "save" });
  if (error) await lineReply(event.replyToken, "⚠️ " + error.message);
  else if (a.act === "save") await draftSaved(a.id, event.replyToken || null);
  else await lineReply(event.replyToken, "🗑️ ยกเลิกแล้ว ไม่บันทึกรายการนี้ค่ะ");
}

/**
 * An approver's decision from LINE (button, or the reason typed after ไม่อนุมัติ / ขอแก้ไข). The database checks
 * who they are (linked LINE account), that it is their step, and that it is not their own request.
 */
async function approvalDecide(sb: Admin, groupId: string, userId: string, id: string, action: "approve" | "reject" | "fix", note: string | null, step: number | null, replyToken: string | null) {
  const { data, error } = await sb.rpc("line_approval_act", { p_group: groupId, p_user: userId, p_id: id, p_action: action, p_note: note, p_step: step });
  if (error) {
    await lineReply(replyToken || undefined, "⚠️ " + error.message);
    return;
  }
  await approvalAfter(id, data as ActResult, replyToken, groupId);
}
/** Buttons on an approver card: อนุมัติ acts at once; ไม่อนุมัติ / ขอแก้ไข first ask for the reason. */
async function approvalButton(sb: Admin, event: { replyToken?: string; postback?: { data?: string }; source: { groupId: string; userId?: string } }) {
  const a = approvalAction(String(event.postback?.data || ""));
  const groupId = event.source.groupId,
    userId = event.source.userId;
  if (!a || !userId) return false;
  if (a.act === "approve") {
    await approvalDecide(sb, groupId, userId, a.id, "approve", null, a.step, event.replyToken || null);
    return true;
  }
  const { data: i } = await sb.from("ingestions").select("id, company_id, status").eq("id", a.id).maybeSingle();
  if (!i || i.status !== "review") {
    await lineReply(event.replyToken, "รายการนี้ตัดสินหรือส่งกลับไปแล้วค่ะ");
    return true;
  }
  await listen(sb, i.company_id, groupId, userId, a.act, i.id, EDIT_MS);
  await lineReply(event.replyToken, reasonPrompt[a.act]);
  return true;
}

export async function POST(req: Request) {
  try {
    assert(
      Number(req.headers.get("content-length") || 0) <= 4500000,
      "Body too large",
      413,
    );
    const raw = Buffer.from(await req.arrayBuffer());
    assert(raw.length <= 4500000, "Body too large", 413);
    if (!validLineSignature(raw, req.headers.get("x-line-signature")))
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    const body = JSON.parse(raw.toString());
    assert(
      Array.isArray(body.events) && body.events.length <= 100,
      "Invalid events",
    );
    const sb = supabaseAdmin();
    for (const event of body.events) {
      if (event.type === "postback" && event.source?.groupId) {
        if (!(await approvalButton(sb, event))) await draftButton(sb, event);
        continue;
      }
      if (event.type !== "message" || !event.source?.groupId) continue;
      const message = event.message,
        groupId = event.source.groupId,
        userId = event.source.userId;
      if (message.type === "text" && userId && !message.text.startsWith("#")) {
        const { data: wait } = await sb.from("line_listen").select("mode, ingestion_id, until").eq("group_id", groupId).eq("line_user", userId).maybeSingle();
        const plan = listenPlan(wait as ListenRow | null, "text");
        if (plan.act === "decide") {
          await sb.from("line_listen").delete().eq("group_id", groupId).eq("line_user", userId);
          await approvalDecide(sb, groupId, userId, plan.id, plan.action, message.text.trim(), null, event.replyToken || null);
          continue;
        }
      }
      if (message.type === "text" && message.text.startsWith("#connect ")) {
        const { error } = await sb.rpc("pair_line_group", {
          p_hash: tokenHash(message.text.slice(9).trim()),
          p_group: groupId,
        });
        const { data: paired } = error ? { data: null } : await sb.from("line_groups").select("department").eq("group_id", groupId).maybeSingle();
        const dept = paired?.department ? deptThai[paired.department] || paired.department : "";
        await lineReply(
          event.replyToken,
          error
            ? "เชื่อมกลุ่มไม่สำเร็จ: " + error.message
            : "✅ เชื่อมกลุ่มนี้กับ EliteFlow แล้ว" +
              (dept ? " เป็นกลุ่มของ" + dept : "") +
              "\nแท็ก @บอท แล้วพิมพ์สิ่งที่จะบันทึก เช่น “@บอท ค่าน้ำมัน 500 บาท” หรือแท็กแล้วส่งรูป ไฟล์ หรือข้อความเสียงตามภายใน 2 นาที" +
              "\nน้องจะสรุปให้ตรวจก่อน กด “บันทึกได้เลย” จึงส่งเข้าเว็บ ถ้าต้องแก้ กด “แก้ไข” แล้วพิมพ์ได้เลย" +
              "\n\nℹ️ แจ้งสมาชิก: ระบบอ่านและบันทึกเฉพาะข้อความที่แท็กบอท (และรูปหรือไฟล์ที่ส่งตามมา) พร้อมชื่อผู้ส่ง เพื่อใช้งานภายในบริษัท " +
              "ข้อความอื่นในกลุ่มจะไม่ถูกเก็บ (ข้อความเสียงจะถูกถอดเป็นตัวอักษร และลบไฟล์เสียงหลัง 90 วัน)",
        );
        continue;
      }
      if (message.type === "text" && message.text.startsWith("#user ")) {
        if (!userId) continue;
        const { error } = await sb.rpc("pair_line_user", {
          p_hash: tokenHash(message.text.slice(6).trim()),
          p_group: groupId,
          p_line_user: userId,
        });
        await lineReply(
          event.replyToken,
          error ? "ผูกบัญชีไม่สำเร็จ: " + error.message : "✅ ผูกบัญชี LINE กับผู้ใช้ EliteFlow แล้ว",
        );
        continue;
      }
      if (message.type === "text" && message.text.startsWith("#approve ")) {
        if (!userId) continue;
        const { error } = await sb.rpc("line_approve", {
          p_group: groupId,
          p_user: userId,
          p_id: message.text.slice(9).trim(),
        });
        await lineReply(
          event.replyToken,
          error ? "อนุมัติไม่สำเร็จ: " + error.message : "✅ อนุมัติแล้ว ระบบสร้างงานให้ทีมที่เกี่ยวข้อง",
        );
        continue;
      }
      // Reply (quote) on a bot message about an item:
      //  • on the notice in the group that asked → add the missing data or correct it; the item is read again;
      //  • on a request posted in the approving department's group → "อนุมัติ", "ไม่อนุมัติ เพราะ…" or "แก้ …".
      if (message.type === "text" && message.quotedMessageId) {
        const quoted = String(message.quotedMessageId);
        const { data: link } = await sb
          .from("line_bot_messages")
          .select("ingestion_id, role")
          .eq("group_id", groupId)
          .eq("message_id", quoted)
          .maybeSingle();
        const { data: item } = link
          ? await sb.from("ingestions").select("id, raw, status, target_kind, department, approval").eq("id", link.ingestion_id).maybeSingle()
          : await sb.from("ingestions").select("id, raw, status, target_kind, department, approval").eq("group_id", groupId).eq("bot_message_id", quoted).maybeSingle();
        if (item) {
          const role = link?.role || "source";
          const reread = async (note: string, replyToken: string | null) => {
            await sb.from("notification_outbox").delete().eq("id", item.id);
            const { error } = await sb
              .from("ingestions")
              .update({
                raw: (String(item.raw || "") + "\n" + note).slice(0, 15000),
                status: "queued",
                missing: [],
                error: null,
                attempts: 0,
                lease_until: null,
                bot_message_id: null,
                reply_token: replyToken,
              })
              .eq("id", item.id)
              .in("status", ["review", "failed"]);
            dbError(error);
            after(async () => {
              await processJobs(item.id);
              await processNotifications();
            });
          };
          if (role === "approver" && item.approval) {
            const decision = parseDecision(message.text);
            if (decision?.status === "rejected" && decision.reason && userId)
              await approvalDecide(sb, groupId, userId, item.id, "reject", decision.reason, null, event.replyToken || null);
            else if (decision?.status === "edit" && userId) await approvalDecide(sb, groupId, userId, item.id, "fix", decision.note, null, event.replyToken || null);
            else await lineReply(event.replyToken, "กดปุ่ม ✅ อนุมัติ / ✏️ ขอแก้ไข / ❌ ไม่อนุมัติ ในการ์ดขออนุมัติได้เลยค่ะ (อนุมัติด้วยการพิมพ์ไม่ได้ เพื่อกันการอนุมัติโดยไม่ตั้งใจ)");
            continue;
          } else if (role === "approver") {
            const decision = parseDecision(message.text);
            if (!decision) {
              await lineReply(event.replyToken, "พิมพ์ “อนุมัติ”, “ไม่อนุมัติ เพราะ…” หรือ “แก้ …” ตอบข้อความคำขอนะคะ");
            } else if (decision.status === "edit") {
              if (!["review", "failed"].includes(item.status)) await lineReply(event.replyToken, "รายการนี้ตัดสินไปแล้ว แก้ไม่ได้");
              else {
                // Read again with the correction; the group that asked gets the corrected notice, and the request comes back here.
                await reread("[แก้ไขโดย" + (deptThai[String(item.department)] || "ผู้อนุมัติ") + "] " + decision.note, null);
                await lineReply(event.replyToken, "✏️ รับคำแก้ไขแล้ว ระบบกำลังอ่านใหม่ แล้วจะส่งคำขอที่แก้แล้วมาให้อนุมัติอีกครั้ง");
              }
            } else if (userId) {
              const { error } = await sb.rpc("line_decide", {
                p_group: groupId,
                p_user: userId,
                p_id: item.id,
                p_status: decision.status,
                p_reason: decision.status === "rejected" ? decision.reason : "",
              });
              await lineReply(
                event.replyToken,
                error
                  ? "ทำรายการไม่สำเร็จ: " + error.message
                  : decidedText(decision.status, await decidedItem(sb, item.id), decision.status === "rejected" ? decision.reason : "") +
                    "\n(แจ้งผลกลับกลุ่มที่ขอแล้ว)",
              );
              after(processNotifications);
            }
          } else if (item.status === "draft") {
            // Reply on a summary card: "บันทึก" saves, "ยกเลิก" cancels, anything else is a correction.
            const t = message.text.trim();
            const cancel = /^(ยกเลิก|ไม่บันทึก)$/.test(t);
            if (cancel || /^(บันทึก(ได้เลย)?|ยืนยัน|ok|โอเค)$/i.test(t))
              await draftButton(sb, { replyToken: event.replyToken, postback: { data: `draft=${cancel ? "cancel" : "save"}&id=${item.id}` }, source: { groupId, userId } });
            else {
              await rereadDraft(sb, item.id, t, event.replyToken || null);
              if (userId) await sb.from("line_listen").delete().eq("group_id", groupId).eq("line_user", userId);
            }
            continue;
          } else if (item.status === "review" && userId && (() => {
            const d = parseDecision(message.text);
            return d?.status === "approved" || d?.status === "rejected";
          })()) {
            // A manager answering the notice in the group that asked: "อนุมัติ" / "ไม่อนุมัติ เพราะ…" decides it here.
            const d = parseDecision(message.text) as { status: "approved" } | { status: "rejected"; reason: string };
            const reason = d.status === "rejected" ? d.reason : "";
            const { error } = await sb.rpc("line_decide", { p_group: groupId, p_user: userId, p_id: item.id, p_status: d.status, p_reason: reason });
            await lineReply(event.replyToken, error ? "ทำรายการไม่สำเร็จ: " + error.message : decidedText(d.status, await decidedItem(sb, item.id), reason));
          } else if (["review", "failed"].includes(item.status)) {
            await reread("[แก้ไข/เพิ่มเติม] " + message.text, event.replyToken || null);
          }
          // A reply on the notice of an item already decided gets no bot answer; it is read like any new
          // message below (small talk such as "ขอบคุณ" is skipped, a new request is filed as usual).
          if (role === "approver" || ["review", "failed"].includes(item.status)) continue;
        }
      }
      if (message.type === "text" && userId) {
        const { data: approved, error } = await sb.rpc("line_keyword_approve", {
          p_group: groupId,
          p_user: userId,
          p_text: message.text,
        });
        if (approved || error) {
          await lineReply(
            event.replyToken,
            error
              ? "อนุมัติไม่สำเร็จ: " + error.message
              : decidedText("approved", await decidedItem(sb, String(approved))),
          );
          continue;
        }
      }
      // "ไม่อนุมัติ เพราะ…" / "ไม่ให้" typed in the group: the manager rejects the latest item waiting there.
      const rejection = message.type === "text" && userId ? groupRejection(message.text) : null;
      if (rejection !== null && userId) {
        const { data: latest } = await sb
          .from("ingestions")
          .select("id, values")
          .eq("group_id", groupId)
          .eq("status", "review")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!latest) {
          await lineReply(event.replyToken, "ไม่มีรายการที่รออนุมัติในกลุ่มนี้");
          continue;
        }
        const { error } = await sb.rpc("line_decide", { p_group: groupId, p_user: userId, p_id: latest.id, p_status: "rejected", p_reason: rejection });
        await lineReply(
          event.replyToken,
          error ? "ไม่อนุมัติไม่สำเร็จ: " + error.message : decidedText("rejected", await decidedItem(sb, latest.id), rejection),
        );
        continue;
      }
      const { data: group } = await sb
        .from("line_groups")
        .select("*")
        .eq("group_id", groupId)
        .single();
      if (!group) continue;
      // Mention mode (default): only what @mentions the bot is read; other messages are not stored at all,
      // except from a member the bot is listening to right after a mention or the แก้ไข button.
      const mentionMode = group.listen !== "all";
      let raw = message.type === "text" ? String(message.text || "") : "",
        mentioned = false,
        attachTo: string | null = null,
        editOf: string | null = null;
      if (mentionMode) {
        if (!userId) continue;
        const m = message.type === "text" ? mentionOf(message, await botName()) : { mentioned: false, text: "" };
        if (m.mentioned) {
          mentioned = true;
          raw = m.text;
          if (!raw) {
            await listen(sb, group.company_id, groupId, userId, "any", null, LISTEN_MS);
            await lineReply(event.replyToken, mentionPrompt);
            continue;
          }
          const fix = editText(raw);
          if (fix) {
            const { data: last } = await sb
              .from("ingestions")
              .select("id")
              .eq("group_id", groupId)
              .eq("source_user", userId)
              .eq("status", "draft")
              .gte("created_at", new Date(Date.now() - 3 * 3600_000).toISOString())
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (last && (await rereadDraft(sb, last.id, fix, event.replyToken || null))) continue;
          }
        } else {
          const { data: row } = await sb.from("line_listen").select("mode, ingestion_id, until").eq("group_id", groupId).eq("line_user", userId).maybeSingle();
          const plan = listenPlan(row as ListenRow | null, message.type);
          if (plan.act === "ignore") continue;
          if (plan.act === "edit") {
            if (message.type === "text") {
              await sb.from("line_listen").delete().eq("group_id", groupId).eq("line_user", userId);
              await rereadDraft(sb, plan.id, raw, event.replyToken || null);
              continue;
            }
            editOf = plan.id;
          }
          if (plan.act === "attach") attachTo = plan.id;
        }
      }
      const question = mentionMode ? mentioned && isQuestion(raw) : message.type === "text" && isQuestion(raw);
      if (question) {
        const { data: stats } = await sb.rpc("line_quick_stats", { p_group: groupId });
        if (stats) {
          await lineReply(event.replyToken, answerQuestion(raw, stats as QuickStats));
          continue;
        }
      }
      const sourceEvent = event.webhookEventId || message.id;
      const { data: existing } = await sb
        .from("ingestions")
        .select("id")
        .eq("company_id", group.company_id)
        .eq("source_event", sourceEvent)
        .maybeSingle();
      if (existing) continue;
      // No template = AI sorts each message onto its page (or skips small talk) in the worker.
      const { data: template } = group.template_id
        ? await sb
            .from("data_templates")
            .select("*")
            .eq("id", group.template_id)
            .eq("company_id", group.company_id)
            .single()
        : { data: { id: null, name: "AI แยกอัตโนมัติ", department: "Operations", fields: [], steps: [], mode: "sort" } };
      if (!template) continue;
      let attachmentId = null;
      if (["image", "file", "audio"].includes(message.type)) {
        assert(
          process.env.LINE_CHANNEL_ACCESS_TOKEN,
          "LINE access token not configured",
          503,
        );
        // Voice messages longer than the limit are not transcribed (cost); tell the sender instead.
        if (message.type === "audio" && Number(message.duration || 0) > VOICE_MAX_MS) {
          await lineReply(event.replyToken, `🎤 ข้อความเสียงยาวเกิน ${VOICE_MAX_MS / 60000} นาที — กรุณาแบ่งเป็นคลิปสั้น ๆ หรือพิมพ์แทน`);
          continue;
        }
        if (message.type === "file" && Number(message.fileSize || 0) > LINE_MAX_BYTES) {
          await lineReply(event.replyToken, `📎 ไฟล์ ${message.fileName || ""} ใหญ่เกิน ${LINE_MAX_BYTES / 1_000_000} MB — กรุณาย่อหรือแยกไฟล์ก่อนส่ง`);
          continue;
        }
        const response = await fetch(
          `https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id)}/content`,
          {
            signal: AbortSignal.timeout(20000),
            headers: {
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
          },
        );
        assert(response.ok, "Cannot download LINE media", 502);
        const parts: Uint8Array[] = [];
        let size = 0,
          tooBig = false;
        for await (const chunk of response.body! as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > LINE_MAX_BYTES) {
            tooBig = true;
            break;
          }
          parts.push(chunk);
        }
        if (tooBig) {
          await lineReply(event.replyToken, `📎 ไฟล์ใหญ่เกิน ${LINE_MAX_BYTES / 1_000_000} MB — กรุณาย่อหรือแยกไฟล์ก่อนส่ง`);
          continue;
        }
        const bytes = Buffer.concat(parts);
        const fileName =
          message.fileName || (message.type === "audio" ? `เสียง-${message.id}.m4a` : `${message.id}.jpg`);
        const kind = classifyLineFile({
          bytes,
          mime: response.headers.get("content-type")?.split(";")[0] || "",
          name: fileName,
          messageType: message.type,
        });
        // Unsupported files get a reply in the group; never a failed webhook (LINE would resend it).
        if ("error" in kind) {
          await lineReply(event.replyToken, "⚠️ " + kind.error);
          continue;
        }
        // Phone photos are stored smaller (JPEG ≤2000 px); slips whose QR would no longer read stay as sent.
        const stored =
          kind.kind === "image" ? await shrinkImage(bytes, kind.mime) : { bytes, mime: kind.mime, shrunk: false };
        const mime = stored.mime;
        attachmentId = randomUUID();
        const path = `${group.company_id}/${template.department}/${attachmentId}`;
        const { error } = await sb.storage
          .from("eliteflow-files")
          .upload(path, stored.bytes, { contentType: mime, upsert: false });
        dbError(error);
        const { error: e } = await sb.from("attachments").insert({
          id: attachmentId,
          company_id: group.company_id,
          department: template.department,
          name: stored.shrunk ? fileName.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg" : fileName,
          mime,
          size: stored.bytes.length,
          path,
        });
        dbError(e);
      } else if (message.type !== "text") continue;
      if (editOf) {
        await sb.from("line_listen").delete().eq("group_id", groupId).eq("line_user", userId);
        await rereadDraft(sb, editOf, "ส่งไฟล์ใหม่", event.replyToken || null, attachmentId);
        continue;
      }
      if (attachTo && attachmentId) {
        // A photo right after "@บอท สลิปค่าน้ำมัน": it belongs to that draft (read again with the file).
        const { data: d } = await sb.from("ingestions").select("id, status, attachment_id").eq("id", attachTo).maybeSingle();
        if (d && !d.attachment_id && d.status === "queued") {
          await sb.from("ingestions").update({ attachment_id: attachmentId, reply_token: event.replyToken || null }).eq("id", d.id).eq("status", "queued");
          continue;
        }
        if (d && !d.attachment_id && d.status === "draft" && (await rereadDraft(sb, d.id, "", event.replyToken || null, attachmentId))) continue;
      }
      const { data: added, error } = await sb.from("ingestions").insert({
        company_id: group.company_id,
        template,
        department: template.department,
        confirm: mentionMode,
        raw,
        source: "LINE",
        source_event: sourceEvent,
        group_id: groupId,
        attachment_id: attachmentId,
        source_user: userId || null,
        reply_token: event.replyToken || null,
      }).select("id").maybeSingle();
      // A photo or file that follows a mention joins this draft.
      if (mentionMode && userId && added?.id) await listen(sb, group.company_id, groupId, userId, "files", added.id, LISTEN_MS);
      // Expired plan or a free trial at its ceiling: tell the group instead of failing the webhook.
      if (error && /ช่วงทดลอง/.test(error.message)) {
        await lineReply(event.replyToken, "⚠️ " + error.message);
        continue;
      }
      if (error && /แพ็กเกจหมดอายุ/.test(error.message)) {
        await lineReply(event.replyToken, "⚠️ แพ็กเกจ EliteFlow ของบริษัทหมดอายุ กรุณาให้เจ้าของบริษัทต่ออายุในเว็บ");
        continue;
      }
      if (error && error.code !== "23505") dbError(error);
    }
    after(async () => {
      // Wait a few seconds so a burst from one person (a slip, then its caption) is read as one item.
      await new Promise((ok) => setTimeout(ok, BURST_WAIT_MS));
      await processJobs();
      await processNotifications();
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Webhook processing failed; request can be retried" },
      { status: 503 },
    );
  }
}
