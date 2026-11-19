# US Navy Fleet Tracker ("Fleet Command")

A tactical-HUD map of U.S. Navy ships, live AIS sightings, ground deployments, bases, allied forces and warships, plus a live Pensacola sector view with an NAS Pensacola base map.

Live page: https://claude.ai/artifact/SurshG4Mn7j15AdAx4aK8p (a Claude artifact; the live layers load through the Supabase connector).

## Layout
- `index.html` — the whole app (d3 + world-atlas, single module script).
- `sealanes.js` — sea-lane waypoint graph used to route ship tracks around land (inlined into `index.html`).
- `data/` — weekly data refreshed by a scheduled task every Monday:
  - `usni.json`, `history.json`, `specs.json` — U.S. ship positions (USNI News Fleet Tracker), 45-day history, ship specs
  - `deployments.json`, `bases.json`, `allies.json`, `allied_ships.json` — ground deployments, U.S. bases, NATO battlegroups/allied bases, allied warships
  - `pensacola.json` — Pensacola sites, water labels, base news and NAS Pensacola points of interest
- `supabase/` — Supabase project `navy-fleet-tracker` (ref `jpuzfptdrlotbsgsiphs`):
  - `functions/navy-ais-sampler` — every 10 min, samples aisstream.io for U.S. Navy/MSC and allied warships
  - `functions/pensacola-watch` — every 10 min, logs Pensacola-area vessels (AIS) and military aircraft (adsb.lol)
  - `functions/pns-basemap` — builds the NAS Pensacola / Corry Station base map from OpenStreetMap (run on demand)
  - `config.toml` — project link for the Supabase CLI / GitHub integration
- `.github/workflows/deploy-supabase-functions.yml` — redeploys the functions when they change on `main` (needs the `SUPABASE_ACCESS_TOKEN` repo secret).
- `build_history.py` — one-off script that built `history.json` from past USNI trackers.

API keys live in the Supabase Vault, never in this repo.

Map data © OpenStreetMap contributors (ODbL). Positions are approximate and drawn from public sources.
