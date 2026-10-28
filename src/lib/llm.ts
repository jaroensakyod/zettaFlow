// One door to the AI model for every feature (น้องโฟลว์, Data Inbox extraction, form drafting).
// Google Gemini (GEMINI_API_KEY) is preferred: cheap and fast. OpenAI (OPENAI_API_KEY) stays as a fallback.
import { assert } from "./domain";

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
};

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const aiProvider = () =>
  process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENAI_API_KEY ? "openai" : null;
export const aiEnabled = () => aiProvider() !== null;

export async function aiGenerate(req: Request): Promise<string> {
  const provider = aiProvider();
  assert(provider, "ยังไม่ได้ตั้งค่า AI", 503);
  const text = provider === "gemini" ? await gemini(req) : await openAi(req);
  assert(text, "AI ไม่คืนข้อมูลที่ตรวจสอบได้", 502);
  return text;
}

async function gemini({ instructions, parts, maxTokens, schema, precise, timeoutMs = 45000 }: Request) {
  const model =
    (precise && process.env.GEMINI_OCR_MODEL) || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [
          {
            role: "user",
            parts: parts.map((p) =>
              "text" in p
                ? { text: p.text }
                : { inlineData: { mimeType: p.file.mime, data: p.file.bytes.toString("base64") } },
            ),
          },
        ],
        generationConfig: {
          ...(maxTokens && { maxOutputTokens: maxTokens }),
          ...(schema && { responseMimeType: "application/json", responseJsonSchema: schema.schema }),
        },
      }),
    },
  );
  assert(r.ok, "AI ไม่พร้อม กรุณาตรวจการตั้งค่าหรือโควตา", 502);
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || [])
    .filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
    .map((p: { text: string }) => p.text)
    .join("");
}

async function openAi({ instructions, parts, maxTokens, schema, precise, timeoutMs = 45000 }: Request) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: (precise && process.env.OPENAI_OCR_MODEL) || process.env.OPENAI_MODEL || "gpt-4.1-mini",
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
  return d.output
    ?.flatMap((o: { content?: { type: string; text: string }[] }) => o.content || [])
    .find((c: { type: string }) => c.type === "output_text")?.text as string | undefined;
}
