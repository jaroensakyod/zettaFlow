// The Workers side of D1 accounts: rate limits on sign-in / sign-up / reset (auth_rate_limits, 0005_rate_limits.sql),
// the one mail configuration (RESEND_API_KEY + MAIL_FROM, MAIL_* as fallback) and the service client's
// auth.admin.inviteUserByEmail / resetPasswordForEmail used by route.ts emailInvite. node:sqlite with every migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqlite, applyMigrations } from "../src/lib/d1/local";
import { sqliteDriver } from "../src/lib/d1/driver";
import { d1Client } from "../src/lib/d1/postgrest";
import { createD1Auth, d1AuthAdmin, d1AuthBridge, withAuthAdmin, type CookieJar } from "../src/lib/d1/auth";
import { envMailer, memoryMailer } from "../src/lib/d1/mailer";
import { clientIp, RATE_LIMITS, rateLimiter } from "../src/lib/d1/rate-limit";

const APP = "http://app.test";
function setup() {
  const db = openSqlite(":memory:");
  applyMigrations(db);
  const sql = sqliteDriver(db);
  const mail = memoryMailer();
  const auth = createD1Auth({ sql, mailer: mail, secret: "test-secret-0123456789-0123456789-abcdef", appUrl: APP });
  let clock = Date.parse("2026-11-22T10:00:00Z");
  const limiter = rateLimiter(sql, () => clock);
  const browser = (ip = "203.0.113.9") => {
    const jar = new Map<string, string>();
    const cookies: CookieJar = {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name, value, o) => (value === "" || o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    };
    const request = async () => {
      const b = d1AuthBridge({ auth, cookies, headers: new Headers({ "user-agent": "node-test", "cf-connecting-ip": ip, "x-forwarded-for": "10.0.0.1" }), limiter });
      return d1Client({ sql, user: await b.currentUser(), service: false, authProvider: b.provider });
    };
    return { jar, request };
  };
  const admin = withAuthAdmin(d1Client({ sql, user: null, service: true }), d1AuthAdmin({ auth, limiter }));
  const link = (to: string) => {
    const u = new URL(mail.last(to)!.link!);
    return { token_hash: u.searchParams.get("token_hash")!, type: u.searchParams.get("type")! };
  };
  return { sql, mail, browser, admin, link, limiter, tick: (ms: number) => (clock += ms) };
}
async function account(t: ReturnType<typeof setup>, email: string, password: string) {
  const sb = await t.browser("198.51.100.1").request();
  assert.equal((await sb.auth.signUp({ email, password, options: { data: { name: "ทดสอบ" } } })).error, null);
  assert.equal((await (await t.browser("198.51.100.1").request()).auth.verifyOtp(t.link(email))).error, null);
}

test("client IP: cf-connecting-ip first, then the first x-forwarded-for, then x-real-ip", () => {
  assert.equal(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })), "1.1.1.1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": " 2.2.2.2 , 3.3.3.3" })), "2.2.2.2");
  assert.equal(clientIp(new Headers({ "x-real-ip": "4.4.4.4" })), "4.4.4.4");
  assert.equal(clientIp(new Headers()), null);
});

