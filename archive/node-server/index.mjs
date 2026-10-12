import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.mjs";
import { createBlobs } from "./blobs.mjs";
import { extract } from "./extract.mjs";
import {
  id,
  now,
  fail,
  text,
  initialState,
  validateTemplate,
  validateValues,
  visibleState,
  canSee,
  audit,
  decide,
  verifyLine,
} from "./domain.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
export async function createApp({
  mode = process.env.AUTH_MODE || "local",
  dataFile = process.env.DATA_FILE || ".data/zettaflow.sqlite",
} = {}) {
  if (!["local", "firebase"].includes(mode))
    fail("AUTH_MODE must be local or firebase");
  if (process.env.NODE_ENV === "production" && mode !== "firebase")
    fail("Production requires Firebase Authentication");
  const store = await createStore(mode, dataFile);
  const blobs = await createBlobs(mode);
  const limits = new Map();
  let workerBusy = false;
  const cleanUser = (u) => ({
    uid: u.uid,
    email: u.email,
    name: u.name,
    tenantId: u.tenantId,
    role: u.role,
    departments: u.departments || [],
  });
  async function authenticate(req) {
    let uid;
    if (mode === "firebase") {
      try {
        uid = (
          await store.auth.verifyIdToken(
            (req.headers.authorization || "").replace(/^Bearer /, ""),
            true,
          )
        ).uid;
      } catch {
        fail("กรุณาเข้าสู่ระบบ", 401);
      }
    } else {
      const token = (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("zf_session="))
        ?.slice(11);
      const session = token ? await store.get("sessions", hash(token)) : null;
      if (!session || session.expires < Date.now())
        fail("กรุณาเข้าสู่ระบบ", 401);
      uid = session.uid;
    }
    const member = await store.get("members", uid);
    if (!member || member.disabled) fail("ยังไม่ได้รับสิทธิ์เข้าใช้งาน", 403);
    return member;
  }
  const requireOwner = (u) => {
    if (u.role !== "owner") fail("เฉพาะเจ้าของบริษัท", 403);
  };
  const writable = (u) => {
    if (u.role === "viewer") fail("บัญชีนี้ดูข้อมูลได้อย่างเดียว", 403);
  };
  async function bytes(req, max = 9_000_000) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) fail("ไฟล์หรือข้อความใหญ่เกินกำหนด", 413);
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }
  async function json(req) {
    try {
      const value = JSON.parse((await bytes(req)).toString() || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail("JSON ต้องเป็น object");
      return value;
    } catch (e) {
      if (e.status) throw e;
      fail("JSON ไม่ถูกต้อง");
    }
  }
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  const mutate = (tenant, fn) =>
    store.mutate("tenants", tenant, (s) => {
      if (!s) fail("ไม่พบบริษัท", 404);
      fn(s);
      return s;
    });
  async function enqueue(user, input, eventId) {
    writable(user);
    const state = await store.get("tenants", user.tenantId);
    const template = state.templates.find(
      (t) => t.id === input.templateId && canSee(user, t.department),
    );
    if (!template) fail("ไม่พบ Template หรือไม่มีสิทธิ์", 404);
    if (state.records.length >= 500)
      fail("MVP รองรับ 500 รายการต่อบริษัท กรุณา archive ก่อนเพิ่ม", 409);
    const raw = input.raw ? text(input.raw, 15000) : "";
    let attachment = input.attachment;
    if (attachment) {
      if (
        !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
          attachment.type,
        )
      )
        fail("รองรับ PNG, JPEG, WebP และ PDF");
      text(attachment.name, 150);
      if (
        typeof attachment.data !== "string" ||
        attachment.data.length > 7_000_000 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data)
      )
        fail("ไฟล์ไม่ถูกต้องหรือเกิน 5 MB");
      if (!process.env.OPENAI_API_KEY)
        fail("ยังไม่ได้ตั้งค่า AI สำหรับอ่านเอกสาร", 503);
      const buffer = Buffer.from(attachment.data, "base64");
      const valid =
        attachment.type === "application/pdf"
          ? buffer.subarray(0, 5).toString() === "%PDF-"
          : attachment.type === "image/png"
            ? buffer
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : attachment.type === "image/jpeg"
              ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
              : buffer.subarray(0, 4).toString() === "RIFF" &&
                buffer.subarray(8, 12).toString() === "WEBP";
      if (!valid) fail("ชนิดไฟล์ไม่ตรงกับเนื้อหา");
      const key = id();
      await blobs.put(key, buffer, attachment.type);
      attachment = { name: attachment.name, type: attachment.type, key };
    }
    if (!raw && !attachment) fail("กรอกข้อความหรือแนบเอกสาร");
    const jobId = eventId ? hash(`${user.tenantId}:${eventId}`) : id();
    await store.mutate(
      "jobs",
      jobId,
      (existing) =>
        existing || {
          id: jobId,
          tenantId: user.tenantId,
          actor: input.lineUserId ? `LINE:${input.lineUserId}` : user.uid,
          groupId: input.groupId || null,
          template,
          raw,
          attachment: attachment || null,
          source: eventId ? "LINE" : "Web",
          status: "queued",
          createdAt: now(),
        },
    );
    return { jobId };
  }
  async function work() {
    if (workerBusy) return;
    workerBusy = true;
    try {
      const jobs = (await store.list("jobs"))
        .filter(
          (j) =>
            j.status === "queued" ||
            (j.status === "processing" && j.leaseUntil < Date.now()),
        )
        .slice(0, 5);
      for (const candidate of jobs) {
        const lease = id();
        const job = await store.mutate("jobs", candidate.id, (j) => {
          if (
            j.status === "queued" ||
            (j.status === "processing" && j.leaseUntil < Date.now())
          )
            return {
              ...j,
              status: "processing",
              lease,
              leaseUntil: Date.now() + 120000,
            };
          return j;
        });
        if (job.lease !== lease) continue;
        try {
          const attachment = job.attachment
            ? {
                ...job.attachment,
                data: (await blobs.get(job.attachment.key)).toString("base64"),
              }
            : null;
          const result = await extract(job.template, job.raw, attachment);
          await mutate(job.tenantId, (s) => {
            if (!s.records.some((r) => r.id === job.id)) {
              if (s.records.length >= 500) fail("พื้นที่รายการเต็ม", 409);
              s.records.unshift({
                id: job.id,
                template: job.template,
                department: job.template.department,
                raw: job.raw,
                filename: job.attachment?.name || null,
                attachment: job.attachment,
                groupId: job.groupId,
                source: job.source,
                ...result,
                status: "review",
                createdAt: job.createdAt,
                createdBy: job.actor,
              });
              audit(s, job.actor, "ingested", job.id);
            }
          });
          await store.put("jobs", job.id, {
            ...job,
            attachment: null,
            status: "done",
            finishedAt: now(),
          });
          if (job.groupId)
            await store.put("notifications", job.id, {
              id: job.id,
              retryKey: id(),
              to: job.groupId,
              text: `ZettaFlow: รับข้อมูล ${job.template.name} แล้ว\nรายการ ${job.id}\n${result.missing.length ? "ข้อมูลที่ขาด: " + result.missing.join(", ") : "พร้อมตรวจทานและอนุมัติในเว็บ"}\nผู้มีสิทธิ์ที่เชื่อมบัญชีแล้วใช้ #approve ${job.id} ได้`,
              status: "queued",
              attempts: 0,
            });
        } catch (e) {
          await store.put("jobs", job.id, {
            ...job,
            attachment: null,
            status: "failed",
            error: e.status
              ? e.message
              : "ประมวลผลไม่สำเร็จ กรุณาส่งข้อมูลใหม่",
            finishedAt: now(),
          });
        }
      }
      if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        const notifications = (await store.list("notifications"))
          .filter(
            (n) =>
              n.status === "queued" &&
              n.attempts < 5 &&
              (!n.nextAt || n.nextAt < Date.now()),
          )
          .slice(0, 10);
        for (const n of notifications) {
          const response = await fetch(
            "https://api.line.me/v2/bot/message/push",
            {
              method: "POST",
              signal: AbortSignal.timeout(15000),
              headers: {
                Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "X-Line-Retry-Key": n.retryKey,
              },
              body: JSON.stringify({
                to: n.to,
                messages: [{ type: "text", text: n.text }],
              }),
            },
          );
          await store.put("notifications", n.id, {
            ...n,
            attempts: n.attempts + 1,
            nextAt: Date.now() + Math.pow(2, n.attempts) * 60000,
            status:
              response.ok || response.status === 409
                ? "sent"
                : n.attempts >= 4
                  ? "failed"
                  : "queued",
          });
        }
      }
    } catch (e) {
      console.error(
        "Worker error:",
        e.status ? e.message : "storage unavailable",
      );
    } finally {
      workerBusy = false;
    }
  }
  const timer = setInterval(work, 1000);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://server");
      const path = url.pathname;
      if (req.method !== "GET" && path !== "/api/line/webhook") {
        const origin = req.headers.origin;
        const expected =
          process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
        if (origin && origin !== expected) fail("Origin ไม่ถูกต้อง", 403);
      }
      if (path.startsWith("/api/")) {
        const key = req.socket.remoteAddress || "unknown",
          window = limits.get(key) || { count: 0, until: Date.now() + 60000 };
        if (window.until < Date.now()) {
          window.count = 0;
          window.until = Date.now() + 60000;
        }
        window.count++;
        limits.set(key, window);
        if (limits.size > 10000)
          for (const [k, v] of limits)
            if (v.until < Date.now()) limits.delete(k);
        if (window.count > 180) fail("คำขอมากเกินไป กรุณารอสักครู่", 429);
      }
      if (path === "/api/config" && req.method === "GET")
        return send(res, 200, {
          authMode: mode,
          firebaseApiKey: process.env.FIREBASE_WEB_API_KEY || "",
          aiReady: !!process.env.OPENAI_API_KEY,
          lineReady: !!process.env.LINE_CHANNEL_SECRET,
          maxUploadBytes: 5000000,
        });
      if (path === "/api/health" && req.method === "GET")
        return send(res, 200, { ok: true });
      if (path === "/api/auth" && req.method === "POST") {
        const input = await json(req);
        let uid, email, name;
        if (mode === "firebase") {
          const decoded = await store.auth.verifyIdToken(
            text(input.token, 5000),
            true,
          );
          if (!decoded.email_verified) fail("ยืนยันอีเมลก่อนเข้าใช้งาน", 403);
          uid = decoded.uid;
          email = decoded.email;
          name = input.name || email;
        } else {
          email = text(input.email).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            fail("อีเมลไม่ถูกต้อง");
          const password = text(input.password, 200);
          const accountKey = hash(email);
          let account = await store.get("accounts", accountKey);
          if (input.register) {
            if (account) fail("อีเมลนี้มีบัญชีแล้ว", 409);
            if (password.length < 10) fail("รหัสผ่านอย่างน้อย 10 ตัวอักษร");
            const salt = randomBytes(16).toString("hex");
            account = {
              uid: id(),
              email,
              name: text(input.name),
              salt,
              password: scryptSync(password, salt, 64).toString("hex"),
            };
            await store.mutate("accounts", accountKey, (a) => {
              if (a) fail("อีเมลนี้มีบัญชีแล้ว", 409);
              return account;
            });
          } else if (
            !account ||
            !timingSafeEqual(
              Buffer.from(account.password, "hex"),
              scryptSync(password, account.salt, 64),
            )
          )
            fail("อีเมลหรือรหัสผ่านไม่ถูกต้อง", 401);
          ({ uid, email, name } = account);
        }
        let member = await store.get("members", uid);
        if (!member) {
          const invite = await store.get("invites", hash(email));
          const tenantId =
            invite?.expires > Date.now() ? invite.tenantId : id();
          member = {
            uid,
            email,
            name: text(name),
            tenantId,
            role: invite?.expires > Date.now() ? invite.role : "owner",
            departments: invite?.departments || [],
          };
          if (member.role === "owner")
            await store.mutate(
              "tenants",
              tenantId,
              (s) => s || initialState(text(input.company || "บริษัทของฉัน")),
            );
          member = await store.mutate("members", uid, (m) => m || member);
        }
        if (member.disabled) fail("บัญชีถูกระงับ", 403);
        const headers = {};
        if (mode === "local") {
          const token = randomBytes(32).toString("hex");
          await store.put("sessions", hash(token), {
            uid,
            expires: Date.now() + 12 * 3600000,
          });
          headers["Set-Cookie"] =
            `zf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`;
        }
        return send(res, 200, cleanUser(member), headers);
      }
      if (path === "/api/logout" && req.method === "POST") {
        const token = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("zf_session="))
          ?.slice(11);
        if (token)
          await store.put("sessions", hash(token), { uid: "", expires: 0 });
        return send(
          res,
          200,
          { ok: true },
          {
            "Set-Cookie":
              "zf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        );
      }
      if (path === "/api/line/webhook" && req.method === "POST") {
        const raw = await bytes(req);
        if (
          !verifyLine(
            raw,
            req.headers["x-line-signature"],
            process.env.LINE_CHANNEL_SECRET,
          )
        )
          fail("Invalid LINE signature", 401);
        const body = JSON.parse(raw);
        if (!Array.isArray(body.events) || body.events.length > 100)
          fail("Invalid events");
        for (const event of body.events) {
          if (event.type !== "message" || !event.source?.groupId) continue;
          const groupId = event.source.groupId;
          const message = event.message;
          if (message.type === "text" && message.text.startsWith("#connect ")) {
            const token = message.text.slice(9).trim();
            const pairing = await store.get("pairings", hash(token));
            if (pairing?.expires > Date.now()) {
              await store.mutate("groups", hash(groupId), (g) => {
                if (g && g.tenantId !== pairing.tenantId)
                  fail("Group already connected", 409);
                return { groupId, ...pairing, expires: null };
              });
              await store.put("pairings", hash(token), {
                ...pairing,
                expires: 0,
              });
            }
            continue;
          }
          const group = await store.get("groups", hash(groupId));
          if (!group) continue;
          if (message.type === "text" && message.text.startsWith("#user ")) {
            const link = await store.get(
              "line_links",
              hash(message.text.slice(6).trim()),
            );
            if (
              link?.expires > Date.now() &&
              link.tenantId === group.tenantId &&
              event.source.userId
            ) {
              await store.mutate(
                "line_users",
                hash(`${group.tenantId}:${event.source.userId}`),
                (existing) => {
                  if (existing && existing.uid !== link.uid)
                    fail("LINE account already linked", 409);
                  return { uid: link.uid, tenantId: link.tenantId };
                },
              );
              await store.put(
                "line_links",
                hash(message.text.slice(6).trim()),
                { ...link, expires: 0 },
              );
            }
            continue;
          }
          if (message.type === "text" && message.text.startsWith("#approve ")) {
            const mapping = await store.get(
              "line_users",
              hash(`${group.tenantId}:${event.source.userId}`),
            );
            const member = mapping
              ? await store.get("members", mapping.uid)
              : null;
            if (
              !member ||
              member.disabled ||
              member.tenantId !== group.tenantId ||
              !["owner", "manager"].includes(member.role)
            )
              continue;
            const recordId = message.text.slice(9).trim();
            await mutate(group.tenantId, (s) => {
              const r = s.records.find(
                (r) => r.id === recordId && r.groupId === groupId,
              );
              if (!r || r.status !== "review") return;
              // Approval is an explicit command from a linked authorized user, never an AI inference.
              decide(s, member, r.id, { status: "approved", values: r.values });
            });
            continue;
          }
          const owner = await store.get("members", group.ownerUid);
          if (!owner || owner.disabled) continue;
          if (
            await store.get(
              "jobs",
              hash(`${group.tenantId}:${event.webhookEventId || message.id}`),
            )
          )
            continue;
          let attachment = null;
          if (["image", "file"].includes(message.type)) {
            if (!process.env.LINE_CHANNEL_ACCESS_TOKEN)
              fail("LINE access token not configured", 503);
            const response = await fetch(
              `https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id)}/content`,
              {
                headers: {
                  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                },
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!response.ok) fail("LINE content unavailable", 502);
            if (Number(response.headers.get("content-length")) > 5000000)
              fail("ไฟล์เกิน 5 MB", 413);
            const chunks = [];
            let total = 0;
            for await (const chunk of response.body) {
              total += chunk.length;
              if (total > 5000000) fail("ไฟล์เกิน 5 MB", 413);
              chunks.push(chunk);
            }
            attachment = {
              name: message.fileName || `${message.id}.jpg`,
              type: response.headers.get("content-type")?.split(";")[0],
              data: Buffer.concat(chunks).toString("base64"),
            };
          } else if (message.type !== "text") continue;
          await enqueue(
            owner,
            {
              templateId: group.templateId,
              raw: message.text || "",
              attachment,
              groupId,
              lineUserId: event.source.userId,
            },
            event.webhookEventId || message.id,
          );
        }
        return send(res, 200, { ok: true });
      }
      if (path.startsWith("/api/")) {
        const user = await authenticate(req);
        if (path === "/api/state" && req.method === "GET") {
          const state = visibleState(
            await store.get("tenants", user.tenantId),
            user,
          );
          return send(res, 200, { user: cleanUser(user), ...state });
        }
        if (path === "/api/templates" && req.method === "POST") {
          requireOwner(user);
          const input = await json(req);
          const template = {
            ...validateTemplate(input),
            id: id(),
            createdAt: now(),
          };
          await mutate(user.tenantId, (s) => {
            if (s.templates.length >= 30) fail("Template เต็ม", 409);
            s.templates.push(template);
            audit(s, user.uid, "template_created", template.id);
          });
          return send(res, 201, template);
        }
        if (path.startsWith("/api/templates/") && req.method === "PATCH") {
          requireOwner(user);
          const input = validateTemplate(await json(req));
          const templateId = path.split("/").pop();
          await mutate(user.tenantId, (s) => {
            const t = s.templates.find((t) => t.id === templateId);
            if (!t) fail("ไม่พบ Template", 404);
            Object.assign(t, input, { updatedAt: now() });
            audit(s, user.uid, "template_updated", t.id);
          });
          return send(res, 200, { ok: true });
        }
        if (path === "/api/ingest" && req.method === "POST") {
          const input = await json(req);
          return send(
            res,
            202,
            await enqueue(user, {
              templateId: input.templateId,
              raw: input.raw,
              attachment: input.attachment,
            }),
          );
        }
        if (path.startsWith("/api/jobs/") && req.method === "GET") {
          const j = await store.get("jobs", path.split("/").pop());
          if (
            !j ||
            j.tenantId !== user.tenantId ||
            !canSee(user, j.template.department)
          )
            fail("ไม่พบรายการ", 404);
          return send(res, 200, { id: j.id, status: j.status, error: j.error });
        }
        if (path.startsWith("/api/records/") && req.method === "PATCH") {
          const input = await json(req);
          if (input.dueAt)
            validateValues(
              {
                fields: [{ key: "dueAt", label: "วันครบกำหนด", type: "date" }],
              },
              input,
            );
          await mutate(user.tenantId, (s) =>
            decide(s, user, path.split("/").pop(), input),
          );
          return send(res, 200, { ok: true });
        }
        if (path.startsWith("/api/files/") && req.method === "GET") {
          const state = await store.get("tenants", user.tenantId),
            r = state.records.find((r) => r.id === path.split("/").pop());
          if (!r || !canSee(user, r.department) || !r.attachment)
            fail("ไม่พบเอกสาร", 404);
          const bytes = await blobs.get(r.attachment.key);
          res.writeHead(200, {
            "Content-Type": r.attachment.type,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(r.attachment.name)}`,
            "Cache-Control": "no-store",
          });
          return res.end(bytes);
        }
        if (path.startsWith("/api/tasks/") && req.method === "PATCH") {
          writable(user);
          const input = await json(req);
          await mutate(user.tenantId, (s) => {
            const t = s.tasks.find((t) => t.id === path.split("/").pop());
            if (!t || !canSee(user, t.department)) fail("ไม่พบงาน", 404);
            if (
              !["pending", "progress", "review", "done"].includes(input.status)
            )
              fail("สถานะไม่ถูกต้อง");
            if (t.status === "done") fail("งานนี้ปิดแล้ว", 409);
            t.status = input.status;
            t.updatedAt = now();
            audit(s, user.uid, `task_${input.status}`, t.id);
          });
          return send(res, 200, { ok: true });
        }
        if (path === "/api/team" && req.method === "GET") {
          requireOwner(user);
          return send(
            res,
            200,
            (await store.list("members"))
              .filter((m) => m.tenantId === user.tenantId)
              .map((m) => ({ ...cleanUser(m), disabled: !!m.disabled })),
          );
        }
        if (path === "/api/invites" && req.method === "POST") {
          requireOwner(user);
          const input = await json(req);
          const email = text(input.email).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            fail("อีเมลไม่ถูกต้อง");
          if (!["manager", "staff", "viewer"].includes(input.role))
            fail("บทบาทไม่ถูกต้อง");
          if (
            !Array.isArray(input.departments) ||
            !input.departments.length ||
            input.departments.length > 20
          )
            fail("เลือกแผนกอย่างน้อยหนึ่งแผนก");
          const departments = input.departments.map((d) => text(d));
          if ((await store.list("members")).some((m) => m.email === email))
            fail("บัญชีนี้เป็นสมาชิกอยู่แล้ว กรุณาใช้บัญชีใหม่", 409);
          await store.mutate("invites", hash(email), (i) => {
            if (i && i.expires > Date.now() && i.tenantId !== user.tenantId)
              fail("มีคำเชิญจากบริษัทอื่น", 409);
            return {
              email,
              tenantId: user.tenantId,
              role: input.role,
              departments,
              expires: Date.now() + 7 * 86400000,
            };
          });
          await mutate(user.tenantId, (s) =>
            audit(s, user.uid, "invited", email),
          );
          return send(res, 201, { ok: true });
        }
        if (path.startsWith("/api/team/") && req.method === "PATCH") {
          requireOwner(user);
          const input = await json(req);
          const uid = path.split("/").pop();
          if (
            input.role &&
            !["manager", "staff", "viewer"].includes(input.role)
          )
            fail("บทบาทไม่ถูกต้อง");
          if (
            input.departments &&
            (!Array.isArray(input.departments) ||
              !input.departments.length ||
              input.departments.length > 20)
          )
            fail("แผนกไม่ถูกต้อง");
          await store.mutate("members", uid, (m) => {
            if (!m || m.tenantId !== user.tenantId) fail("ไม่พบสมาชิก", 404);
            if (m.role === "owner") fail("เปลี่ยนสิทธิ์เจ้าของไม่ได้");
            return {
              ...m,
              ...(input.role ? { role: input.role } : {}),
              ...(input.departments
                ? { departments: input.departments.map((d) => text(d)) }
                : {}),
              ...(typeof input.disabled === "boolean"
                ? { disabled: input.disabled }
                : {}),
            };
          });
          await mutate(user.tenantId, (s) =>
            audit(
              s,
              user.uid,
              input.disabled ? "member_disabled" : "member_enabled",
              uid,
            ),
          );
          return send(res, 200, { ok: true });
        }
        if (path === "/api/line/pair" && req.method === "POST") {
          requireOwner(user);
          if (!process.env.LINE_CHANNEL_SECRET)
            fail("ตั้งค่า LINE secret บน server ก่อน", 503);
          const input = await json(req);
          const state = await store.get("tenants", user.tenantId);
          if (!state.templates.some((t) => t.id === input.templateId))
            fail("ไม่พบ Template");
          const token = randomBytes(24).toString("hex");
          await store.put("pairings", hash(token), {
            tenantId: user.tenantId,
            ownerUid: user.uid,
            templateId: input.templateId,
            expires: Date.now() + 600000,
          });
          return send(res, 201, {
            command: `#connect ${token}`,
            expiresIn: 600,
          });
        }
        if (path === "/api/line/link-user" && req.method === "POST") {
          writable(user);
          if (!process.env.LINE_CHANNEL_SECRET)
            fail("LINE ยังไม่ได้ตั้งค่า", 503);
          const token = randomBytes(24).toString("hex");
          await store.put("line_links", hash(token), {
            tenantId: user.tenantId,
            uid: user.uid,
            expires: Date.now() + 600000,
          });
          return send(res, 201, { command: `#user ${token}`, expiresIn: 600 });
        }
        if (path === "/api/line/groups" && req.method === "GET") {
          requireOwner(user);
          return send(
            res,
            200,
            (await store.list("groups"))
              .filter((g) => g.tenantId === user.tenantId)
              .map((g) => ({ groupId: g.groupId, templateId: g.templateId })),
          );
        }
        if (path === "/api/export" && req.method === "GET") {
          const s = visibleState(
            await store.get("tenants", user.tenantId),
            user,
          );
          const safe = (v) =>
            `"${String(v ?? "")
              .replace(/^[=+@\-\t\r]/, "'$&")
              .replace(/"/g, '""')}"`;
          const rows = [
            ["id", "template", "department", "status", "createdAt", "values"],
            ...s.records.map((r) => [
              r.id,
              r.template.name,
              r.department,
              r.status,
              r.createdAt,
              JSON.stringify(r.values),
            ]),
          ];
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="zettaflow.csv"',
            "Cache-Control": "no-store",
          });
          return res.end(
            "\ufeff" + rows.map((r) => r.map(safe).join(",")).join("\r\n"),
          );
        }
        fail("ไม่พบ API", 404);
      }
      if (req.method !== "GET") fail("Method not allowed", 405);
      const files = {
        "/": "index.html",
        "/index.html": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      if (!files[path]) fail("ไม่พบหน้า", 404);
      const file = files[path];
      const content = await readFile(resolve(publicRoot, file));
      res.writeHead(200, {
        "Content-Type":
          { html: "text/html", js: "text/javascript", css: "text/css" }[
            extname(file).slice(1)
          ] + "; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(content);
    } catch (e) {
      send(res, e.status || 500, {
        error: e.status ? e.message : "ระบบไม่พร้อม กรุณาลองใหม่",
      });
    }
  });
  return {
    server,
    store,
    work,
    close: async () => {
      clearInterval(timer);
      await new Promise((r) => server.close(r));
      store.close();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const mode = process.env.AUTH_MODE || "local";
  const host = mode === "local" ? "127.0.0.1" : process.env.HOST || "0.0.0.0";
  app.server.listen(Number(process.env.PORT) || 3000, host, () =>
    console.log(
      `ZettaFlow AI: http://${host}:${app.server.address().port} (${mode})`,
    ),
  );
}
