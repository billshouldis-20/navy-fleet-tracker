import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Listens to the AISStream.io global feed for a short window. Stores the latest
// position of each US Navy / MSC ship and of each allied, partner or rival-navy warship (by navy name
// prefix, checked against the MMSI country code), plus a 45-day track log for both.
const SAMPLE_MS = 40_000;
const KEEP_DAYS = 45;
const US_RE = /^(USS|USNS|US NAVY|USN|U\.S\. NAVY|US WARSHIP)\b/i;
const GENERIC_RE = /^(NAVY|WARSHIP|NAVAL VESSEL|MILITARY|MIL VESSEL)\b/i;
const NOT_NAVY_RE = /^(USCG|USCGC|CGC|NOAA|COAST GUARD|ACOE|USACE)\b/i;
const US_MID = new Set(["338", "366", "367", "368", "369"]);

// MMSI country codes (MID) for allied navies
const MID: Record<string, string> = {
  "232": "United Kingdom", "233": "United Kingdom", "234": "United Kingdom", "235": "United Kingdom",
  "226": "France", "227": "France", "228": "France", "211": "Germany", "218": "Germany",
  "247": "Italy", "224": "Spain", "225": "Spain", "263": "Portugal", "244": "Netherlands", "245": "Netherlands", "246": "Netherlands",
  "205": "Belgium", "219": "Denmark", "220": "Denmark", "257": "Norway", "258": "Norway", "259": "Norway",
  "265": "Sweden", "266": "Sweden", "230": "Finland", "276": "Estonia", "275": "Latvia", "277": "Lithuania",
  "261": "Poland", "264": "Romania", "207": "Bulgaria", "237": "Greece", "239": "Greece", "240": "Greece", "241": "Greece",
  "271": "Türkiye", "238": "Croatia", "316": "Canada", "503": "Australia", "512": "New Zealand",
  "431": "Japan", "432": "Japan", "440": "South Korea", "441": "South Korea", "548": "Philippines",
  // Watched (non-allied) navies, stored alongside allies and shown on their own layer
  "273": "Russia", "412": "China", "413": "China", "414": "China", "422": "Iran", "445": "North Korea", "419": "India",
};
// Navy ship prefixes. "mid" lists which country codes must match for prefixes that
// civilian ships also use (e.g. FS, JS, ITS, HS).
const PREFIX: [RegExp, string, string[]?][] = [
  [/^HMS\b/i, "United Kingdom", ["232", "233", "234", "235"]],
  [/^RFA\b/i, "United Kingdom", ["232", "233", "234", "235"]],
  [/^HMCS\b/i, "Canada"], [/^HMAS\b/i, "Australia"], [/^HMNZS\b/i, "New Zealand"],
  [/^(HNOMS|KNM)\b/i, "Norway"], [/^(HNLMS|ZR\.?\s?MS)\b/i, "Netherlands"], [/^(HDMS|KDM)\b/i, "Denmark"],
  [/^HSWMS\b/i, "Sweden"], [/^FGS\b/i, "Germany"], [/^ESPS\b/i, "Spain"], [/^TCG\b/i, "Türkiye"],
  [/^ORP\b/i, "Poland"], [/^NRP\b/i, "Portugal"], [/^ROKS\b/i, "South Korea"], [/^BRP\b/i, "Philippines", ["548"]],
  [/^(FS|MN|MARINE NATIONALE)\b/i, "France", ["226", "227", "228"]],
  [/^(ITS|NAVE|MARINA MILITARE)\b/i, "Italy", ["247"]],
  [/^(JS|JMSDF)\b/i, "Japan", ["431", "432"]],
  [/^HS\b/i, "Greece", ["237", "239", "240", "241"]],
  [/^(FNS|SUOMEN)\b/i, "Finland", ["230"]], [/^BNS\b/i, "Belgium", ["205"]],
  [/^(RFS|RFN|VMF)\b/i, "Russia", ["273"]], [/^(CNS|PLAN|PLANS)\b/i, "China", ["412", "413", "414"]],
  [/^(IRIS|IRINS)\b/i, "Iran", ["422"]], [/^INS\b/i, "India", ["419"]],
];

