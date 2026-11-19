import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// Fetches the lead photo of each ship's Wikipedia article (via the Wikipedia REST
// summary API), scales it to ~640 px and stores it base64-encoded in ship_photos so the
// tracker page (which can't load remote images) can show it.
// Body: { items: [{ key, wiki }], force?: boolean }
const UA = { "User-Agent": "navy-fleet-tracker/1.0 (personal map; Supabase function)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// polite fetch: paced, retries Wikipedia's 429 rate limit with back-off
async function get(url: string): Promise<Response> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.status !== 429) return r;
    await sleep(4000 * (i + 1));
  }
  return fetch(url, { headers: UA });
}

Deno.serve(async (req) => {
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { items = [], force = false } = await req.json().catch(() => ({}));
  const { data: have } = await supa.from("ship_photos").select("key");
  const done = new Set((have || []).map((r: { key: string }) => r.key));
  const results: Record<string, string> = {};
  for (const { key, wiki } of items as { key: string; wiki: string }[]) {
    if (!force && done.has(key)) { results[key] = "cached"; continue; }
    try {
      await sleep(1200);
      const s = await get("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(wiki));
      if (!s.ok) { results[key] = "summary " + s.status; continue; }
      const j = await s.json();
      let src: string | undefined = j.thumbnail?.source || j.originalimage?.source;
      if (!src) { results[key] = "no image"; continue; }
      src = src.replace(/\/(\d+)px-/, "/640px-");
      let r = await get(src);
      if (!r.ok && j.thumbnail?.source) r = await get(j.thumbnail.source);
      if (!r.ok) { results[key] = "image " + r.status; continue; }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 400_000) { results[key] = "too large"; continue; }
      const { error } = await supa.from("ship_photos").upsert({
        key, wiki, mime: r.headers.get("content-type") || "image/jpeg", b64: encodeBase64(buf),
        page_url: j.content_urls?.desktop?.page || "https://en.wikipedia.org/wiki/" + wiki, fetched_at: new Date().toISOString(),
      });
      results[key] = error ? "db " + error.message : "ok " + buf.length;
    } catch (e) { results[key] = "error " + e; }
  }
  return Response.json({ results });
});