test("sign-in: 5 failures per email in 15 min → 429 (even the right password), window passes → allowed; success clears", async () => {
  const t = setup();
  await account(t, "a@example.th", "right-pass-1");
  const sb = await t.browser().request();
  for (let i = 0; i < RATE_LIMITS.sign_in_failed.email; i++)
    assert.equal((await sb.auth.signInWithPassword({ email: "a@example.th", password: "wrong" })).error?.message, "Invalid login credentials");
  const blocked = await sb.auth.signInWithPassword({ email: "A@example.th", password: "right-pass-1" });
  assert.deepEqual(blocked.error, { message: "Too many requests, try again later", name: "AuthApiError", status: 429, code: "over_request_rate_limit" });
  assert.equal(blocked.data.user, null);
  // Another address from the same IP still works (per-IP limit is 20).
  await account(t, "b@example.th", "right-pass-2");
  assert.equal((await (await t.browser().request()).auth.signInWithPassword({ email: "b@example.th", password: "right-pass-2" })).error, null);
  // Rows keep no raw address or IP.
  const rows = await t.sql.all<{ subject: string }>("select subject from auth_rate_limits");
  assert.ok(rows.length && rows.every((r) => /^[0-9a-f]{64}$/.test(r.subject)));

  t.tick(15 * 60_000 + 1000);
  assert.equal((await sb.auth.signInWithPassword({ email: "a@example.th", password: "wrong" })).error?.message, "Invalid login credentials");
  assert.equal((await sb.auth.signInWithPassword({ email: "a@example.th", password: "right-pass-1" })).error, null);
  // A good sign-in cleared the email's failures: 5 more are allowed before the block.
  for (let i = 0; i < 4; i++) await sb.auth.signInWithPassword({ email: "a@example.th", password: "wrong" });
  assert.equal((await sb.auth.signInWithPassword({ email: "a@example.th", password: "wrong" })).error?.status, 400);
  assert.equal((await sb.auth.signInWithPassword({ email: "a@example.th", password: "wrong" })).error?.status, 429);
});

test("sign-in: 20 failures from one IP block every address from it; other IPs are not affected", async () => {
  const t = setup();
  await account(t, "c@example.th", "right-pass-3");
  const attacker = await t.browser("192.0.2.66").request();
  for (let i = 0; i < RATE_LIMITS.sign_in_failed.ip; i++) await attacker.auth.signInWithPassword({ email: `x${i % 4}@example.th`, password: "nope" });
  assert.equal((await attacker.auth.signInWithPassword({ email: "c@example.th", password: "right-pass-3" })).error?.status, 429);
  assert.equal((await (await t.browser("192.0.2.77").request()).auth.signInWithPassword({ email: "c@example.th", password: "right-pass-3" })).error, null);
});

test("sign-up and password reset: limited per email (3/h) and per IP (10/h); blocked calls send no email", async () => {
  const t = setup();
  const sb = await t.browser("192.0.2.10").request();
  for (let i = 0; i < 3; i++) assert.equal((await sb.auth.signUp({ email: "d@example.th", password: "pass-12345" })).error, null);
  const sent = t.mail.sent.length;
  assert.equal((await sb.auth.signUp({ email: "d@example.th", password: "pass-12345" })).error?.status, 429);
  assert.equal(t.mail.sent.length, sent);

  for (let i = 0; i < 3; i++) assert.equal((await sb.auth.resetPasswordForEmail("d@example.th")).error, null);
  assert.equal((await sb.auth.resetPasswordForEmail("d@example.th")).error?.message, "Too many requests, try again later");
  for (let i = 0; i < 7; i++) await sb.auth.resetPasswordForEmail(`r${i}@example.th`);
  assert.equal((await sb.auth.resetPasswordForEmail("fresh@example.th")).error?.status, 429); // 10 from this IP
  assert.equal((await (await t.browser("192.0.2.11").request()).auth.resetPasswordForEmail("fresh@example.th")).error, null);
  t.tick(60 * 60_000 + 1000);
  assert.equal((await sb.auth.resetPasswordForEmail("d@example.th")).error, null);
  // Old rows are dropped as new ones are written.
  t.tick(25 * 60 * 60_000);
  await t.limiter.hit("reset", "z@example.th", null);
  assert.equal((await t.sql.all<{ n: number }>("select count(*) n from auth_rate_limits"))[0].n, 1);
});

