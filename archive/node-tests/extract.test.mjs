import { test } from "node:test";
import assert from "node:assert/strict";
import { extract } from "../server/extract.mjs";
import { initialState } from "../server/domain.mjs";
test("AI adapter requests strict schema and rejects unsupported or invented value types", async () => {
  const previous = process.env.OPENAI_API_KEY,
    originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-only-key";
  const template = initialState().templates[1];
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.additionalProperties, false);
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    project: "Test",
                    date: "2026-10-12",
                    sales: 58420,
                    expense: null,
                  }),
                },
              ],
            },
          ],
        }),
      };
    };
    const result = await extract(template, "untrusted text");
    assert.equal(result.engine, "ai");
    assert.equal(result.values.sales, 58420);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [{ type: "output_text", text: '{"sales":"fake money"}' }],
          },
        ],
      }),
    });
    await assert.rejects(extract(template, "text"));
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(extract(template, "text"), (e) => e.status === 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
