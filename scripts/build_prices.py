"""Merge the 6 downloaded files (PriceFull + PromoFull for 3 branches) into prices.json for the app.
usage: python3 build_prices.py <data_dir> <out.json>
"""
import gzip, io, json, sys, zipfile, re, os, datetime
from pathlib import Path
import xml.etree.ElementTree as ET

STORES = [
    {"key": "osherad_009",   "name": "אושר עד",    "addr": "בעלי המלאכה 4, אשדוד"},
    {"key": "yohananof_005", "name": "יוחננוף",    "addr": "ז'בוטינסקי 27, סטאר סנטר"},
    {"key": "neto_197",      "name": "נטו חיסכון", "addr": "האורגים 13, אשדוד"},
]

def read_xml(path):
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    elif raw[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(raw)); raw = z.read(z.namelist()[0])
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        txt = raw.decode("utf-16")
    else:
        txt = raw.decode("utf-8-sig", errors="replace")
    txt = re.sub(r"^<\?xml[^>]*\?>", "", txt.lstrip())
    return ET.fromstring(txt)

def kids(el):  # case-insensitive child lookup
    return {c.tag.lower(): (c.text or "").strip() for c in el}

def num(s):
    try: return float(s)
    except (TypeError, ValueError): return None

def kind_factor(txt):
    """Map a unit text to (kind, factor to the base unit): grams or millilitres or units."""
    t = (txt or "").replace('"', "").replace("'", "").replace("״", "")
    if "קילו" in t or "קג" in t or "kg" in t.lower(): return "g", 1000.0
    if "גר" in t or "gr" in t.lower(): return "g", 1.0
    if "מל" in t or "מיליליטר" in t or "ml" in t.lower(): return "ml", 1.0
    if "ליטר" in t or t.strip() in ("ל", "ל."): return "ml", 1000.0
    return "u", 1.0

def size_info(k):
    """(pack size in base units, kind, price per base unit) or Nones."""
    kind, f = kind_factor(k.get("unitqty", ""))
    q = num(k.get("quantity"))
    size = q * f if q and q > 0 and kind != "u" else None
    um = k.get("unitofmeasure", "")
    ukind, uf = kind_factor(um)
    m = re.search(r"[\d.]+", um)
    base = (float(m.group()) if m else 1.0) * uf
    ump = num(k.get("unitofmeasureprice"))
    pu = round(ump / base, 5) if ump and ump > 0 and base > 0 and ukind != "u" and ukind == kind else None
    return size, kind, pu

def parse_prices(root):
    out = {}
    for it in root.iter():
        if it.tag.lower() != "item": continue
        k = kids(it)
        code = k.get("itemcode", "").lstrip("0") or k.get("itemcode", "")
        price = num(k.get("itemprice"))
        if not code or price is None or price <= 0: continue
        size, kind, pu = size_info(k)
        out[code] = {
            "size": size, "kind": kind, "pu": pu,
            "name": re.sub(r"\s+", " ", k.get("itemname", "")).strip(),
            "manu": k.get("manufacturername", "").strip(),
            "price": round(price, 2),
            "w": k.get("bisweighted", "0") in ("1", "1.0"),
            "qty": k.get("quantity", ""), "unit": k.get("unitqty", "") or k.get("unitofmeasure", ""),
        }
    return out

def parse_promos(root, prices, today):
    out = {}
    for p in root.iter():
        if p.tag.lower() != "promotion": continue
        k = kids(p)
        start, end = k.get("promotionstartdatetime", "")[:10], k.get("promotionenddatetime", "")[:10]
        if (start and start > today) or (end and end < today): continue
        club = not k.get("clubid", "0").strip().startswith("0")
        desc = k.get("promotiondescription", "")
        for pi in p.iter():
            if pi.tag.lower() != "promotionitem": continue
            q = kids(pi)
            code = q.get("itemcode", "").lstrip("0")
            if code not in prices: continue
            reg = prices[code]["price"]
            minq = num(q.get("minqty")) or 1.0
            dp = num(q.get("discountedprice"))
            if not dp or dp <= 0: continue
            # chains differ: DiscountedPrice is either a per-unit price or the total for MinQty units
            if minq > 1 and dp / minq < reg - 0.005: unit = dp / minq
            elif dp < reg - 0.005: unit = dp
            else: continue
            cur = out.get(code)
            rec = [desc, round(minq, 2), round(unit, 2), end, int(club)]
            # keep the best non-club promo; a club promo only if there is nothing else
            if cur is None or (cur[4] and not club) or (cur[4] == club and unit < cur[2]):
                out[code] = rec
    return out

def main(data_dir, out_path):
    today = datetime.date.today().isoformat()
    per_store, promos, missing = [], [], []
    for s in STORES:
        pf = os.path.join(data_dir, f"{s['key']}_PriceFull.gz")
        if not os.path.exists(pf):
            missing.append(s["key"]); per_store.append({}); promos.append({}); continue
        pr = parse_prices(read_xml(pf))
        per_store.append(pr)
        mf = os.path.join(data_dir, f"{s['key']}_PromoFull.gz")
        promos.append(parse_promos(read_xml(mf), pr, today) if os.path.exists(mf) else {})
    codes = sorted(set().union(*[p.keys() for p in per_store]))
    items = []
    for c in codes:
        recs = [p.get(c) for p in per_store]
        first = next(r for r in recs if r)
        name = max((r["name"] for r in recs if r), key=len)
        sz = next(((r["size"], r["kind"]) for r in recs if r and r["size"]), (None, None))
        items.append([c, name, first["manu"], [r["price"] if r else None for r in recs],
                      [promos[i].get(c) for i in range(3)], int(first["w"]),
                      [sz[0], sz[1], [r["pu"] if r else None for r in recs]]])
    upd = os.path.join(data_dir, "updated.txt")
    updated = open(upd).read().strip() if os.path.exists(upd) else today
    json.dump({"updated": updated, "stores": STORES, "missing": missing, "items": items},
              open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(items)} items; per store: {[len(p) for p in per_store]}; promos: {[len(p) for p in promos]}; missing: {missing}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