function classify(name: string, mmsi: string): { side: "us" | "ally"; country?: string } | null {
  if (!name || NOT_NAVY_RE.test(name)) return null;
  const mid = mmsi.slice(0, 3);
  if (US_RE.test(name)) return { side: "us" };
  for (const [re, country, mids] of PREFIX) {
    if (re.test(name) && (!mids || mids.includes(mid))) return { side: "ally", country };
  }
  if (GENERIC_RE.test(name)) {
    if (US_MID.has(mid)) return { side: "us" };
    if (MID[mid]) return { side: "ally", country: MID[mid] };
  }
  return null;
}

Deno.serve(async () => {
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let key = Deno.env.get("AISSTREAM_API_KEY");
  if (!key) {
    const { data } = await supa.rpc("get_aisstream_key");
    if (typeof data === "string" && data) key = data;
  }
  if (!key) {
    await supa.from("navy_ais_runs").insert({ messages: 0, matched: 0, error: "AISSTREAM_API_KEY not set" });
    return Response.json({ ok: false, error: "AISSTREAM_API_KEY not set" });
  }

  const found = new Map<string, Record<string, unknown>>();
  const allied = new Map<string, Record<string, unknown>>();
  let messages = 0;
  let error: string | null = null;

  await new Promise<void>((resolve) => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const finish = () => { try { ws.close(); } catch { /* ignore */ } resolve(); };
    const timer = setTimeout(finish, SAMPLE_MS);
    ws.onopen = () => ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"],
    }));
    ws.onmessage = async (ev) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : await new Response(ev.data).text();
        const m = JSON.parse(text);
        if (m.error) { error = String(m.error); clearTimeout(timer); return finish(); }
        messages++;
        const md = m.MetaData || {};
        const mmsi = String(md.MMSI ?? "");
        const name = String(md.ShipName ?? "").trim();
        if (!mmsi) return;
        const c = classify(name, mmsi);
        if (!c) return;
        const body = m.Message?.PositionReport || m.Message?.StandardClassBPositionReport || {};
        const lat = md.latitude ?? body.Latitude;
        const lon = md.longitude ?? body.Longitude;
        if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        const row = { mmsi, name, lat, lon, sog: body.Sog ?? null, cog: body.Cog ?? null, seen_at: new Date().toISOString() };
        if (c.side === "us") found.set(mmsi, row);
        else allied.set(mmsi, { ...row, country: c.country });
      } catch { /* skip bad message */ }
    };
    ws.onerror = () => { error = error ?? "websocket error"; clearTimeout(timer); finish(); };
    ws.onclose = () => { clearTimeout(timer); resolve(); };
  });

  const save = async (posTable: string, trackTable: string, map: Map<string, Record<string, unknown>>) => {
    if (!map.size) return;
    const rows = [...map.values()];
    const { error: upErr } = await supa.from(posTable).upsert(rows);
    if (upErr) error = (error ? error + "; " : "") + upErr.message;
    const { error: trErr } = await supa.from(trackTable).insert(rows);
    if (trErr) error = (error ? error + "; " : "") + trErr.message;
  };
  await save("navy_ais_positions", "navy_ais_tracks", found);
  await save("allied_ais_positions", "allied_ais_tracks", allied);

  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  await supa.from("navy_ais_runs").insert({ messages, matched: found.size, allied: allied.size, error });
  await supa.from("navy_ais_runs").delete().lt("ran_at", new Date(Date.now() - 7 * 864e5).toISOString());
  for (const t of ["navy_ais_positions", "navy_ais_tracks", "allied_ais_positions", "allied_ais_tracks"]) {
    await supa.from(t).delete().lt("seen_at", cutoff);
  }
  return Response.json({ ok: !error, messages, matched: found.size, allied: allied.size, error });
});
