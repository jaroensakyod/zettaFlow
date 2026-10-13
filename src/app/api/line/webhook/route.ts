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
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
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
        await lineReply(
          event.replyToken,
          error
            ? "เชื่อมกลุ่มไม่สำเร็จ: " + error.message
            : "✅ เชื่อมกลุ่มนี้กับ ZettaFlow แล้ว ส่งข้อความ รูป หรือ PDF เพื่อบันทึกข้อมูลได้เลย",
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
          error ? "ผูกบัญชีไม่สำเร็จ: " + error.message : "✅ ผูกบัญชี LINE กับผู้ใช้ ZettaFlow แล้ว",
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
              : `✅ อนุมัติรายการ ${String(approved).slice(0, 8)} แล้ว ระบบแจ้งงานต่อให้ทีมที่เกี่ยวข้อง`,
          );
          continue;
        }
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
      const { data: template } = await sb
        .from("data_templates")
        .select("*")
        .eq("id", group.template_id)
        .eq("company_id", group.company_id)
        .single();
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
      if (error && /แพ็กเกจหมดอายุ/.test(error.message)) {
        await lineReply(event.replyToken, "⚠️ แพ็กเกจ ZettaFlow ของบริษัทหมดอายุ กรุณาให้เจ้าของบริษัทต่ออายุในเว็บ");
        continue;
      }
      if (error && error.code !== "23505") dbError(error);
    }
    after(async () => {
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
