"""Builds data/history.json: weekly USNI positions per ship for the last ~45 days.
Positions are approximate: a representative point in the named sea/port, with a
small per-ship offset so ships sharing an area don't sit on top of each other."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
cur = json.load(open(os.path.join(HERE, "data/usni.json")))

AREAS = {  # key: (label, lat, lon, is_port)
    "sasebo": ("Sasebo, Japan (in port)", 33.16, 129.72, True),
    "yokosuka": ("Yokosuka, Japan (port visit)", 35.29, 139.67, True),
    "seaofjapan": ("Sea of Japan", 39.0, 134.0, False),
    "philippine": ("Philippine Sea", 21.0, 131.0, False),
    "keensword": ("Philippine Sea (Exercise Keen Sword)", 24.5, 132.0, False),
    "scs": ("South China Sea", 14.0, 114.0, False),
    "pac7": ("Western Pacific, westbound (7th Fleet)", 22.0, 152.0, False),
    "pac3": ("Eastern Pacific, westbound (3rd Fleet)", 24.0, -140.0, False),
    "pacW": ("Central Pacific, westbound after Hawaii", 24.0, 176.0, False),
    "pacE": ("Eastern Pacific, outbound from San Diego", 27.0, -128.0, False),
    "pearl": ("Pearl Harbor, Hawaii (port visit)", 21.35, -157.95, True),
    "carib": ("Central Caribbean Sea", 15.5, -74.5, False),
    "norfolk": ("Norfolk, Va. (in port)", 36.95, -76.33, True),
    "watl": ("Western Atlantic", 35.5, -72.0, False),
    "med": ("Mediterranean Sea", 35.0, 19.0, False),
    "rota": ("Rota, Spain (in port)", 36.62, -6.35, True),
    "red": ("Red Sea", 18.5, 39.8, False),
    "arabian": ("Arabian Sea", 17.5, 62.5, False),
    "region": ("Middle East region (exact sea not reported)", 17.0, 63.0, False),
    "phuket": ("Phuket, Thailand (port visit)", 7.88, 98.39, True),
    "indian": ("Indian Ocean", 4.5, 76.0, False),
    "andaman": ("Andaman Sea (after Singapore visit)", 10.0, 96.0, False),
    "laccadive": ("Indian Ocean, near the Laccadive Sea", 10.0, 73.5, False),
}

# Which area each current-week ship's position is measured from (to derive its offset)
CUR_AREA = {"Arabian Sea": "arabian", "Middle East region": "region", "Red Sea": "red",
            "Indian Ocean": "indian", "Philippine Sea": "philippine", "Mediterranean": "med",
            "Central Caribbean": "carib"}

S = {  # short key -> full name used in usni.json
    "GW": "USS George Washington (CVN-73)", "Shoup": "USS Shoup (DDG-86)", "Ross": "USS Ross (DDG-71)",
    "GHWB": "USS George H.W. Bush (CVN-77)", "Cook": "USS Donald Cook (DDG-75)",
    "TR": "USS Theodore Roosevelt (CVN-71)", "Chosin": "USS Chosin (CG-65)",
    "PH": "USS Paul Hamilton (DDG-60)", "Decatur": "USS Decatur (DDG-73)", "Seahawk": "MUSV Seahawk",
    "Milius": "USS Milius (DDG-69)", "JPJ": "USS John Paul Jones (DDG-53)",
    "Peralta": "USS Rafael Peralta (DDG-115)", "Finn": "USS John Finn (DDG-113)",
    "Levin": "USS Carl M. Levin (DDG-120)", "Mason": "USS Mason (DDG-87)",
    "Princeton": "USS Princeton (CG-59)", "WM": "USS Wayne E. Meyer (DDG-108)",
    "MK": "USS Miguel Keith (ESB-5)", "Dunham": "USS Jason Dunham (DDG-109)",
    "Gonzalez": "USS Gonzalez (DDG-66)", "Boxer": "USS Boxer (LHD-4)", "Mustin": "USS Mustin (DDG-89)",
    "Makin": "USS Makin Island (LHD-8)", "Tripoli": "USS Tripoli (LHA-7)",
    "Whitney": "USS Mount Whitney (LCC-20)", "OA": "USS Oscar Austin (DDG-79)",
    "Bulkeley": "USS Bulkeley (DDG-84)", "Ignatius": "USS Paul Ignatius (DDG-117)",
    "Stout": "USS Stout (DDG-55)", "MSP": "USS Minneapolis-Saint Paul (LCS-21)", "Nimitz": "USS Nimitz (CVN-68)",
}
TR_GROUP = ["TR", "Chosin", "PH", "Decatur", "Seahawk"]
ARAB = ["GW", "Shoup", "Ross", "GHWB", "Cook"]

def wk(**areas):
    out = {}
    for area, ships in areas.items():
        for s in ships:
            out[s] = area
    return out

WEEKS = [
    ("2026-10-05", "https://news.usni.org/2026/10/05/usni-news-fleet-and-marine-tracker-oct-5-2026", wk(
        sasebo=["Tripoli"], phuket=["GHWB"], arabian=["GW", "Shoup", "Ross", "Cook", "Boxer"],
        pac3=TR_GROUP + ["Levin"], pacE=["Makin"],
        region=["Milius", "JPJ", "Peralta", "Finn", "MK"], indian=["Mustin", "Princeton"],
        red=["Dunham", "Gonzalez", "OA"], rota=["Bulkeley", "Stout"], carib=["MSP"], norfolk=["Nimitz"])),
    ("2026-10-13", "https://news.usni.org/2026/10/13/usni-news-fleet-and-marine-tracker-oct-13-2026", wk(
        sasebo=["Tripoli"], pac7=TR_GROUP, pearl=["Makin"], carib=["MSP"], med=["OA"],
        red=["Dunham", "Gonzalez"], arabian=ARAB + ["Boxer"],
        region=["Milius", "JPJ", "Peralta", "Finn", "MK", "Levin"],
        indian=["Mustin", "Princeton", "WM"], norfolk=["Nimitz"])),
    ("2026-10-19", "https://news.usni.org/2026/10/19/usni-news-fleet-and-marine-tracker-oct-19-2026", wk(
        sasebo=["Tripoli"], yokosuka=TR_GROUP, pacW=["Makin"], carib=["MSP"],
        med=["OA", "Bulkeley", "Stout"], red=["Dunham", "Gonzalez"], arabian=ARAB + ["Boxer"],
        region=["Milius", "JPJ", "Peralta", "Finn", "Levin", "WM", "MK"],
        indian=["Mustin", "Princeton"])),
    ("2026-10-26", "https://news.usni.org/2026/10/26/usni-news-fleet-and-marine-tracker-oct-26-2026", wk(
        sasebo=["Tripoli"], yokosuka=["Makin"], keensword=TR_GROUP, carib=["MSP"],
        med=["OA", "Bulkeley", "Stout"], red=["Dunham", "Gonzalez"], arabian=ARAB + ["Boxer"],
        region=["Milius", "JPJ", "Peralta", "Finn", "Levin", "Mason", "Princeton", "WM", "MK"],
        indian=["Mustin"])),
    ("2026-11-02", "https://news.usni.org/2026/11/02/usni-news-fleet-and-marine-tracker-nov-2-2026", wk(
        sasebo=["Tripoli"], yokosuka=["Makin"], scs=TR_GROUP, carib=["MSP"],
        med=["OA", "Bulkeley", "Stout"], red=["Dunham", "Gonzalez"], arabian=ARAB,
        region=["Milius", "JPJ", "Peralta", "Finn", "Levin", "Mason", "Princeton", "WM", "MK"],
        indian=["Boxer", "Mustin"], watl=["Nimitz"])),
    ("2026-11-09", "https://news.usni.org/2026/11/09/usni-news-fleet-and-marine-tracker-nov-9-2026", wk(
        sasebo=["Tripoli"], seaofjapan=["Makin"], carib=["MSP"],
        med=["OA", "Bulkeley", "Ignatius", "Stout"], red=["Dunham", "Gonzalez"], arabian=ARAB,
        region=["Milius", "JPJ", "Peralta", "Finn", "Levin", "Mason", "Princeton", "WM", "MK"],
        andaman=TR_GROUP, laccadive=["Boxer"], indian=["Mustin"], watl=["Nimitz"])),
]

def clamp(v, m):
    return max(-m, min(m, v))

by_name = {s["name"]: s for s in cur["ships"]}
history = {}
for key, full in S.items():
    ship = by_name[full]
    ca = CUR_AREA.get(ship["area"])
    if ca and not AREAS[ca][3]:
        dlat = clamp(ship["lat"] - AREAS[ca][1], 1.5)
        dlon = clamp(ship["lon"] - AREAS[ca][2], 1.8)
    else:
        h = sum(ord(c) for c in key)
        dlat, dlon = ((h % 7) - 3) * 0.35, ((h // 7 % 7) - 3) * 0.45
    pts = []
    for date, url, weekmap in WEEKS:
        a = weekmap.get(key)
        if not a:
            continue
        label, lat, lon, port = AREAS[a]
        if not port:
            lat, lon = lat + dlat, lon + dlon
        if a == "red":  # keep inside the narrow Red Sea
            lat, lon = 18.5 + clamp(dlat, 1.5), 39.8 + clamp(dlon * 0.4, 0.6)
        pts.append({"date": date, "area": label, "lat": round(lat, 2), "lon": round(lon, 2), "src": url})
    pts.append({"date": cur["asOf"], "area": ship["area"], "lat": ship["lat"], "lon": ship["lon"], "src": cur["sourceUrl"]})
    history[full] = pts

out = {"from": WEEKS[0][0], "to": cur["asOf"],
       "note": "Weekly approximate positions from USNI News Fleet and Marine Trackers. Gaps mean the ship was not listed that week.",
       "ships": history}
json.dump(out, open(os.path.join(HERE, "data/history.json"), "w"), indent=1)
print(len(history), "ships;", sum(len(v) for v in history.values()), "points")
for k in ["USS Theodore Roosevelt (CVN-71)", "USS Makin Island (LHD-8)"]:
    print(k, [(p["date"], p["area"]) for p in history[k]])
