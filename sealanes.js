// Maritime waypoint graph ([lon, lat]). Every edge was checked against the
// 110m coastline; edges marked * are canals/straits too narrow for that data.
const SEA_NODES = {
  SD:[-117.6,32.4], BAJ1:[-118.8,29], CABO:[-110.3,22.2], EP1:[-125,30], EPN:[-128,40], JDF:[-124.9,48.4],
  HAWW:[-159,22.2], HAW:[-158.4,20.6], CP1:[-170,23], DATEL:[178,24], WP1:[160,23], WP2:[150,22], GUAM:[144.4,13.6],
  PHS:[132,22], OKI:[128.3,25.3], SASa:[129.3,32.9], KYU:[130.6,30.6], JPS:[135,32.4], YOKa:[139.8,34.7],
  KOR:[129.2,34.4], SOJ:[134,39], LUZ:[121,20.5], SCS1:[116,17], SCS2:[112,10], SCS3:[106.5,4], SING:[104.4,1.2],
  SINGW:[103.4,1.05], MAL0:[102.0,1.55], MAL1:[100.9,2.35], MAL2:[98.3,5.3], AND:[96,9], BOB:[88,8], SRI:[81,5.2],
  LAC:[74.5,9], IND:[76,2], DG:[72.4,-6.6], ARAB:[64,16], ARABN:[62,21], GOM:[58.6,24.3], HORM:[56.35,26.55],
  PG0:[55.0,26.1], PG1:[53.0,26.4], PG2:[50.9,27.2], ADEN:[49,12.8], GA:[45.5,12.3], BAB:[43.45,12.45],
  RED1:[41.2,16], RED2:[38.3,21], RED3:[34.4,26.9], GS1:[33.8,27.5], GS2:[33.0,28.8], SUEZS:[32.55,29.9],
  SUEZN:[32.35,31.6], EMED:[29,33.4], CRETE:[24,34.6], KYTH:[23.0,36.0], AEG:[24.3,37.3], CMED:[18,35],
  SIC:[12,36.9], SARDS:[9,38.2], WMED:[5,37.7], ALB:[-2,36.2], GIB:[-5.7,35.95], ROTA:[-7,36.4], ATL1:[-20,36],
  ATL2:[-45,36], ATL3:[-65,35], HAT:[-74.6,35], NORa:[-75.6,36.9], JAX:[-80.9,30.3], FLS1:[-79.8,27],
  FLM:[-79.75,25.6], FLS2:[-80.4,24.2], KEY:[-83,24.3], GOMX:[-86.5,27], PNSa:[-87.3,30.15], YUC:[-85.9,21.5],
  BAH:[-73,25.5], WIND:[-73.6,20.1], WIND2:[-74.6,19.2], CAR1:[-75,15.5], CAR2:[-67.5,15.5], MONA:[-67.75,18.55],
  PR:[-66,18.75], ANEG:[-63.8,18.6], PAN:[-79.9,9.6], PANP:[-79.5,8.6], GOP:[-79.5,6.6], GOP2:[-81.2,6.4],
  EPAC2:[-90,12], EPAC3:[-105,18]
};
const SEA_EDGES = ("SD-BAJ1 BAJ1-CABO CABO-EPAC3 SD-EP1 EP1-EPN EPN-JDF EP1-HAWW HAWW-HAW HAWW-CP1 HAW-CP1 CP1-DATEL " +
  "DATEL-WP1 WP1-WP2 WP2-GUAM WP2-PHS WP1-JPS GUAM-PHS PHS-OKI PHS-LUZ OKI-SASa OKI-KYU KYU-JPS SASa-KYU JPS-YOKa " +
  "SASa-KOR KOR-SOJ LUZ-SCS1 SCS1-SCS2 SCS2-SCS3 SCS3-SING SING-SINGW SINGW-MAL0* MAL0-MAL1* MAL1-MAL2 MAL2-AND AND-BOB " +
  "BOB-SRI SRI-LAC SRI-IND LAC-ARAB LAC-IND IND-ARAB IND-DG ARAB-ARABN ARABN-GOM ARAB-GOM GOM-HORM HORM-PG0 PG0-PG1 " +
  "PG1-PG2 ARAB-ADEN ADEN-GA GA-BAB BAB-RED1 RED1-RED2 RED2-RED3 RED3-GS1 GS1-GS2* GS2-SUEZS* SUEZS-SUEZN* SUEZN-EMED " +
  "EMED-CRETE CRETE-KYTH KYTH-AEG CMED-KYTH CRETE-CMED CMED-SIC SIC-SARDS SARDS-WMED WMED-ALB ALB-GIB* GIB-ROTA ROTA-ATL1 " +
  "GIB-ATL1 ATL1-ATL2 ATL2-ATL3 ATL3-HAT ATL3-NORa HAT-NORa HAT-JAX JAX-FLS1 FLS1-FLM FLM-FLS2 FLS2-KEY KEY-GOMX GOMX-PNSa " +
  "GOMX-YUC YUC-CAR1 HAT-BAH ATL3-BAH BAH-WIND BAH-ANEG WIND-WIND2 WIND2-CAR1 ANEG-CAR2 ANEG-PR PR-MONA MONA-CAR2 " +
  "CAR2-CAR1 CAR1-PAN PAN-PANP* PANP-GOP GOP-GOP2 GOP2-EPAC2 EPAC2-EPAC3").split(" ").filter(Boolean);

