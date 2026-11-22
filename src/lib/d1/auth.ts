// Real accounts on D1: Better Auth (email + password, email confirmation before sign-in, password reset, sessions in
// HTTP-only cookies) on the D1 tables of cloudflare/d1/0004_auth.sql. Its `user` model is our `users` table (uuid ids,
// so memberships.user_id keeps meaning the same person). The Supabase-shaped D1 client (postgrest.ts) answers
// sb.auth.signInWithPassword / signUp / verifyOtp / … by calling Better Auth's server API here (d1AuthProvider), so the
// app's own sign-in code (src/app/api/[...path]/route.ts, /auth/callback, /auth/confirm) does not change. Better
// Auth's HTTP handler is not mounted: nothing here is reachable except through those calls.
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint, createEmailVerificationToken, isAPIError, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies/utils";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import bcrypt from "bcryptjs";
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type CompiledQuery, type DatabaseConnection, type Dialect, type QueryResult } from "kysely";
import * as z from "zod";
import type { Sql, SqlValue } from "./driver";
import { confirmSignUpMail, envMailer, inviteMail, resetPasswordMail, type Mailer } from "./mailer";
import type { AuthError, AuthUser, AuthUserResponse, D1AuthMethods, D1AuthProvider, D1User } from "./postgrest";
import { clientIp, tooManyRequests, type RateAction, type RateLimiter } from "./rate-limit";

// ---------- env ----------
const DEV_SECRET = "eliteflow-d1-dev-better-auth-secret-not-for-production";
/** BETTER_AUTH_SECRET (wrangler secret put BETTER_AUTH_SECRET); a fixed dev key outside production. */
export function authSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ตั้งค่า BETTER_AUTH_SECRET ก่อนใช้การเข้าสู่ระบบบน D1");
  return DEV_SECRET;
}
/** BETTER_AUTH_URL, else NEXT_PUBLIC_APP_URL: the site the email links open. */
export const authUrl = () => (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

// ---------- Kysely on our Sql (D1 binding on Workers, node:sqlite in node) ----------
const toValue = (v: unknown): SqlValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number") return v;
  return JSON.stringify(v);
};
/** A Kysely dialect over the app's Sql. No interactive transactions (D1 has none); Better Auth runs with transaction: false. */
export function sqlDialect(sql: Sql): Dialect {
  const conn: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      const params = q.parameters.map(toValue),
        kind = q.query.kind;
      if (kind === "SelectQueryNode" || kind === "RawNode" || /\breturning\b/i.test(q.sql)) {
        const rows = await sql.all<R>(q.sql, params);
        return kind === "SelectQueryNode" ? { rows } : { rows, numAffectedRows: BigInt(rows.length) };
      }
      const { changes } = await sql.run(q.sql, params);
      return { rows: [], numAffectedRows: BigInt(changes) };
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error("D1 does not stream query results");
    },
  };
  const noTx = async () => {
    throw new Error("D1 has no interactive transactions");
  };
  return {
    createAdapter: () => new SqliteAdapter(),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createDriver: () => ({
      init: async () => {},
      acquireConnection: async () => conn,
      beginTransaction: noTx,
      commitTransaction: noTx,
      rollbackTransaction: noTx,
      releaseConnection: async () => {},
      destroy: async () => {},
    }),
  };
}

// ---------- passwords ----------
/** New passwords: Better Auth's scrypt. Hashes imported from Supabase ("$2a$…" bcrypt) still sign in (bcryptjs). */
export const passwordHasher = {
  hash: (password: string) => hashPassword(password),
  verify: async ({ hash, password }: { hash: string; password: string }) =>
    hash.startsWith("$2") ? bcrypt.compare(password, hash) : verifyPassword({ hash, password }),
};

// ---------- links ----------
export const confirmLink = (base: string, token: string, type: "signup" | "recovery" | "invite") => `${base}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=${type}`;

// ---------- Better Auth ----------
export type D1AuthConfig = { sql: Sql; mailer?: Mailer; secret?: string; appUrl?: string };
const INVALID_TOKEN = { code: "INVALID_TOKEN", message: "Invalid token" };

