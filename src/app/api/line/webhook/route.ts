import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  validLineSignature,
  tokenHash,
  processJobs,
  processNotifications,
} from "@/lib/ai";
import { assert } from "@/lib/domain";
import { dbError } from "@/lib/data";
import { isQuestion, answerQuestion, lineReply, type QuickStats } from "@/lib/line";
import { decidedText, deptThai, groupRejection, parseDecision } from "@/lib/line-message";
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
      if (event.type !== "message" || !event.source?.groupId) continue;
      const message = event.message,
        groupId = event.source.groupId,
        userId = event.source.userId;
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
            : "✅ เชื่อมกลุ่มนี้กับ EliteFlow แล้ว" + (dept ? " เป็นกลุ่มของ" + dept : "") + " ส่งข้อความ รูป หรือ PDF เพื่อบันทึกข้อมูลได้เลย",
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
          ? await sb.from("ingestions").select("id, raw, status, target_kind, department").eq("id", link.ingestion_id).maybeSingle()
          : await sb.from("ingestions").select("id, raw, status, target_kind, department").eq("group_id", groupId).eq("bot_message_id", quoted).maybeSingle();
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
          if (role === "approver") {
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
      if (message.type === "text" && isQuestion(message.text)) {
        const { data: stats } = await sb.rpc("line_quick_stats", { p_group: groupId });
        if (stats) {
          await lineReply(event.replyToken, answerQuestion(message.text, stats as QuickStats));
          continue;
        }
      }
      const { data: group } = await sb
        .from("line_groups")
        .select("*")
        .eq("group_id", groupId)
        .single();
      if (!group) continue;
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
      if (["image", "file"].includes(message.type)) {
        assert(
          process.env.LINE_CHANNEL_ACCESS_TOKEN,
          "LINE access token not configured",
          503,
        );
        const response = await fetch(
          `https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id)}/content`,
          {
            signal: AbortSignal.timeout(12000),
            headers: {
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
          },
        );
        assert(response.ok, "Cannot download LINE media", 502);
        const parts: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body! as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          assert(size <= 4000000, "File too large", 413);
          parts.push(chunk);
        }
        const mime = response.headers.get("content-type")?.split(";")[0] || "";
        assert(
          ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
            mime,
          ),
          "Unsupported LINE attachment",
        );
        const bytes = Buffer.concat(parts);
        attachmentId = randomUUID();
        const path = `${group.company_id}/${template.department}/${attachmentId}`;
        const { error } = await sb.storage
          .from("eliteflow-files")
          .upload(path, bytes, { contentType: mime, upsert: false });
        dbError(error);
        const { error: e } = await sb.from("attachments").insert({
          id: attachmentId,
          company_id: group.company_id,
          department: template.department,
          name: message.fileName || `${message.id}.jpg`,
          mime,
          size,
          path,
        });
        dbError(e);
      } else if (message.type !== "text") continue;
      const { error } = await sb.from("ingestions").insert({
        company_id: group.company_id,
        template,
        department: template.department,
        raw: message.text || "",
        source: "LINE",
        source_event: sourceEvent,
        group_id: groupId,
        attachment_id: attachmentId,
        source_user: userId || null,
        reply_token: event.replyToken || null,
      });
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
