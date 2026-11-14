// Pure logic for "הסל": parsing a quick-add line, typo-tolerant search, categories, pricing and comparison.
// Works in the browser (window.L) and in Node (module.exports) so it can be tested.
(function (root) {
  'use strict';

  // ---------- text ----------
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  function norm(s) {
    return String(s || '')
      .replace(/[׳'"`״]/g, '')
      .replace(/[ךםןףץ]/g, c => FINALS[c])
      .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // ---------- quick-add line: "2 קרטוני ביצים", "1.5 ק"ג עגבניות", "חלב 3%" ----------
  const UNIT_WORDS = [
    [/^(ק"ג|ק״ג|קג|קילו|קילוגרם)$/, 'ק"ג'],
    [/^(גרם|גר|ג'|ג)$/, 'גרם'],
    [/^(ליטר|ליטרים|ל'|ל)$/, 'ליטר'],
    [/^(מ"ל|מ״ל|מל)$/, 'מ"ל'],
    [/^(יח'|יח׳|יח|יחידה|יחידות)$/, "יח'"],
    [/^(אריזה|אריזות|קרטון|קרטונים|קרטוני|חבילה|חבילות|חבילת|שקית|שקיות|בקבוק|בקבוקים|בקבוקי|מארז|מארזים)$/, 'אריזה'],
  ];
  const UNITS = ["יח'", 'ק"ג', 'גרם', 'ליטר', 'מ"ל', 'אריזה'];
  function unitOf(word) {
    for (const [re, u] of UNIT_WORDS) if (re.test(word)) return u;
    return null;
  }
  function parseLine(text) {
    let words = String(text || '').trim().split(/\s+/).filter(Boolean);
    let qty = null, unit = null;
    const isNum = w => /^\d+([.,]\d+)?$/.test(w);
    const take = (i) => { qty = parseFloat(words[i].replace(',', '.')); words.splice(i, 1); };
    // number first: "2 קרטוני ביצים" / "1.5 ק"ג עגבניות"
    if (words.length > 1 && isNum(words[0])) {
      take(0);
      const u = words.length > 1 && unitOf(words[0]);
      if (u) { unit = u; words.splice(0, 1); }
    } else if (words.length > 2 && isNum(words[words.length - 2]) && unitOf(words[words.length - 1])) {
      // number + unit at the end: "עגבניות 1.5 ק"ג"
      unit = unitOf(words[words.length - 1]); words.pop(); take(words.length - 1);
    } else if (words.length > 1 && isNum(words[words.length - 1])) {
      // bare number at the end: "ביצים 2" (but never "חלב 3%": that has a % sign and isn't a pure number)
      take(words.length - 1);
    }
    if (!unit && words.length > 1) { const u = unitOf(words[0]); if (u && u !== 'אריזה') { unit = u; words.splice(0, 1); } }
    return { name: words.join(' '), qty: qty == null ? 1 : qty, unit: unit || "יח'" };
  }

  // ---------- categories (the price files carry none, so by keywords) ----------
  const CATS = [
    ['ירקות ופירות', /עגבני|מלפפו|בצל|תפוח|בננ|גזר|פלפל|חסה|אבוקדו|לימונ|תפוז|ענב|אבטיח|מלון|תות|קישוא|חציל|כרוב|ברוקולי|כרובית|שום|פטרוזיל|כוסבר|שמיר|נענע|תפא|בטטה|דלעת|סלק|אגס|שזיפ|אפרסק|קלמנטינ|אשכולית|פירות|ירקות|פטריות|תירס טרי/],
    ['מוצרי חלב וביצים', /חלב|גבינ|קוטג|יוגורט|לבנ|שמנת|חמאה|ביצים|ביצה|מעדנ|דנונה|מילקי|אשל|גיל |בולגרית|צפתית|מוצרל|פרמזן|לבן|יופלה|שוקו/],
    ['לחם ומאפים', /לחם|לחמני|פיתה|פיתות|חלה|באגט|טורטיי|מאפה|עוג|רוגלך|בורקס|קרואסון|פוקאצ/],
    ['בשר, עוף ודגים', /עוף|חזה|שניצל|כרעיים|שוקיים|כנפיים|בקר|טחון|סטייק|נקניק|פסטרמה|קבב|המבורגר|דג |דגים|סלמון|טונה|אמנון|בורי|הודו|כבד/],
    ['יבשים ושימורים', /אורז|פסטה|ספגטי|קמח|סוכר|מלח|שמן|קטניות|עדשים|חומוס|שעועית|תירס|שימור|רסק|קטשופ|מיונז|חרדל|רוטב|תבלין|פפריקה|כמון|פתיתים|קוסקוס|דגני|קורנפלקס|שיבולת|קפה|תה |דבש|ריבה|ממרח|טחינה|אבקת|מרק|קרקר|פירורי/],
    ['חטיפים ומתוקים', /במבה|ביסלי|חטיף|שוקולד|עוגיות|ופל|סוכרי|מסטיק|צ'יפס|ציפס|דוריטוס|קרמבו|גלידה|פופקורן|בייגלה/],
    ['משקאות', /מים|סודה|קולה|ספרייט|מיץ|משקה|בירה|יין|פריגת|תפוזינה|נביעות|שוופס|אנרגיה|וודקה|וויסקי/],
    ['ניקיון וחד פעמי', /נייר|טואלט|מגבו|סבון כלים|אבקת כביסה|ג'ל כביסה|מרכך כביסה|אקונומיקה|נוזל|ספוג|שקיות אשפה|שקית|כוסות|צלחות|סכו"ם|סכום|נייר כסף|ניילון|מטהר|סנו|פיירי|מגבונים לחים|כביסה/],
    ['טיפוח ותינוקות', /שמפו|מרכך שיער|סבון|דאודורנט|משחת שיניים|מברשת|חיתול|מגבונים|קרם|תחבושות|גילוח|האגיס|פמפרס|מטרנה|סימילאק/],
    ['קפואים', /קפוא|קפואה|קפואים|פיצה|שעועית ירוקה|אפונה/],
  ];
  const CAT_ORDER = CATS.map(c => c[0]).concat(['אחר']);
  function category(name) {
    const n = ' ' + String(name || '') + ' ';
    for (const [c, re] of CATS) if (re.test(n)) return c;
    return 'אחר';
  }

  // ---------- search (typo-tolerant) ----------
  function prepare(data) {
    data.by = new Map();
    for (const it of data.items) {
      it.hay = norm(it[1] + ' ' + (it[2] || ''));
      it.words = it.hay.split(' ');
      data.by.set(it[0], it);
    }
    return data;
  }
  function deletions(w) { const out = []; for (let i = 0; i < w.length; i++) out.push(w.slice(0, i) + w.slice(i + 1)); return out; }
  // how well a query word fits an item: 3 = word starts with it, 2 = contained, 1 = one typo away, 0 = no
  function wordScore(q, it) {
    let best = 0;
    for (const w of it.words) {
      if (w === q) return 4;
      if (w.startsWith(q)) return 3;
      if (w.includes(q)) best = Math.max(best, 2);
    }
    if (best) return best;
    // Hebrew plural -> singular: עגבניות/עגבניה, מלפפונים/מלפפון
    if (q.length >= 4 && /(ות|ימ|י)$/.test(q)) {   // text is normalized: final ם is already מ
      const st = q.replace(/(ות|ימ|י)$/, '');
      for (const w of it.words) if (w.startsWith(st) && w.length <= st.length + 2) return 4;
      for (const w of it.words) if (w.startsWith(st)) return 2;
    }
    if (q.length < 3 || /\d/.test(q)) return 0;
    const dq = deletions(q);
    for (const w of it.words) {
      if (w.length < 3) continue;
      // one letter missing, extra, or swapped
      if (dq.some(d => w.startsWith(d) || w.includes(d))) return 1;
      if (deletions(w).some(d => d.startsWith(q) || d === q)) return 1;
      if (dq.some(d => deletions(w).includes(d))) return 1;
    }
    return 0;
  }
  function search(data, q, opts) {
    opts = opts || {};
    const words = norm(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    const res = [];
    for (const it of data.items) {
      if (opts.store != null && it[3][opts.store] == null) continue;
      let s = 0, miss = 0;
      for (const w of words) { const ws = wordScore(w, it); if (!ws) { miss++; if (miss > (words.length >= 3 ? 1 : 0)) break; } s += ws; }
      if (miss > (words.length >= 3 ? 1 : 0)) continue;
      const have = it[3].filter(p => p != null).length;
      const first = it.words[0] && wordScore(words[0], { words: [it.words[0]] }) >= 3 ? 4 : 0;
      const wb = opts.weighted == null ? 0 : (!!it[5] === opts.weighted ? 6 : -4);
      res.push([it, s * 3 + first + have * 2 + wb - miss * 6 - it[1].length / 8]);
    }
    res.sort((a, b) => b[1] - a[1]);
    return res.slice(0, opts.limit || 30).map(r => r[0]);
  }

  // Guess a product per store for a typed name. Prefer one barcode carried by as many stores as possible.
  function guess(data, name, unit) {
    const n = data.stores.length;
    const produce = unit === 'ק"ג' || unit === 'גרם' || category(name) === 'ירקות ופירות';
    const weighted = produce ? true : null;
    const top = search(data, name, { limit: 6, weighted });
    if (!top.length) return { codes: Array(n).fill(null), guess: Array(n).fill(false), ref: null };
    // packaged goods: the best-ranked result sold in the most stores (same barcode everywhere).
    // fresh produce has a different internal code in every chain, so take the best match per store.
    const most = Math.max(...top.map(t => t[3].filter(p => p != null).length));
    const ref = produce ? top[0] : top.find(t => t[3].filter(p => p != null).length === most);
    const codes = [], g = [];
    for (let i = 0; i < n; i++) {
      if (produce) { const own = search(data, name, { store: i, limit: 1, weighted })[0]; codes.push(own ? own[0] : null); g.push(true); continue; }
      if (ref[3][i] != null) { codes.push(ref[0]); g.push(true); continue; }
      // missing there: look for the closest product to the reference, then to what was typed
      const alt = search(data, ref[1], { store: i, limit: 1, weighted: !!ref[5] })[0] || search(data, name, { store: i, limit: 1, weighted })[0];
      codes.push(alt ? alt[0] : null); g.push(true);
    }
    return { codes, guess: g, ref: ref[0] };
  }

  // ---------- pricing ----------
  // How many sellable units of product `it` cover the line's quantity.
  function unitsFor(line, it) {
    const q = +line.qty || 0;
    const weighted = !!it[5];
    const toBase = { 'ק"ג': ['g', 1000], 'גרם': ['g', 1], 'ליטר': ['ml', 1000], 'מ"ל': ['ml', 1] }[line.unit];
    if (weighted) {                       // price is per kg
      if (line.unit === 'גרם') return q / 1000;
      return q;                           // ק"ג, or a plain count treated as kg
    }
    const size = it[6] && it[6][0], kind = it[6] && it[6][1];
    if (toBase && size && kind === toBase[0]) return Math.max(1, Math.ceil((q * toBase[1]) / size - 1e-9));
    return q;
  }
  // Cost of a line at store si. status: 'exact' (same barcode as the reference), 'similar', or null when missing.
  function priceAt(data, line, si) {
    const code = line.codes && line.codes[si];
    const it = code && data.by.get(code);
    if (!it || it[3][si] == null) return null;
    const reg = it[3][si];
    const units = unitsFor(line, it);
    const pr = it[4] && it[4][si];
    let cost = units * reg, promo = null;
    if (pr) {
      promo = { text: pr[0], club: !!pr[4], applied: false };
      if (!pr[4] && units >= pr[1] - 1e-9 && pr[2] < reg) { cost = units * pr[2]; promo.applied = true; }
    }
    const ref = line.ref && data.by.get(line.ref);
    const exact = !!ref && ref[0] === it[0] && !(line.guess && line.guess[si]);
    const similar = !exact;
    // a similar product of a different size: compare by price per gram / ml for the reference pack size
    let normalized = null;
    if (ref && ref[0] !== it[0] && ref[6] && it[6] && ref[6][0] && it[6][1] === ref[6][1] && it[6][2] && it[6][2][si] && !it[5] && !ref[5]) {
      const refUnits = unitsFor(line, ref);
      normalized = refUnits * ref[6][0] * it[6][2][si];
    }
    return { cost, reg: units * reg, promo, name: it[1], code: it[0], status: exact ? 'exact' : 'similar',
             guess: !!(line.guess && line.guess[si]), normalized, compareCost: normalized != null ? normalized : cost };
  }

  // ---------- comparison ----------
  function compare(data, lines) {
    const n = data.stores.length;
    const stores = data.stores.map((s, i) => ({ i, store: s, total: 0, missing: [], guesses: 0, saved: 0 }));
    const rows = lines.map(line => {
      const cells = [];
      for (let i = 0; i < n; i++) {
        const p = priceAt(data, line, i);
        cells.push(p);
        if (!p) { stores[i].missing.push(line.name); continue; }
        stores[i].total += p.compareCost;
        stores[i].saved += p.reg - p.cost > 0 && p.normalized == null ? p.reg - p.cost : 0;
        if (p.guess || p.status === 'similar') stores[i].guesses++;
      }
      const have = cells.filter(Boolean);
      const min = have.length ? Math.min(...have.map(c => c.compareCost)) : null;
      return { line, cells, min, cheapest: cells.map(c => !!c && Math.abs(c.compareCost - min) < 0.005) };
    });
    // best = fewest missing items, then lowest total
    const ranked = stores.slice().sort((a, b) => (a.missing.length - b.missing.length) || (a.total - b.total));
    const best = lines.length ? ranked[0] : null;
    const comparable = stores.filter(s => s.missing.length === (best ? best.missing.length : 0));
    const worst = comparable.reduce((a, b) => (b.total > a.total ? b : a), comparable[0] || null);
    // smart split: each line at its cheapest store
    let split = 0, splitStores = new Set(), splitMissing = 0;
    for (const r of rows) {
      let bi = -1, bc = Infinity;
      r.cells.forEach((c, i) => { if (c && c.compareCost < bc) { bc = c.compareCost; bi = i; } });
      if (bi < 0) splitMissing++; else { split += bc; splitStores.add(bi); }
    }
    return { stores, ranked, rows, best, worst, saving: best && worst ? worst.total - best.total : 0,
             split: { total: split, stores: [...splitStores], missing: splitMissing,
                      saving: best ? best.total - split : 0 } };
  }

  function money(n) { return '₪' + (Math.round((+n || 0) * 100) / 100).toFixed(2); }
  function sizeLabel(it) {
    const s = it && it[6]; if (!s || !s[0]) return '';
    if (s[1] === 'g') return s[0] >= 1000 ? (+(s[0] / 1000).toFixed(2)) + ' ק"ג' : Math.round(s[0]) + ' גרם';
    if (s[1] === 'ml') return s[0] >= 1000 ? (+(s[0] / 1000).toFixed(2)) + ' ליטר' : Math.round(s[0]) + ' מ"ל';
    return '';
  }

  const L = { norm, parseLine, UNITS, category, CAT_ORDER, prepare, search, guess, unitsFor, priceAt, compare, money, sizeLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