export function createD1Auth(cfg: D1AuthConfig) {
  const secret = cfg.secret ?? authSecret(),
    appUrl = (cfg.appUrl ?? authUrl()).replace(/\/$/, ""),
    mailer = cfg.mailer ?? envMailer(),
    { sql } = cfg;
  const sendConfirm = (email: string, token: string) => mailer.send({ to: email, ...confirmSignUpMail(email, confirmLink(appUrl, token, "signup")) });
  const confirmExpires = 60 * 60 * 24; // 24 h, like Supabase's default mailer_otp_exp

  return betterAuth({
    appName: "EliteFlow",
    secret,
    baseURL: appUrl,
    trustedOrigins: [appUrl],
    telemetry: { enabled: false },
    database: { dialect: sqlDialect(sql), type: "sqlite", transaction: false },
    user: {
      modelName: "users",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
    },
    session: {
      modelName: "auth_sessions",
      fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", createdAt: "created_at", updatedAt: "updated_at" },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 6,
      maxPasswordLength: 200,
      resetPasswordTokenExpiresIn: 60 * 60,
      password: passwordHasher,
      sendResetPassword: async ({ user, token }) => {
        await mailer.send({ to: user.email, ...resetPasswordMail(user.email, confirmLink(appUrl, token, "recovery")) });
      },
      // Supabase sends the confirmation again when an unconfirmed address signs up again.
      onExistingUserSignUp: async ({ user }) => {
        if (user.emailVerified) return;
        await sendConfirm(user.email, await createEmailVerificationToken(secret, user.email, undefined, confirmExpires, { userId: user.id }));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: confirmExpires,
      sendVerificationEmail: async ({ user, token }) => sendConfirm(user.email, token),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await sql.run("UPDATE users SET last_sign_in_at = ? WHERE id = ?", [new Date().toISOString(), session.userId]);
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "ef",
      useSecureCookies: appUrl.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"] },
      database: { generateId: "uuid" },
    },
    plugins: [
      {
        id: "eliteflow-d1",
        endpoints: {
          /** Supabase verifyOtp({ type: "recovery" }): the reset link signs the person in (token used up). */
          d1RecoverySignIn: createAuthEndpoint.serverOnly({ method: "POST", body: z.object({ token: z.string().min(1) }) }, async (ctx) => {
            const v = await ctx.context.internalAdapter.consumeVerificationValue(`reset-password:${ctx.body.token}`);
            if (!v || v.expiresAt < new Date()) throw APIError.from("BAD_REQUEST", INVALID_TOKEN);
            let user = await ctx.context.internalAdapter.findUserById(v.value);
            if (!user) throw APIError.from("BAD_REQUEST", INVALID_TOKEN);
            // Opening the recovery link proves the address, as on Supabase.
            if (!user.emailVerified) user = await ctx.context.internalAdapter.updateUser(user.id, { emailVerified: true });
            const session = await ctx.context.internalAdapter.createSession(user.id);
            if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_CREATE_SESSION", message: "Failed to create session" });
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ user });
          }),
          /**
           * Supabase auth.admin.inviteUserByEmail: a new account without a password and the invitation email
           * (/auth/confirm?token_hash=<email-confirmation token>&type=invite). Opening it confirms the address and signs
           * the person in; route.ts then sends them to /reset-password?invite=1 to choose a password (d1SetPassword).
           * An address that already has an account answers Supabase's "already been registered".
           */
          d1Invite: createAuthEndpoint.serverOnly({ method: "POST", body: z.object({ email: z.string().min(3), name: z.string().optional() }) }, async (ctx) => {
            const email = ctx.body.email.trim().toLowerCase();
            if (!z.email().safeParse(email).success) throw APIError.from("BAD_REQUEST", { code: "INVALID_EMAIL", message: "Invalid email" });
            if (await ctx.context.internalAdapter.findUserByEmail(email))
              throw APIError.from("UNPROCESSABLE_ENTITY", { code: "EMAIL_EXISTS", message: "A user with this email address has already been registered" });
            const user = await ctx.context.internalAdapter.createUser({ email, name: ctx.body.name?.trim() || email.split("@")[0], emailVerified: false }, { method: "admin" });
            if (!user) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" });
            const token = await createEmailVerificationToken(ctx.context.secret, email, undefined, confirmExpires, { userId: user.id });
            await mailer.send({ to: email, ...inviteMail(email, confirmLink(appUrl, token, "invite")) });
            return ctx.json({ user });
          }),
          /** Supabase updateUser({ password }) for the signed-in person (no current password, like Supabase). */
          d1SetPassword: createAuthEndpoint.serverOnly(
            { method: "POST", body: z.object({ password: z.string() }), use: [sessionMiddleware] },
            async (ctx) => {
              const { password } = ctx.body,
                cfgPw = ctx.context.password.config;
              if (password.length < cfgPw.minPasswordLength) throw APIError.from("BAD_REQUEST", { code: "PASSWORD_TOO_SHORT", message: "Password too short" });
              if (password.length > cfgPw.maxPasswordLength) throw APIError.from("BAD_REQUEST", { code: "PASSWORD_TOO_LONG", message: "Password too long" });
              const userId = ctx.context.session.user.id,
                hash = await ctx.context.password.hash(password);
              const accounts = await ctx.context.internalAdapter.findAccounts(userId);
              if (accounts.some((a) => a.providerId === "credential")) await ctx.context.internalAdapter.updatePassword(userId, hash);
              else await ctx.context.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
              return ctx.json({ user: ctx.context.session.user });
            },
          ),
        },
      },
    ],
  });
}
export type D1Auth = ReturnType<typeof createD1Auth>;

