import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Builds a compact base map of NAS Pensacola + Corry Station from OpenStreetMap
// (runways, taxiways, aprons, roads, building footprints, coastline, water, golf,
// beaches, installation boundary) and stores it in pns_basemap for the tracker page.
// Coordinates are integers: (lon - O[0]) * 1e5, (lat - O[1]) * 1e5, "x,y x,y ...".
const O = [-87.35, 30.32];
const TILES: number[][] = [];
for (let lon = -87.345; lon < -87.25; lon += 0.0475) for (let lat = 30.33; lat < 30.38; lat += 0.025) TILES.push([lon, lat, lon + 0.0475, lat + 0.025]);
TILES.push([-87.302, 30.392, -87.276, 30.414]);

type P = [number, number];
function dp(Pts: P[], tol: number): P[] {
  if (Pts.length < 3) return Pts;
  const keep = new Uint8Array(Pts.length); keep[0] = keep[Pts.length - 1] = 1;
  const st: [number, number][] = [[0, Pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!; let md = 0, mi = -1;
    const [x1, y1] = Pts[a], [x2, y2] = Pts[b], L = Math.hypot(x2 - x1, y2 - y1);
    for (let i = a + 1; i < b; i++) {
      const d = L ? Math.abs((x2 - x1) * (y1 - Pts[i][1]) - (x1 - Pts[i][0]) * (y2 - y1)) / L : Math.hypot(Pts[i][0] - x1, Pts[i][1] - y1);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return Pts.filter((_, i) => keep[i]);
}

Deno.serve(async () => {
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, { nodes: number[]; tags?: Record<string, string> }>();
  const rels = new Map<number, { members: { type: string; ref: number; role: string }[]; tags?: Record<string, string> }>();
  const errors: string[] = [];
  for (const t of TILES) {
    const bbox = t.map((x) => x.toFixed(4)).join(",");
    try {
      const r = await fetch("https://api.openstreetmap.org/api/0.6/map.json?bbox=" + bbox, { headers: { "User-Agent": "navy-fleet-tracker/1.0 (personal map)" } });
      if (!r.ok) { errors.push(bbox + " " + r.status); continue; }
      const j = await r.json();
      for (const e of j.elements) {
        if (e.type === "node") nodes.set(e.id, e); else if (e.type === "way") ways.set(e.id, e); else rels.set(e.id, e);
      }
    } catch (e) { errors.push(bbox + " " + e); }
  }
  const pts = (ids: number[]): P[] => ids.map((id) => nodes.get(id)).filter(Boolean)
    .map((n) => [Math.round((n!.lon - O[0]) * 1e5), Math.round((n!.lat - O[1]) * 1e5)] as P);
  const enc = (ids: number[], tol: number) => dp(pts(ids), tol).map((p) => p.join(",")).join(" ");
  const out: Record<string, unknown> & { [k: string]: any } = {
    origin: O, runway: [], taxiway: [], apron: [], major: [], minor: [], bld: [], coast: [], water: [], golf: [], beach: [], base: [],
  };
  const MAJ = /^(primary|secondary|trunk)$/, MIN = /^(tertiary|unclassified|residential)$/;
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (t.aeroway === "runway") out.runway.push([enc(w.nodes, 1), t.ref || ""]);
    else if (t.aeroway === "taxiway") out.taxiway.push(enc(w.nodes, 2));
    else if (t.aeroway === "apron") out.apron.push(enc(w.nodes, 2));
    else if (t.highway && MAJ.test(t.highway)) out.major.push([enc(w.nodes, 3), t.name || ""]);
    else if (t.highway && MIN.test(t.highway)) out.minor.push([enc(w.nodes, 4), t.name || ""]);
    else if (t.building) { const s = enc(w.nodes, 1.2); if (s.split(" ").length >= 4) out.bld.push(s); }
    else if (t.natural === "coastline") out.coast.push(enc(w.nodes, 4));
    else if (t.natural === "water" || t.water) out.water.push(enc(w.nodes, 4));
    else if (t.leisure === "golf_course" || t.golf === "fairway") out.golf.push(enc(w.nodes, 4));
    else if (t.natural === "beach" || t.natural === "sand") out.beach.push(enc(w.nodes, 5));
    else if (t.landuse === "military") out.base.push(enc(w.nodes, 4));
  }
  for (const r of rels.values()) {
    const t = r.tags || {};
    if (t.landuse === "military" || t.military) for (const m of r.members)
      if (m.type === "way" && m.role !== "inner" && ways.has(m.ref)) out.base.push(enc(ways.get(m.ref)!.nodes, 4));
  }
  out.builtAt = new Date().toISOString();
  out.source = "© OpenStreetMap contributors (ODbL)";
  const counts = Object.fromEntries(Object.entries(out).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
  const { error } = await supa.from("pns_basemap").upsert({ id: 1, data: out, built_at: out.builtAt, errors: errors.join("; ") || null });
  return Response.json({ ok: !error, error: error?.message, errors, counts, bytes: JSON.stringify(out).length });
});