// Returns a list of [lon,lat] points from a to b that stays at sea, using the
// waypoint graph whenever the direct great-circle leg would cross land.
function makeSeaRouter(d3, land) {
  const nodes = Object.entries(SEA_NODES).map(([id, p]) => ({ id, p }));
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const adj = nodes.map(() => []);
  for (const e of SEA_EDGES) {
    const [a, b] = e.replace("*", "").split("-"); const i = idx[a], j = idx[b];
    const w = d3.geoDistance(nodes[i].p, nodes[j].p);
    adj[i].push([j, w]); adj[j].push([i, w]);
  }
  const KM = 6371;
  // Land test along a leg, ignoring the first/last ~40 km (ports and coastal positions sit on the coarse coastline)
  function clear(A, B) {
    const D = d3.geoDistance(A, B) * KM; if (D < 1) return true;
    const f = d3.geoInterpolate(A, B), n = Math.max(8, Math.ceil(D / 20)), skip = Math.min(0.45, 70 / D);
    for (let i = 1; i < n; i++) { const t = i / n; if (t < skip || t > 1 - skip) continue; if (d3.geoContains(land, f(t))) return false; }
    return true;
  }
  function links(P) {   // nearest waypoints reachable from P by a clear leg (fallback: the nearest one)
    const near = nodes.map((n, i) => [i, d3.geoDistance(P, n.p)]).sort((a, b) => a[1] - b[1]).slice(0, 10);
    const ok = near.filter(([i]) => clear(P, nodes[i].p)).slice(0, 4);
    return ok.length ? ok : near.slice(0, 1);
  }
  const cache = new Map();
  return function route(A, B) {
    const key = A.join() + "|" + B.join();
    if (cache.has(key)) return cache.get(key);
    let out = [A, B];
    if (!clear(A, B)) {
      const la = links(A), lb = new Map(links(B).map(([i, w]) => [i, w]));
      if (la.length && lb.size) {
        const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set();
        for (const [i, w] of la) dist[i] = w;
        while (true) {
          let u = -1, best = Infinity;
          for (let i = 0; i < nodes.length; i++) if (!done.has(i) && dist[i] < best) { best = dist[i]; u = i; }
          if (u < 0) break; done.add(u);
          for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
        }
        let end = -1, bestTot = Infinity;
        for (const [i, w] of lb) if (dist[i] + w < bestTot) { bestTot = dist[i] + w; end = i; }
        if (end >= 0) {
          const chain = []; for (let u = end; u >= 0; u = prev[u]) chain.unshift(nodes[u].p);
          out = [A, ...chain, B];
        }
      }
    }
    cache.set(key, out);
    return out;
  };
}
