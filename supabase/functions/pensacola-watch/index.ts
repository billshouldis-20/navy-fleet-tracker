import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Pensacola area watch: every vessel broadcasting AIS around Pensacola Bay and the
// Gulf approach, plus military aircraft from the public adsb.lol feed.
const SAMPLE_MS = 40_000;
const KEEP_DAYS = 45;
const BOX = [[29.9, -87.65], [30.75, -86.6]]; // [[lat,lon] SW, [lat,lon] NE]

function zoneOf(lat: number, lon: number): string {
  // Pensacola Pass sits near 30.32N; anything north of it inside the bay/sound counts as in port.
  if (lat >= 30.328 && lon > -87.45 && lon < -86.75) return "bay";
  if (lat >= 30.38 && lon <= -87.45) return "perdido";
  return "gulf";
}

async function sampleAis(key: string) {
  const pos = new Map<string, any>();
  const names = new Map<string, { name: string; type: number }>();
  let msgs = 0, err: string | null = null;
  await new Promise<void>((resolve) => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const finish = () => { try { ws.close(); } catch { /**/ } resolve(); };
    const t = setTimeout(finish, SAMPLE_MS);
    ws.onopen = () => ws.send(JSON.stringify({
      APIKey: key, BoundingBoxes: [BOX],
      FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData", "StaticDataReport"],
    }));
    ws.onmessage = async (ev) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : await new Response(ev.data).text();
        const m = JSON.parse(text);
        if (m.error) { err = String(m.error); clearTimeout(t); return finish(); }
        msgs++;
        const md = m.MetaData || {};
        const mmsi = String(md.MMSI ?? "");
        if (!mmsi) return;
        const name = String(md.ShipName ?? "").trim();
        const sd = m.Message?.ShipStaticData;
        if (sd) { names.set(mmsi, { name: (sd.Name || name || "").trim(), type: sd.Type ?? null }); return; }
        if (m.Message?.StaticDataReport) { if (name) names.set(mmsi, { name, type: names.get(mmsi)?.type ?? null }); return; }
        const b = m.Message?.PositionReport || m.Message?.StandardClassBPositionReport;
        if (!b) return;
        const lat = md.latitude ?? b.Latitude, lon = md.longitude ?? b.Longitude;
        if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90) return;
        pos.set(mmsi, { mmsi, name: name || null, lat, lon, sog: b.Sog ?? null, cog: b.Cog ?? null,
          heading: b.TrueHeading === 511 ? null : (b.TrueHeading ?? null), zone: zoneOf(lat, lon), seen_at: new Date().toISOString() });
      } catch { /**/ }
    };
    ws.onerror = () => { err = err ?? "websocket error"; clearTimeout(t); finish(); };
    ws.onclose = () => { clearTimeout(t); resolve(); };
  });
  for (const [mmsi, n] of names) { const p = pos.get(mmsi); if (p) { p.name = n.name || p.name; p.ship_type = n.type; } }
  return { pos, names, msgs, err };
}

async function sampleAircraft() {
  const r = await fetch("https://api.adsb.lol/v2/point/30.45/-87.05/50", { headers: { "User-Agent": "navy-fleet-tracker" } });
  if (!r.ok) throw new Error("adsb " + r.status);
  const j = await r.json();
  return (j.ac || []).filter((a: any) => (a.dbFlags & 1) === 1 && typeof a.lat === "number" && typeof a.lon === "number")
    .map((a: any) => ({ hex: a.hex, flight: (a.flight || "").trim() || null, reg: a.r || null, type: a.t || null,
      lat: a.lat, lon: a.lon, alt: typeof a.alt_baro === "number" ? a.alt_baro : 0, gs: a.gs ?? null, track: a.track ?? null,
      seen_at: new Date().toISOString() }));
}

Deno.serve(async () => {
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: key } = await supa.rpc("get_aisstream_key");
  const errors: string[] = [];

  const [ais, air] = await Promise.all([
    key ? sampleAis(key as string) : Promise.resolve({ pos: new Map(), names: new Map(), msgs: 0, err: "no AIS key" }),
    sampleAircraft().catch((e) => { errors.push(String(e)); return [] as any[]; }),
  ]);
  if (ais.err) errors.push("ais: " + ais.err);

  // Port entry/exit events: compare each vessel's new zone with its stored one
  const vessels = [...ais.pos.values()];
  if (vessels.length) {
    const { data: prev } = await supa.from("pns_vessels").select("mmsi,zone,name").in("mmsi", vessels.map(v => v.mmsi));
    const prevZone = new Map((prev || []).map((p: any) => [p.mmsi, p]));
    const events = [];
    for (const v of vessels) {
      const p: any = prevZone.get(v.mmsi);
      if (!v.name && p?.name) v.name = p.name;
      if (p && p.zone && p.zone !== v.zone) {
        if (v.zone === "bay") events.push({ mmsi: v.mmsi, name: v.name, event: "entered Pensacola Bay" });
        else if (p.zone === "bay") events.push({ mmsi: v.mmsi, name: v.name, event: "left Pensacola Bay" });
      }
    }
    const { error: e1 } = await supa.from("pns_vessels").upsert(vessels);
    if (e1) errors.push(e1.message);
    await supa.from("pns_vessel_tracks").insert(vessels.map(v => ({ mmsi: v.mmsi, lat: v.lat, lon: v.lon, sog: v.sog, zone: v.zone, seen_at: v.seen_at })));
    if (events.length) await supa.from("pns_port_events").insert(events);
  }
  // Names seen without a position this run
  for (const [mmsi, n] of ais.names) {
    if (!ais.pos.has(mmsi) && n.name) await supa.from("pns_vessels").update({ name: n.name, ship_type: n.type }).eq("mmsi", mmsi);
  }
  if (air.length) {
    const { error: e2 } = await supa.from("pns_aircraft").upsert(air);
    if (e2) errors.push(e2.message);
    await supa.from("pns_aircraft_tracks").insert(air.map(a => ({ hex: a.hex, lat: a.lat, lon: a.lon, alt: a.alt, seen_at: a.seen_at })));
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  for (const [t, c] of [["pns_vessels", "seen_at"], ["pns_vessel_tracks", "seen_at"], ["pns_port_events", "seen_at"], ["pns_aircraft", "seen_at"], ["pns_aircraft_tracks", "seen_at"]]) {
    await supa.from(t).delete().lt(c, cutoff);
  }
  await supa.from("pns_runs").delete().lt("ran_at", new Date(Date.now() - 7 * 864e5).toISOString());
  const error = errors.length ? errors.join("; ") : null;
  await supa.from("pns_runs").insert({ ais_msgs: ais.msgs, vessels: vessels.length, aircraft: air.length, error });
  return Response.json({ ok: !error, ais_msgs: ais.msgs, vessels: vessels.length, aircraft: air.length, error });
});
