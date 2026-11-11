// One door to the AI model for every feature (น้องโฟลว์, Data Inbox extraction, form drafting).
// Google Gemini (GEMINI_API_KEY) is preferred: cheap and fast. OpenAI (OPENAI_API_KEY) stays as a fallback.
import { AsyncLocalStorage } from "node:async_hooks";
import { assert, AppError } from "./domain";
import { supabaseAdmin } from "./supabase/server";

/**
 * Which company an AI call is for. Set once per request (API) or per job (LINE worker); every aiGenerate under it is
 * checked against the free-trial ceiling and logged in ai_usage with tokens and an estimated cost.
 */
export const aiScope = new AsyncLocalStorage<{ company: string }>();
export const forCompany = (company: string | null | undefined) => {
  if (company) aiScope.enterWith({ company });
};
/** USD per 1M tokens (input, output incl. thinking). Unknown models are logged without a cost. */
const prices: Record<string, [number, number]> = {
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "gemini-3.1-flash-lite": [0.25, 1.5],
  "gemini-3.5-flash": [0.5, 4],
  "gpt-4.1-mini": [0.4, 1.6],
};
export const aiCost = (u: AiUsage) => {
  const p = prices[u.model];
  if (!p) return null;
  const cached = Math.min(u.cached || 0, u.input);
  return Math.round((((u.input - cached) * p[0] + cached * p[0] * 0.1 + u.output * p[1]) / 1e6) * 1e6) / 1e6;
};
type TrialMeter = { used: number; limit: number | null };
/** Trial or Free plan: stop before the call when the company has used its AI allowance. Paid plans are not limited here. */
async function checkTrial(company: string, feature: string, hasFile: boolean) {
  const { data } = await supabaseAdmin().rpc("trial_usage", { c: company });
  const t = data as (Record<string, TrialMeter> & { kind?: string }) | null;
  if (!t) return;
  const over = (m?: TrialMeter) => !!m && m.limit !== null && m.used >= m.limit;
  if (over(t.ai_calls) || (hasFile && over(t.ai_files)) || (feature === "chat" && over(t.ai_chat)))
    throw new AppError(
      t.kind === "free" ? "AI ของแพ็กเกจฟรีเดือนนี้ครบโควตาแล้ว อัปเกรดแพ็กเกจเพื่อใช้งานต่อ" : "ช่วงทดลองใช้ AI ครบโควตาแล้ว กรุณาเลือกแพ็กเกจเพื่อใช้งานต่อ",
      402,
    );
}
function logUsage(company: string, feature: string, hasFile: boolean, u: AiUsage) {
  void supabaseAdmin()
    .from("ai_usage")
    .insert({ company_id: company, feature, model: u.model, input_tokens: u.input, output_tokens: u.output, cached_tokens: u.cached || 0, has_file: hasFile, cost_usd: aiCost(u) })
    .then(() => {}, () => {});
}

export type AiPart = { text: string } | { file: { mime: string; name: string; bytes: Buffer } };
type Request = {
  instructions: string;
  parts: AiPart[];
  maxTokens?: number;
  /** JSON Schema for a structured answer; the reply is then a JSON string. */
  schema?: { name: string; schema: Record<string, unknown> };
  /** Uses the stronger OCR model when one is configured (the "ocr_plus" add-on). */
  precise?: boolean;
  timeoutMs?: number;
  /** Receives the tokens this call used, for cost reporting. */
  onUsage?: (u: AiUsage) => void;
  /** What the call is for (chat, sort, extract, scan, draft) — logged and used for the trial's chat ceiling. */
  feature?: string;
};
/** input counts every prompt token; cached is the part Gemini served from its cache (billed at about a tenth). */
export type AiUsage = { model: string; input: number; output: number; cached?: number };

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const aiProvider = () =>
  process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENAI_API_KEY ? "openai" : null;
export const aiEnabled = () => aiProvider() !== null;

export async function aiGenerate(req: Request): Promise<string> {
  const provider = aiProvider();
  assert(provider, "ยังไม่ได้ตั้งค่า AI", 503);
  const scope = aiScope.getStore(),
    feature = req.feature || "other",
    hasFile = req.parts.some((p) => "file" in p);
  if (scope && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await checkTrial(scope.company, feature, hasFile);
    const report = req.onUsage;
    req = { ...req, onUsage: (u) => (logUsage(scope.company, feature, hasFile, u), report?.(u)) };
  }
  const text = provider === "gemini" ? await gemini(req) : await openAi(req);
  assert(text, "AI ไม่คืนข้อมูลที่ตรวจสอบได้", 502);
  return text;
}

