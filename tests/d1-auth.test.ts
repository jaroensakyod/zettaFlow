// Real accounts on D1 (src/lib/d1/auth.ts): Better Auth behind the supabase-js auth calls the app makes
// (src/app/api/[...path]/route.ts login/register/reset/verify/password/logout, /auth/callback, data.ts getContext).
// node:sqlite with every cloudflare/d1 migration; each "request" builds a fresh D1 client from one browser's cookies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { openSqlite, applyMigrations } from "../src/lib/d1/local";
import { sqliteDriver } from "../src/lib/d1/driver";
import { d1Client } from "../src/lib/d1/postgrest";
import { createD1Auth, d1AuthBridge, type CookieJar } from "../src/lib/d1/auth";
import { devMailer, mailFile, memoryMailer, resendMailer } from "../src/lib/d1/mailer";
import { convertSupabaseUsers, supabaseUsersToSql } from "../scripts/import-supabase-users";

const APP = "http://app.test";
function setup() {
  const db = openSqlite(":memory:");
  applyMigrations(db);
  const sql = sqliteDriver(db);
  const mail = memoryMailer();
  const auth = createD1Auth({ sql, mailer: mail, secret: "test-secret-0123456789-0123456789-abcdef", appUrl: APP });
  /** A browser: its cookie jar, and a D1 client per request (like supabaseServer() in a route handler). */
  const browser = () => {
    const jar = new Map<string, string>();
    const cookies: CookieJar = {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name, value, o) => (value === "" || o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    };
    const request = async () => {
      const b = d1AuthBridge({ auth, cookies, headers: new Headers({ "user-agent": "node-test", "x-forwarded-for": "203.0.113.9" }) });
      return d1Client({ sql, user: await b.currentUser(), service: false, authProvider: b.provider });
    };
    return { jar, request };
  };
  const admin = d1Client({ sql, user: null, service: true });
  /** The link of the last email to `to`: { token_hash, type }. */
  const link = (to: string) => {
    const m = mail.last(to);
    assert.ok(m?.link, `no email to ${to}`);
    const u = new URL(m.link);
    assert.equal(u.origin + u.pathname, `${APP}/auth/confirm`);
    return { token_hash: u.searchParams.get("token_hash")!, type: u.searchParams.get("type")! };
  };
  return { db, sql, auth, mail, browser, admin, link };
}
const signedUp = async (t: ReturnType<typeof setup>, email: string, password: string, name: string) => {
  const sb = await t.browser().request();
  const r = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${APP}/auth/callback` } });
  assert.equal(r.error, null);
  const c = t.link(email);
  const v = await (await t.browser().request()).auth.verifyOtp(c);
  assert.equal(v.error, null);
  return r.data.user!;
};

test("sign-up → not signed in, confirmation email → verifyOtp signs in → getUser has the name", async () => {
  const t = setup();
  const b = t.browser();
  const sb = await b.request();
  const r = await sb.auth.signUp({ email: "Somchai@Example.th", password: "secret-123", options: { data: { name: "สมชาย" } } });
  assert.equal(r.error, null);
  assert.equal(r.data.session, null); // route.ts answers { verify: true }
  assert.match(r.data.user!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(r.data.user!.email, "somchai@example.th");
  assert.equal(r.data.user!.email_confirmed_at, null);
  assert.equal((await sb.auth.getUser()).error?.message, "Auth session missing!");
  assert.equal((await (await b.request()).auth.getUser()).data.user, null);

  // One users table: Better Auth wrote our row (uuid id, name), not a table of its own.
  const [row] = await t.sql.all<{ id: string; name: string; email_verified: number }>("select id, name, email_verified from users where email = ?", ["somchai@example.th"]);
  assert.deepEqual({ ...row }, { id: r.data.user!.id, name: "สมชาย", email_verified: 0 });

  // The email: the app's Thai template, its button on /auth/confirm?token_hash=…&type=signup.
  const m = t.mail.last("somchai@example.th")!;
  assert.equal(m.subject, "ยืนยันอีเมลเพื่อเริ่มใช้ EliteFlow");
  assert.ok(m.html.includes("somchai@example.th") && m.html.includes(m.link!.replace(/&/g, "&amp;")));
  assert.ok(!m.html.includes("{{"));
  const c = t.link("somchai@example.th");
  assert.equal(c.type, "signup");
  assert.ok(c.token_hash.length >= 10 && c.token_hash.length <= 500); // route.ts verify accepts 10..500

  // Before confirming, the right password answers "Email not confirmed".
  const early = await (await b.request()).auth.signInWithPassword({ email: "somchai@example.th", password: "secret-123" });
  assert.equal(early.error?.message, "Email not confirmed");
  assert.equal(early.error?.code, "email_not_confirmed");

  // /auth/confirm → POST /api/auth { action: "verify" } → verifyOtp, then rpc("accept_invitations") as that person.
  const sb2 = await b.request();
  const v = await sb2.auth.verifyOtp(c);
  assert.equal(v.error, null);
  assert.equal(v.data.user!.id, r.data.user!.id);
  assert.ok(v.data.session);
  assert.equal((await sb2.rpc("accept_invitations")).error, null);
  assert.ok([...b.jar.keys()].some((k) => k.endsWith("session_token")), "session cookie set");

  // The next request is signed in: getContext's getUser → id, email, user_metadata.name.
  const { data, error } = await (await b.request()).auth.getUser();
  assert.equal(error, null);
  assert.equal(data.user!.id, r.data.user!.id);
  assert.equal(data.user!.email, "somchai@example.th");
  assert.equal(data.user!.user_metadata.name, "สมชาย");
  assert.ok(data.user!.email_confirmed_at);
  const claims = await (await b.request()).auth.getClaims();
  assert.equal(claims.data!.claims.sub, r.data.user!.id);

  // The link works once (Supabase: otp_expired).
  const again = await (await t.browser().request()).auth.verifyOtp(c);
  assert.equal(again.error?.code, "otp_expired");
  // A made-up token.
  assert.equal((await (await t.browser().request()).auth.verifyOtp({ token_hash: "x".repeat(40), type: "signup" })).error?.code, "otp_expired");
});

test("sign-in: wrong password / unknown email → Invalid login credentials; right password signs in", async () => {
  const t = setup();
  await signedUp(t, "a@x.th", "right-pass", "เอ");
  const b = t.browser();
  for (const [email, password] of [
    ["a@x.th", "wrong-pass"],
    ["nobody@x.th", "right-pass"],
  ]) {
    const r = await (await b.request()).auth.signInWithPassword({ email, password });
    assert.equal(r.error?.message, "Invalid login credentials");
    assert.equal(r.error?.code, "invalid_credentials");
    assert.equal(r.data.user, null);
  }
  assert.equal([...b.jar.keys()].length, 0);
  const sb = await b.request();
  const ok = await sb.auth.signInWithPassword({ email: "A@x.th", password: "right-pass" });
  assert.equal(ok.error, null);
  // The same client now acts as that person (route.ts goes on in the same request).
  assert.equal((await sb.auth.getUser()).data.user!.email, "a@x.th");
  assert.equal((await (await b.request()).auth.getUser()).data.user!.user_metadata.name, "เอ");
});

test("signing up again with an unconfirmed address sends the confirmation again; a confirmed one gets no account", async () => {
  const t = setup();
  const sb = await t.browser().request();
  await sb.auth.signUp({ email: "again@x.th", password: "pass-1234", options: { data: { name: "ซ้ำ" } } });
  assert.equal(t.mail.sent.length, 1);
  const r = await sb.auth.signUp({ email: "again@x.th", password: "other-pass", options: { data: { name: "ซ้ำ" } } });
  assert.equal(r.error, null);
  assert.equal(r.data.session, null);
  assert.equal(t.mail.sent.length, 2);
  assert.equal((await (await t.browser().request()).auth.verifyOtp(t.link("again@x.th"))).error, null);
  const n = (await t.sql.all<{ n: number }>("select count(*) n from users where email = 'again@x.th'"))[0].n;
  assert.equal(n, 1);
  // Short password (Supabase's weak_password).
  const weak = await sb.auth.signUp({ email: "weak@x.th", password: "123", options: { data: { name: "x" } } });
  assert.equal(weak.error?.code, "weak_password");
});

test("password reset: recovery link signs in → updateUser({ password }) → sign in with the new password", async () => {
  const t = setup();
  const me = await signedUp(t, "reset@x.th", "old-pass-1", "รีเซ็ต");
  const sb = await t.browser().request();
  const r = await sb.auth.resetPasswordForEmail("reset@x.th", { redirectTo: `${APP}/auth/callback?next=/reset-password` });
  assert.equal(r.error, null);
  // Unknown addresses answer the same (no account enumeration) and send nothing.
  const before = t.mail.sent.length;
  assert.equal((await sb.auth.resetPasswordForEmail("ghost@x.th")).error, null);
  assert.equal(t.mail.sent.length, before);

  const m = t.mail.last("reset@x.th")!;
  assert.equal(m.subject, "ตั้งรหัสผ่านใหม่ – EliteFlow");
  const c = t.link("reset@x.th");
  assert.equal(c.type, "recovery");

  // updateUser without a session fails.
  const anon = await t.browser().request();
  assert.equal((await anon.auth.updateUser({ password: "nope-nope" })).error?.message, "Auth session missing!");

  const b = t.browser();
  const v = await (await b.request()).auth.verifyOtp(c);
  assert.equal(v.error, null);
  assert.equal(v.data.user!.id, me.id);
  // /reset-password → POST /api/auth { action: "password" } in the next request.
  const u = await (await b.request()).auth.updateUser({ password: "new-pass-2" });
  assert.equal(u.error, null);
  assert.equal(u.data.user!.id, me.id);
  // Too short.
  assert.equal((await (await b.request()).auth.updateUser({ password: "123" })).error?.code, "weak_password");
  // The recovery link is used up.
  assert.equal((await (await t.browser().request()).auth.verifyOtp(c)).error?.code, "otp_expired");

  const fresh = t.browser();
  assert.equal((await (await fresh.request()).auth.signInWithPassword({ email: "reset@x.th", password: "old-pass-1" })).error?.message, "Invalid login credentials");
  assert.equal((await (await fresh.request()).auth.signInWithPassword({ email: "reset@x.th", password: "new-pass-2" })).error, null);
  assert.equal((await (await fresh.request()).auth.getUser()).data.user!.id, me.id);
});

test("a recovery link also confirms an address that was never confirmed (like Supabase)", async () => {
  const t = setup();
  await (await t.browser().request()).auth.signUp({ email: "late@x.th", password: "pass-1234", options: { data: { name: "ช้า" } } });
  await (await t.browser().request()).auth.resetPasswordForEmail("late@x.th");
  const b = t.browser();
  assert.equal((await (await b.request()).auth.verifyOtp(t.link("late@x.th"))).error, null);
  assert.ok((await (await b.request()).auth.getUser()).data.user!.email_confirmed_at);
  assert.equal((await (await t.browser().request()).auth.signInWithPassword({ email: "late@x.th", password: "pass-1234" })).error, null);
});

test("sign-out ends the session: cookies cleared, the old cookie no longer works", async () => {
  const t = setup();
  await signedUp(t, "out@x.th", "pass-out-1", "ออก");
  const b = t.browser();
  assert.equal((await (await b.request()).auth.signInWithPassword({ email: "out@x.th", password: "pass-out-1" })).error, null);
  const stolen = new Map(b.jar);
  const sb = await b.request();
  assert.equal((await sb.auth.signOut({ scope: "local" })).error, null);
  assert.equal((await sb.auth.getUser()).data.user, null);
  assert.equal([...b.jar.keys()].filter((k) => k.endsWith("session_token")).length, 0);
  assert.equal((await (await b.request()).auth.getUser()).data.user, null);
  // A copy of the old cookie is refused too (the session row is gone).
  const other = t.browser();
  for (const [k, v] of stolen) other.jar.set(k, v);
  assert.equal((await (await other.request()).auth.getUser()).data.user, null);
  // Signing out with no session is fine.
  assert.equal((await (await t.browser().request()).auth.signOut()).error, null);
});

test("/auth/callback?code=: exchangeCodeForSession takes the confirmation token", async () => {
  const t = setup();
  await (await t.browser().request()).auth.signUp({ email: "cb@x.th", password: "pass-cb-1", options: { data: { name: "ซีบี" } } });
  const b = t.browser();
  const sb = await b.request();
  const r = await sb.auth.exchangeCodeForSession(t.link("cb@x.th").token_hash);
  assert.equal(r.error, null);
  assert.equal((await sb.rpc("accept_invitations")).error, null);
  assert.equal((await (await b.request()).auth.getUser()).data.user!.email, "cb@x.th");
  assert.ok((await (await t.browser().request()).auth.exchangeCodeForSession("not-a-code")).error);
});

test("people imported from Supabase keep their id and bcrypt password (re-hashed on the first sign-in)", async () => {
  const t = setup();
  const id = "5a0e7a1c-1111-4222-8333-444455556666";
  const hash = bcrypt.hashSync("supabase-pass", 4); // a stand-in for Supabase's $2a$10$ hashes
  assert.ok(hash.startsWith("$2"));
  const exported = [
    { id, email: "Old@Customer.th", encrypted_password: hash, email_confirmed_at: "2025-03-01 10:00:00.123+00", raw_user_meta_data: { name: "ลูกค้าเก่า" }, created_at: "2025-03-01 09:59:00+00", last_sign_in_at: "2026-10-01 08:00:00+00" },
    { id: "6b0e7a1c-1111-4222-8333-444455556666", email: "invited@customer.th", encrypted_password: "", email_confirmed_at: null, raw_user_meta_data: "{}", created_at: "2025-04-01T00:00:00Z", last_sign_in_at: null },
    { id: "not-a-uuid", email: "bad@customer.th" },
  ];
  const conv = convertSupabaseUsers(exported);
  assert.equal(conv.users.length, 2);
  assert.equal(conv.accounts.length, 1);
  assert.deepEqual(conv.skipped, [{ id: "not-a-uuid", reason: "id is not a uuid" }]);
  assert.equal(conv.users[0].created_at, "2025-03-01T09:59:00.000Z");
  assert.equal(conv.users[1].name, "invited");
  const sqlText = supabaseUsersToSql(exported);
  t.db.exec(sqlText);
  t.db.exec(sqlText); // re-run: nothing changes, no error
  assert.equal((await t.sql.all<{ n: number }>("select count(*) n from users"))[0].n, 2);

  const listed = await t.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const old = listed.data.users.find((u) => u.id === id)!;
  assert.equal(old.last_sign_in_at, "2026-10-01T08:00:00.000Z");
  assert.ok(old.email_confirmed_at);
  assert.equal(listed.data.users.find((u) => u.email === "invited@customer.th")!.email_confirmed_at, null);

  const b = t.browser();
  assert.equal((await (await b.request()).auth.signInWithPassword({ email: "old@customer.th", password: "wrong" })).error?.message, "Invalid login credentials");
  const r = await (await b.request()).auth.signInWithPassword({ email: "old@customer.th", password: "supabase-pass" });
  assert.equal(r.error, null);
  assert.equal(r.data.user!.id, id);
  assert.equal(r.data.user!.user_metadata.name, "ลูกค้าเก่า");
  const [acc] = await t.sql.all<{ password: string }>("select password from auth_accounts where user_id = ?", [id]);
  assert.ok(!acc.password.startsWith("$2"), "re-hashed with Better Auth's scrypt");
  assert.equal((await (await t.browser().request()).auth.signInWithPassword({ email: "old@customer.th", password: "supabase-pass" })).error, null);
  // last_sign_in_at follows the sessions.
  const after = (await t.admin.auth.admin.listUsers()).data.users.find((u) => u.id === id)!;
  assert.ok(after.last_sign_in_at! > "2026-10-01T08:00:00.000Z");

  // Imported without a password: "forgot password" gives them one.
  await (await t.browser().request()).auth.resetPasswordForEmail("invited@customer.th");
  const ib = t.browser();
  assert.equal((await (await ib.request()).auth.verifyOtp(t.link("invited@customer.th"))).error, null);
  assert.equal((await (await ib.request()).auth.updateUser({ password: "first-pass-1" })).error, null);
  assert.equal((await (await t.browser().request()).auth.signInWithPassword({ email: "invited@customer.th", password: "first-pass-1" })).error, null);
});

test("getContext after sign-in: create_company through rpc → memberships as owner; admin.listUsers has last_sign_in_at", async () => {
  const t = setup();
  const me = await signedUp(t, "boss@x.th", "boss-pass-1", "เจ้านาย");
  const b = t.browser();
  assert.equal((await (await b.request()).auth.signInWithPassword({ email: "boss@x.th", password: "boss-pass-1" })).error, null);
  // POST /api/onboarding
  const sb = await b.request();
  const { data: user } = await sb.auth.getUser();
  assert.equal(user.user!.id, me.id);
  const { data: companyId, error } = await sb.rpc("create_company", { p_name: "บริษัท ทดสอบ" });
  assert.equal(error, null);
  assert.equal(typeof companyId, "string");
  // data.ts getContext in the next request.
  const sb2 = await b.request();
  const {
    data: { user: u },
  } = await sb2.auth.getUser();
  assert.equal((await sb2.rpc("accept_invitations")).error, null);
  const { data: members, error: e1 } = await sb2.from("memberships").select("*").eq("user_id", u!.id).eq("disabled", false);
  assert.equal(e1, null);
  assert.equal(members!.length, 1);
  assert.equal((members as { role: string; company_id: string }[])[0].role, "owner");
  assert.equal((members as { role: string; company_id: string }[])[0].company_id, companyId);
  const { data: company } = await sb2.from("companies").select("*").eq("id", companyId as string).single();
  assert.equal((company as { name: string }).name, "บริษัท ทดสอบ");

  const listed = await t.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const row = listed.data.users.find((x) => x.id === me.id)!;
  assert.ok(row.last_sign_in_at);
  assert.equal(row.user_metadata.name, "เจ้านาย");
  // The user client may not list users.
  assert.equal((await sb2.auth.admin.listUsers()).error?.status, 403);
});

test("mailers: dev writes .data/mail/<email>.json; the Resend provider posts JSON with the key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d1-mail-"));
  try {
    const log = console.info;
    console.info = () => {};
    await devMailer(dir).send({ to: "Dev@X.th", subject: "s", html: "<p>h</p>", text: "t", link: "http://app.test/auth/confirm?token_hash=abc&type=signup" });
    console.info = log;
    const saved = JSON.parse(readFileSync(mailFile(dir, "Dev@X.th"), "utf8"));
    assert.equal(saved.link, "http://app.test/auth/confirm?token_hash=abc&type=signup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await resendMailer({ apiKey: "re_test", from: "EliteFlow <no-reply@app.test>", fetch: fake }).send({ to: "a@x.th", subject: "s", html: "h", text: "t" });
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer re_test");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).to, ["a@x.th"]);
  const failing = (async () => new Response("bad", { status: 422 })) as unknown as typeof fetch;
  await assert.rejects(resendMailer({ apiKey: "k", from: "f", fetch: failing }).send({ to: "a@x.th", subject: "s", html: "h", text: "t" }), /422/);
});