const authBySql = new WeakMap<Sql, D1Auth>();
/** The Better Auth of this database (configured from env; one per process). */
export function d1Auth(sql: Sql): D1Auth {
  let a = authBySql.get(sql);
  if (!a) authBySql.set(sql, (a = createD1Auth({ sql })));
  return a;
}

// ---------- the supabase-js auth methods ----------
/** What next/headers cookies() gives (and a Map-backed jar in tests). */
export type CookieJar = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
};
type BaUser = { id: string; email: string; name: string; emailVerified: boolean; createdAt: Date | string; image?: string | null };
type ApiResult<T> = { headers: Headers; response: T };
type Api = Record<string, (ctx: Record<string, unknown>) => Promise<unknown>>;

const iso = (d: Date | string | null | undefined) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
export const toD1User = (u: BaUser): D1User => ({ id: u.id, email: u.email, name: u.name ?? "", emailVerified: !!u.emailVerified, createdAt: iso(u.createdAt) ?? undefined });

const authError = (message: string, status: number, code: string): AuthError => ({ message, name: "AuthApiError", status, code });
/** Better Auth errors → the messages and codes Supabase Auth answered (the app shows / records these). */
export function supabaseError(e: unknown): AuthError {
  if (!isAPIError(e)) return authError(String((e as Error)?.message ?? e), 500, "unexpected_failure");
  const body = (e as { body?: { code?: string; message?: string } }).body ?? {},
    code = body.code ?? "";
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return authError("Invalid login credentials", 400, "invalid_credentials");
    case "EMAIL_NOT_VERIFIED":
      return authError("Email not confirmed", 400, "email_not_confirmed");
    case "INVALID_EMAIL":
      return authError("Unable to validate email address: invalid format", 400, "validation_failed");
    case "PASSWORD_TOO_SHORT":
      return authError("Password should be at least 6 characters.", 422, "weak_password");
    case "PASSWORD_TOO_LONG":
      return authError("Password cannot be longer than 200 characters", 422, "weak_password");
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
    case "USER_NOT_FOUND":
      return authError("Email link is invalid or has expired", 403, "otp_expired");
    case "EMAIL_EXISTS":
      return authError("A user with this email address has already been registered", 422, "email_exists");
    case "UNAUTHORIZED":
    case "":
      if ((e as { statusCode?: number }).statusCode === 401) return authError("Auth session missing!", 400, "session_missing");
  }
  return authError(body.message || e.message, (e as { statusCode?: number }).statusCode ?? 400, code.toLowerCase() || "unexpected_failure");
}
/** The JWT payload of an email-confirmation token, unverified (Better Auth's verifyEmail checks the signature). */
function jwtPayload(token: string): { email?: string; userId?: string } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export type D1AuthBridgeOptions = {
  auth: D1Auth | (() => D1Auth | Promise<D1Auth>);
  /** The request's cookies (next/headers cookies()); Set-Cookie from Better Auth is written here. */
  cookies: CookieJar | (() => CookieJar | Promise<CookieJar>);
  /** The request's headers (user agent and IP for the session row). */
  headers?: Headers | (() => Headers | undefined | Promise<Headers | undefined>);
  /** Explicit dev stand-in when no Better Auth session: D1_DEV_USER (never in production). */
  devUser?: () => Promise<D1User | null>;
  /** Per-email / per-IP limits of sign-in, sign-up and reset (src/lib/d1/rate-limit.ts). Without it: no limits. */
  limiter?: RateLimiter | null;
};
export function d1AuthBridge(o: D1AuthBridgeOptions) {
  let authP: Promise<D1Auth> | null = null;
  const auth = () => (authP ??= Promise.resolve(typeof o.auth === "function" ? o.auth() : o.auth));
  const api = async () => (await auth()).api as unknown as Api;
  let jarP: Promise<CookieJar> | null = null;
  const jar = () => (jarP ??= Promise.resolve(typeof o.cookies === "function" ? o.cookies() : o.cookies));
  // What the browser will hold after this request: the request's cookies with this request's Set-Cookie applied.
  let local: Map<string, string> | null = null;
  const cookieMap = async () => (local ??= new Map((await jar()).getAll().map((c) => [c.name, c.value])));

  const reqHeaders = async () => {
    const base = typeof o.headers === "function" ? await o.headers() : o.headers;
    const h = new Headers();
    base?.forEach((v, k) => k !== "cookie" && h.set(k, v));
    const cookie = [...(await cookieMap())].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.set("cookie", cookie);
    return h;
  };
  const applyCookies = async (headers: Headers | undefined) => {
    const raw = headers?.get("set-cookie");
    if (!raw) return;
    const j = await jar(),
      map = await cookieMap();
    parseSetCookieHeader(raw).forEach((attrs, name) => {
      if (!name) return;
      const opts = toCookieOptions(attrs) as Record<string, unknown>;
      if (attrs.value === "" || opts.maxAge === 0) map.delete(name);
      else map.set(name, attrs.value);
      try {
        j.set(name, attrs.value, opts);
      } catch {
        // Server Components cannot write cookies; the next route handler call refreshes them.
      }
    });
  };
  /** auth.api[name] with this request's headers; Set-Cookie written to the jar. */
  const call = async <T>(name: string, ctx: Record<string, unknown> = {}): Promise<T> => {
    const r = (await (await api())[name]({ ...ctx, headers: await reqHeaders(), returnHeaders: true })) as ApiResult<T>;
    await applyCookies(r.headers);
    return r.response;
  };
  const requestIp = async () => clientIp(typeof o.headers === "function" ? await o.headers() : o.headers);
  /** The limiter never breaks signing in: a failing lookup lets the call through (and is logged). */
  const limited = async (action: RateAction, email: string) => {
    try {
      return !!o.limiter && (await o.limiter.blocked(action, email, await requestIp()));
    } catch (e) {
      console.error("[auth] rate limit lookup failed:", (e as Error).message);
      return false;
    }
  };
  const count = async (action: RateAction, email: string, clear = false) => {
    try {
      if (clear) await o.limiter?.clear(action, email);
      else await o.limiter?.hit(action, email, await requestIp());
    } catch (e) {
      console.error("[auth] rate limit write failed:", (e as Error).message);
    }
  };
  const hasSessionCookie = async () => [...(await cookieMap()).keys()].some((k) => k.endsWith("session_token"));

  /** The person of this request's session cookie (or the dev stand-in), null when signed out. */
  async function currentUser(): Promise<D1User | null> {
    if (await hasSessionCookie()) {
      try {
        const s = await call<{ user: BaUser } | null>("getSession");
        if (s?.user) return toD1User(s.user);
      } catch (e) {
        console.warn("[auth] session lookup failed:", (e as Error).message);
      }
    }
    return (await o.devUser?.()) ?? null;
  }

  /** The supabase-js auth methods, bound to the client's signed-in person. */
  const provider: D1AuthProvider = (client) => {
    const ok = (u: D1User | null, session = true): AuthUserResponse => {
      client.setUser(u);
      const user = client.authUser();
      return { data: { user, session: session && user ? { user } : null }, error: null };
    };
    const failed = (e: unknown): AuthUserResponse => ({ data: { user: null, session: null }, error: supabaseError(e) });
    const signedInWith = async (u: BaUser | null | undefined) => {
      if (!u) throw APIError.from("BAD_REQUEST", INVALID_TOKEN);
      return ok(toD1User(u));
    };
    const verifyEmailToken = async (token: string) => {
      // Supabase links work once: an address already confirmed answers "invalid or expired".
      const claim = jwtPayload(token);
      if (!claim?.email) throw APIError.from("BAD_REQUEST", INVALID_TOKEN);
      const ctx = await (await auth()).$context;
      const found = await ctx.internalAdapter.findUserByEmail(claim.email);
      if (!found || found.user.emailVerified || (claim.userId && claim.userId !== found.user.id)) throw APIError.from("BAD_REQUEST", INVALID_TOKEN);
      await call("verifyEmail", { query: { token } });
      return signedInWith({ ...(found.user as BaUser), emailVerified: true });
    };
    const recovery = async (token: string) => signedInWith((await call<{ user: BaUser }>("d1RecoverySignIn", { body: { token } })).user);

    const methods: D1AuthMethods = {
      async signInWithPassword({ email, password }) {
        // 5 failed sign-ins per email (20 per IP) in 15 minutes, then 429 until the window passes.
        if (await limited("sign_in_failed", email)) return { data: { user: null, session: null }, error: tooManyRequests() };
        try {
          const r = await call<{ user: BaUser }>("signInEmail", { body: { email, password } });
          await upgradeHash(r.user.id, password);
          await count("sign_in_failed", email, true);
          return ok(toD1User(r.user));
        } catch (e) {
          await count("sign_in_failed", email);
          return failed(e);
        }
      },
      async signUp({ email, password, options }) {
        if (await limited("sign_up", email)) return { data: { user: null, session: null }, error: tooManyRequests() };
        await count("sign_up", email);
        try {
          const name = String(options?.data?.name ?? "").trim() || email.split("@")[0];
          const r = await call<{ token: string | null; user: BaUser }>("signUpEmail", { body: { email, password, name } });
          // Confirmation required: nobody is signed in until the link is opened (Supabase: session null).
          return { data: { user: client.toAuthUser(toD1User(r.user)), session: null }, error: null };
        } catch (e) {
          return failed(e);
        }
      },
      async signOut() {
        try {
          if (await hasSessionCookie()) await call("signOut");
        } catch {
          // An unknown or expired session: the cookies are cleared below all the same.
        }
        const j = await jar(),
          map = await cookieMap();
        for (const name of [...map.keys()])
          if (name.endsWith("session_token") || name.endsWith("session_data") || name.endsWith("dont_remember")) {
            map.delete(name);
            try {
              j.set(name, "", { maxAge: 0, path: "/" });
            } catch {}
          }
        client.setUser(null);
        return { error: null };
      },
      async resetPasswordForEmail(email) {
        if (await limited("reset", email)) return { data: null, error: tooManyRequests() };
        await count("reset", email);
        try {
          await call("requestPasswordReset", { body: { email } });
          return { data: {}, error: null };
        } catch (e) {
          return { data: null, error: supabaseError(e) };
        }
      },
      async verifyOtp({ token_hash, type }) {
        try {
          if (!token_hash) throw APIError.from("BAD_REQUEST", INVALID_TOKEN);
          if (type === "recovery") return await recovery(token_hash);
          if (["signup", "email", "invite", "magiclink", "email_change"].includes(type)) return await verifyEmailToken(token_hash);
          return failed(APIError.from("BAD_REQUEST", { code: "VALIDATION_FAILED", message: `Verify requires a supported type, got ${type}` }));
        } catch (e) {
          return failed(e);
        }
      },
      async exchangeCodeForSession(code) {
        // /auth/callback?code=: the same one-time token as the email link (a JWT for confirmations, else a reset token).
        try {
          return code.split(".").length === 3 ? await verifyEmailToken(code) : await recovery(code);
        } catch (e) {
          return failed(e);
        }
      },
      async updateUser(attrs) {
        try {
          if (!(await hasSessionCookie())) throw APIError.from("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Auth session missing!" });
          if (attrs.password !== undefined) await call("d1SetPassword", { body: { password: attrs.password } });
          if (attrs.data?.name !== undefined) await call("updateUser", { body: { name: String(attrs.data.name) } });
          const s = await call<{ user: BaUser } | null>("getSession", { query: { disableCookieCache: true } });
          if (!s?.user) throw APIError.from("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Auth session missing!" });
          client.setUser(toD1User(s.user));
          return { data: { user: client.authUser() }, error: null };
        } catch (e) {
          return { data: { user: null }, error: supabaseError(e) };
        }
      },
    };
    return methods;
  };

  /** A Supabase bcrypt hash is replaced by Better Auth's own after the first good sign-in. */
  async function upgradeHash(userId: string, password: string) {
    try {
      const ctx = await (await auth()).$context;
      const cred = (await ctx.internalAdapter.findAccounts(userId)).find((a) => a.providerId === "credential");
      if (cred?.password?.startsWith("$2")) await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
    } catch (e) {
      console.warn("[auth] could not re-hash an imported password:", (e as Error).message);
    }
  }

  return { currentUser, provider };
}