// Gemini takes about 20 MB inline per request (base64 adds a third), so bigger files go through its Files API.
const INLINE_MAX = 7_000_000;
async function geminiUpload(file: { mime: string; name: string; bytes: Buffer }) {
  const key = process.env.GEMINI_API_KEY!;
  const r = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "x-goog-api-key": key, "Content-Type": file.mime },
    body: new Uint8Array(file.bytes),
  });
  if (!r.ok) console.error("Gemini upload " + r.status + ": " + (await r.text()).slice(0, 300));
  assert(r.ok, "ส่งไฟล์ให้ AI ไม่สำเร็จ", 502);
  let f: { name: string; uri: string; state?: string } = (await r.json()).file;
  // Large PDFs may need a moment before they can be read.
  for (let i = 0; f.state === "PROCESSING" && i < 20; i++) {
    await new Promise((ok) => setTimeout(ok, 1000));
    f = await (await fetch("https://generativelanguage.googleapis.com/v1beta/" + f.name, { headers: { "x-goog-api-key": key } })).json();
  }
  assert(f.state !== "FAILED" && f.state !== "PROCESSING", "AI เตรียมไฟล์ไม่สำเร็จ", 502);
  return f.uri;
}

/**
 * Thinking is billed as output (the expensive side). Reading a receipt or filing a message into a form needs almost
 * none; a chat answer gets a little. GEMINI_THINKING_LEVEL=off sends nothing (the model's default).
 * A model that rejects the setting is retried once without it, and the setting is then left off.
 */
let thinkingRejected = false;
const thinkingFor = (feature: string | undefined, schema: unknown) => {
  const env = process.env.GEMINI_THINKING_LEVEL;
  if (thinkingRejected || env === "off") return null;
  return env || (feature === "chat" || !schema ? "low" : "minimal");
};

async function gemini(req: Request) {
  const level = thinkingFor(req.feature, req.schema);
  try {
    return await geminiCall(req, level);
  } catch (e) {
    if (!level || !(e instanceof AppError) || !/thinking/i.test(String((e as AppError & { detail?: string }).detail))) throw e;
    thinkingRejected = true;
    return geminiCall(req, null);
  }
}

async function geminiCall({ instructions, parts, maxTokens, schema, precise, timeoutMs = 45000, onUsage }: Request, thinking: string | null) {
  const model =
    (precise && process.env.GEMINI_OCR_MODEL) || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Static instructions first and unchanged between calls, so Gemini's implicit cache can serve them.
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [
          {
            role: "user",
            parts: await Promise.all(
              parts.map(async (p) =>
                "text" in p
                  ? { text: p.text }
                  : p.file.bytes.length > INLINE_MAX
                    ? { fileData: { mimeType: p.file.mime, fileUri: await geminiUpload(p.file) } }
                    : { inlineData: { mimeType: p.file.mime, data: p.file.bytes.toString("base64") } },
              ),
            ),
          },
        ],
        generationConfig: {
          ...(maxTokens && { maxOutputTokens: maxTokens }),
          ...(schema && { responseMimeType: "application/json", responseJsonSchema: schema.schema }),
          ...(thinking && { thinkingConfig: { thinkingLevel: thinking } }),
        },
      }),
    },
  );
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 500);
    console.error("Gemini " + r.status + " (" + model + "): " + detail);
    throw Object.assign(new AppError("AI ไม่พร้อม กรุณาตรวจการตั้งค่าหรือโควตา", 502), { detail: r.status === 400 ? detail : "" });
  }
  const d = await r.json();
  onUsage?.({
    model,
    input: d.usageMetadata?.promptTokenCount || 0,
    output: (d.usageMetadata?.candidatesTokenCount || 0) + (d.usageMetadata?.thoughtsTokenCount || 0),
    cached: d.usageMetadata?.cachedContentTokenCount || 0,
  });
  return (d.candidates?.[0]?.content?.parts || [])
    .filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
    .map((p: { text: string }) => p.text)
    .join("");
}

async function openAi({ instructions, parts, maxTokens, schema, precise, timeoutMs = 45000, onUsage }: Request) {
  const model = (precise && process.env.OPENAI_OCR_MODEL) || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      ...(maxTokens && { max_output_tokens: maxTokens }),
      instructions,
      input: [
        {
          role: "user",
          content: parts.map((p) => {
            if ("text" in p) return { type: "input_text", text: p.text };
            const data = `data:${p.file.mime};base64,${p.file.bytes.toString("base64")}`;
            return p.file.mime === "application/pdf"
              ? { type: "input_file", filename: p.file.name.slice(0, 120), file_data: data }
              : { type: "input_image", image_url: data };
          }),
        },
      ],
      ...(schema && { text: { format: { type: "json_schema", name: schema.name, strict: true, schema: schema.schema } } }),
    }),
  });
  assert(r.ok, "AI ไม่พร้อม กรุณาตรวจการตั้งค่าหรือโควตา", 502);
  const d = await r.json();
  onUsage?.({ model, input: d.usage?.input_tokens || 0, output: d.usage?.output_tokens || 0 });
  return d.output
    ?.flatMap((o: { content?: { type: string; text: string }[] }) => o.content || [])
    .find((c: { type: string }) => c.type === "output_text")?.text as string | undefined;
}