test("invitation on D1: inviteUserByEmail → invite email → link signs in → password set → sign-in works", async () => {
  const t = setup();
  const r = await t.admin.auth.admin.inviteUserByEmail("New.Staff@Example.th", { data: { name: "พนักงานใหม่" }, redirectTo: `${APP}/auth/callback` });
  assert.equal(r.error, null);
  assert.equal(r.data.user!.email, "new.staff@example.th");
  assert.equal(r.data.user!.email_confirmed_at, null);
  const [row] = await t.sql.all<{ name: string; email_verified: number }>("select name, email_verified from users where email = ?", ["new.staff@example.th"]);
  assert.deepEqual({ ...row }, { name: "พนักงานใหม่", email_verified: 0 });
  assert.equal((await t.sql.all("select * from auth_accounts where user_id = ?", [r.data.user!.id])).length, 0); // no password yet

  const m = t.mail.last("new.staff@example.th")!;
  assert.equal(m.subject, "คุณได้รับคำเชิญเข้าร่วม EliteFlow");
  assert.ok(!m.html.includes("{{") && m.html.includes(m.link!.replace(/&/g, "&amp;")));
  const l = t.link("new.staff@example.th");
  assert.equal(l.type, "invite");

  // No password: signing in fails until the link is opened and a password chosen.
  assert.equal((await (await t.browser().request()).auth.signInWithPassword({ email: "new.staff@example.th", password: "anything" })).error?.message, "Invalid login credentials");
  const b = t.browser();
  const v = await (await b.request()).auth.verifyOtp(l);
  assert.equal(v.error, null);
  assert.equal(v.data.user!.email, "new.staff@example.th");
  const sb = await b.request();
  assert.equal((await sb.auth.getUser()).data.user!.id, r.data.user!.id);
  assert.equal((await sb.auth.updateUser({ password: "chosen-pass-1" })).error, null);
  assert.equal((await (await t.browser().request()).auth.signInWithPassword({ email: "new.staff@example.th", password: "chosen-pass-1" })).error, null);
  // The link works once.
  assert.equal((await (await t.browser().request()).auth.verifyOtp(l)).error?.code, "otp_expired");

  // Inviting someone who has an account: Supabase's wording (route.ts matches /already|registered|exists/).
  const again = await t.admin.auth.admin.inviteUserByEmail("new.staff@example.th");
  assert.deepEqual([again.error?.message, again.error?.status, again.error?.code], ["A user with this email address has already been registered", 422, "email_exists"]);
  // ...so route.ts sends a set-password link with the service client instead.
  const reset = await t.admin.auth.resetPasswordForEmail("new.staff@example.th", { redirectTo: `${APP}/auth/callback?next=/reset-password` });
  assert.equal(reset.error, null);
  const rl = t.link("new.staff@example.th");
  assert.equal(rl.type, "recovery");
  assert.equal((await (await t.browser().request()).auth.verifyOtp(rl)).error, null);
  // Per address: 3 per hour, then 429.
  await t.admin.auth.resetPasswordForEmail("new.staff@example.th");
  await t.admin.auth.resetPasswordForEmail("new.staff@example.th");
  assert.equal((await t.admin.auth.resetPasswordForEmail("new.staff@example.th")).error?.status, 429);
  // An address without an account: no error, no email (like Supabase).
  const before = t.mail.sent.length;
  assert.equal((await t.admin.auth.resetPasswordForEmail("nobody@example.th")).error, null);
  assert.equal(t.mail.sent.length, before);
});

test("one mail configuration: RESEND_API_KEY + MAIL_FROM first, MAIL_PROVIDER/MAIL_API_KEY as fallback", async () => {
  const saved = { ...process.env };
  const calls: { url: string; auth: string; body: { from: string; to: string[] } }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get("authorization")!, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    for (const k of ["RESEND_API_KEY", "MAIL_FROM", "MAIL_PROVIDER", "MAIL_API_KEY", "MAIL_ENDPOINT"]) delete process.env[k];
    process.env.RESEND_API_KEY = "re_app";
    process.env.MAIL_FROM = "EliteFlow <noreply@eliteflow-ai.com>";
    process.env.MAIL_PROVIDER = "resend";
    process.env.MAIL_API_KEY = "re_old";
    await envMailer().send({ to: "a@b.co", subject: "s", html: "<p>h</p>", text: "t" });
    assert.deepEqual([calls[0].url, calls[0].auth, calls[0].body.from, calls[0].body.to], ["https://api.resend.com/emails", "Bearer re_app", "EliteFlow <noreply@eliteflow-ai.com>", ["a@b.co"]]);
    delete process.env.RESEND_API_KEY;
    await envMailer().send({ to: "a@b.co", subject: "s", html: "h", text: "t" });
    assert.equal(calls[1].auth, "Bearer re_old");
  } finally {
    globalThis.fetch = real;
    process.env = saved;
  }
});