// ---------- the service client (supabaseAdmin()) ----------
/**
 * What the service client adds on D1: auth.admin.inviteUserByEmail and auth.resetPasswordForEmail (route.ts
 * emailInvite sends invitations and set-password links with these). No cookies: nobody is signed in by them.
 */
export function d1AuthAdmin(o: { auth: D1Auth | (() => D1Auth | Promise<D1Auth>); limiter?: RateLimiter | null | (() => Promise<RateLimiter | null>) }) {
  const api = async () => (await (typeof o.auth === "function" ? o.auth() : o.auth)).api as unknown as Api;
  const limiter = async () => (typeof o.limiter === "function" ? await o.limiter() : o.limiter) ?? null;
  const toAuthUser = (u: BaUser): AuthUser => ({
    id: u.id,
    email: u.email,
    user_metadata: { name: u.name ?? "" },
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: null,
    created_at: iso(u.createdAt),
  });
  return {
    /** Supabase: inviteUserByEmail(email, { data: { name }, redirectTo }) gives { data: { user }, error }. */
    async inviteUserByEmail(email: string, opts: { data?: Record<string, unknown>; redirectTo?: string } = {}) {
      try {
        const name = opts.data?.name == null ? undefined : String(opts.data.name);
        const r = (await (await api()).d1Invite({ body: { email, name } })) as { user: BaUser };
        return { data: { user: toAuthUser(r.user) }, error: null };
      } catch (e) {
        return { data: { user: null }, error: supabaseError(e) };
      }
    },
    /** Supabase: resetPasswordForEmail(email, { redirectTo }) as the service role; limited per address only. */
    async resetPasswordForEmail(email: string, _o?: { redirectTo?: string }) {
      try {
        const l = await limiter();
        if (l && (await l.blocked("reset", email, null))) return { data: null, error: tooManyRequests() };
        await l?.hit("reset", email, null);
        await (await api()).requestPasswordReset({ body: { email }, headers: new Headers() });
        return { data: {}, error: null };
      } catch (e) {
        return { data: null, error: supabaseError(e) };
      }
    },
  };
}
/** Adds d1AuthAdmin's calls to a service client's `auth` (supabaseAdmin() on D1). */
export function withAuthAdmin<C extends { auth: { admin: object } }>(client: C, admin: ReturnType<typeof d1AuthAdmin>) {
  Object.assign(client.auth, { resetPasswordForEmail: admin.resetPasswordForEmail });
  Object.assign(client.auth.admin, { inviteUserByEmail: admin.inviteUserByEmail });
  return client as C & { auth: { resetPasswordForEmail: typeof admin.resetPasswordForEmail; admin: { inviteUserByEmail: typeof admin.inviteUserByEmail } } };
}
