"""Tests for reading the chains' XML price files (run: python -m unittest discover tests)."""
import gzip, json, os, sys, tempfile, unittest, datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_prices as bp

TODAY = datetime.date.today()
FUTURE = (TODAY + datetime.timedelta(days=30)).isoformat()
PAST = (TODAY - datetime.timedelta(days=30)).isoformat()

def item(code, name, price, weighted=0, qty="250", unit="גרם", um="100 גרם", ump="2.36", upper=False):
    x = (f"<Item><ItemCode>{code}</ItemCode><ItemName>{name}</ItemName><ItemPrice>{price}</ItemPrice>"
         f"<bIsWeighted>{weighted}</bIsWeighted><Quantity>{qty}</Quantity><UnitQty>{unit}</UnitQty>"
         f"<UnitOfMeasure>{um}</UnitOfMeasure><UnitOfMeasurePrice>{ump}</UnitOfMeasurePrice></Item>")
    return x.upper() if upper else x

def promo(code, desc, minq, dp, club="0", start=PAST, end=FUTURE):
    return (f"<Promotion><PromotionDescription>{desc}</PromotionDescription>"
            f"<PromotionStartDateTime>{start}T00:00:00</PromotionStartDateTime><PromotionEndDateTime>{end}T00:00:00</PromotionEndDateTime>"
            f"<ClubID>{club}</ClubID><Groups><Group><PromotionItems><PromotionItem><ItemCode>{code}</ItemCode>"
            f"<MinQty>{minq}</MinQty><DiscountedPrice>{dp}</DiscountedPrice></PromotionItem></PromotionItems></Group></Groups></Promotion>")

def write(path, xml, enc="utf-8", gz=True):
    data = xml.encode(enc) if enc != "utf-16" else ("﻿" + xml).encode("utf-16-le")
    Path(path).write_bytes(gzip.compress(data) if gz else data)

class ReadXml(unittest.TestCase):
    def setUp(self): self.d = tempfile.mkdtemp()
    def test_utf8_gzip(self):
        p = os.path.join(self.d, "a.gz"); write(p, "<root><Items>" + item("7290000066318", "במבה", "3.90") + "</Items></root>")
        self.assertEqual(bp.parse_prices(bp.read_xml(p))["7290000066318"]["price"], 3.9)
    def test_utf16_with_xml_declaration(self):
        p = os.path.join(self.d, "b.gz")
        write(p, '<?xml version="1.0" encoding="utf-16"?><Root><Items>' + item("123456789", "קוטג", "5.90") + "</Items></Root>", enc="utf-16")
        self.assertEqual(bp.parse_prices(bp.read_xml(p))["123456789"]["name"], "קוטג")
    def test_uppercase_tags_and_plain_xml(self):
        p = os.path.join(self.d, "c.xml"); write(p, "<ROOT><ITEMS>" + item("55555555", "SOAP", "9.90", upper=True) + "</ITEMS></ROOT>", gz=False)
        self.assertIn("55555555", bp.parse_prices(bp.read_xml(p)))
    def test_skips_zero_price_and_strips_leading_zeros(self):
        p = os.path.join(self.d, "d.gz"); write(p, "<r>" + item("0071234", "x", "0") + item("0081234", "y", "2.5") + "</r>")
        pr = bp.parse_prices(bp.read_xml(p)); self.assertNotIn("71234", pr); self.assertIn("81234", pr)
    def test_size_and_unit_price(self):
        size, kind, pu = bp.size_info({"quantity": "250", "unitqty": "גרם", "unitofmeasure": "100 גרם", "unitofmeasureprice": "2.36"})
        self.assertEqual((size, kind), (250.0, "g")); self.assertAlmostEqual(pu, 0.0236)
        size, kind, pu = bp.size_info({"quantity": "1.5", "unitqty": "ליטר", "unitofmeasure": "100 מ\"ל", "unitofmeasureprice": "0.72"})
        self.assertEqual((size, kind), (1500.0, "ml"))

class Promos(unittest.TestCase):
    def run_promos(self, *promos_xml, price="10"):
        d = tempfile.mkdtemp(); p = os.path.join(d, "p.gz")
        write(p, "<Root><Promotions>" + "".join(promos_xml) + "</Promotions></Root>")
        prices = {"111": {"price": float(price)}}
        return bp.parse_promos(bp.read_xml(p), prices, TODAY.isoformat())
    def test_multi_buy_total_becomes_unit_price(self):
        self.assertEqual(self.run_promos(promo("111", "3 ב-24", 3, 24))["111"][2], 8.0)
    def test_unit_discount(self):
        self.assertEqual(self.run_promos(promo("111", "ב-7.90", 1, 7.9))["111"][2], 7.9)
    def test_expired_and_future_ignored(self):
        self.assertEqual(self.run_promos(promo("111", "old", 1, 5, end=PAST), promo("111", "soon", 1, 5, start=FUTURE)), {})
    def test_club_only_is_flagged_and_loses_to_public(self):
        r = self.run_promos(promo("111", "club", 1, 6, club="3 - מועדון"))["111"]; self.assertEqual(r[4], 1)
        r = self.run_promos(promo("111", "club", 1, 6, club="3"), promo("111", "all", 1, 8))["111"]; self.assertEqual((r[0], r[4]), ("all", 0))
    def test_not_cheaper_is_ignored(self):
        self.assertEqual(self.run_promos(promo("111", "fake", 1, 12)), {})

class EndToEnd(unittest.TestCase):
    def test_merge_three_stores(self):
        d = tempfile.mkdtemp()
        rows = {"osherad_009": [item("7290000066318", "במבה 80 גרם", "3.9")],
                "yohananof_005": [item("7290000066318", "במבה קלאסי 80 ג", "4.2"), item("406169", "עגבניה", "7.9", weighted=1)],
                "neto_197": []}
        for k, its in rows.items():
            write(os.path.join(d, f"{k}_PriceFull.gz"), "<r>" + "".join(its) + "</r>")
        write(os.path.join(d, "osherad_009_PromoFull.gz"), "<r>" + promo("7290000066318", "2 ב-7", 2, 7) + "</r>")
        out = os.path.join(d, "prices.json"); bp.main(d, out)
        data = json.load(open(out, encoding="utf-8"))
        by = {i[0]: i for i in data["items"]}
        self.assertEqual(by["7290000066318"][3], [3.9, 4.2, None])
        self.assertEqual(by["7290000066318"][4][0][2], 3.5)
        self.assertEqual(by["406169"][5], 1)
        self.assertEqual(data["missing"], [])

if __name__ == "__main__":
    unittest.main()
