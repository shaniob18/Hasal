// Tests for the comparison logic (run: node --test tests)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// a tiny catalogue: [code, name, manufacturer, prices per store, promos per store, weighted, [size, kind, price-per-unit per store]]
function data() {
  return L.prepare({ stores: [{ name: 'A', addr: 'a' }, { name: 'B', addr: 'b' }, { name: 'C', addr: 'c' }], items: [
    ['111', 'חלב 3% 1 ליטר', 'תנובה', [7.2, 7.35, 7.0], [null, null, null], 0, [1000, 'ml', [0.0072, 0.00735, 0.007]]],
    ['222', 'קוטג 5% 250 גרם', 'תנובה', [5.9, 5.9, null], [['3 ב-15', 3, 5, '2099-01-01', 0], null, null], 0, [250, 'g', [0.0236, 0.0236, null]]],
    ['333', 'קוטג 5% 500 גרם', 'טרה', [null, null, 10.0], [null, null, null], 0, [500, 'g', [null, null, 0.02]]],
    ['444', 'עגבניה', '', [7.9, null, null], [null, null, null], 1, [null, null, [null, null, null]]],
    ['445', 'עגבניות', '', [null, 8.9, 6.9], [null, null, null], 1, [null, null, [null, null, null]]],
    ['555', 'במבה 80 גרם', 'אסם', [3.9, 3.5, null], [null, null, ['מועדון', 1, 2, '2099-01-01', 1]], 0, [80, 'g', [0.0487, 0.0437, null]]],
  ] });
}
const line = (o) => Object.assign({ name: 'x', qty: 1, unit: "יח'", guess: [false, false, false] }, o);

test('parseLine understands quantities and units', () => {
  assert.deepStrictEqual(L.parseLine('חלב 3%'), { name: 'חלב 3%', qty: 1, unit: "יח'" });
  assert.deepStrictEqual(L.parseLine('2 קרטוני ביצים'), { name: 'ביצים', qty: 2, unit: 'אריזה' });
  assert.deepStrictEqual(L.parseLine('1.5 ק"ג עגבניות'), { name: 'עגבניות', qty: 1.5, unit: 'ק"ג' });
  assert.deepStrictEqual(L.parseLine('עגבניות 500 גרם'), { name: 'עגבניות', qty: 500, unit: 'גרם' });
  assert.deepStrictEqual(L.parseLine('3 יח\' יוגורט'), { name: 'יוגורט', qty: 3, unit: "יח'" });
  assert.deepStrictEqual(L.parseLine('מים 2 ליטר'), { name: 'מים', qty: 2, unit: 'ליטר' });
});

test('search tolerates typos and Hebrew plurals', () => {
  const D = data();
  assert.strictEqual(L.search(D, 'קוטג תנובא')[0][0], '222');
  assert.ok(L.search(D, 'עגבניות', { store: 0 }).some(i => i[0] === '444'));
});

test('same barcode is exact, a different product is similar', () => {
  const D = data();
  const l = line({ codes: ['111', '111', '111'], ref: '111' });
  assert.strictEqual(L.priceAt(D, l, 0).status, 'exact');
  const g = line({ codes: ['111', '111', '111'], ref: '111', guess: [true, false, false] });
  assert.strictEqual(L.priceAt(D, g, 0).guess, true);
});

test('missing item is null, never zero', () => {
  const D = data();
  assert.strictEqual(L.priceAt(D, line({ codes: ['222', '222', null], ref: '222' }), 2), null);
});

test('similar product of another size is normalized by unit price', () => {
  const D = data();
  // 250g cottage at A/B, the 500g one at C: C should be priced as 250g x 0.02 = 5.00, not 10.00
  const p = L.priceAt(D, line({ codes: ['222', '222', '333'], ref: '222' }), 2);
  assert.strictEqual(p.status, 'similar');
  assert.ok(Math.abs(p.compareCost - 5) < 1e-9);
});

test('weighted items are priced per kg', () => {
  const D = data();
  const p = L.priceAt(D, line({ codes: ['444', '445', '445'], ref: '444', unit: 'ק"ג', qty: 1.5 }), 0);
  assert.ok(Math.abs(p.cost - 11.85) < 1e-9);
  const g = L.priceAt(D, line({ codes: ['444', '445', '445'], ref: '444', unit: 'גרם', qty: 500 }), 2);
  assert.ok(Math.abs(g.cost - 3.45) < 1e-9);
});

test('litre/gram quantities buy whole packs', () => {
  const D = data();
  const p = L.priceAt(D, line({ codes: ['111', '111', '111'], ref: '111', unit: 'ליטר', qty: 2.5 }), 0);
  assert.ok(Math.abs(p.cost - 3 * 7.2) < 1e-9); // 3 cartons of 1 litre
});

test('multi-buy promo applies only from the minimum quantity, club promos never', () => {
  const D = data();
  assert.strictEqual(L.priceAt(D, line({ codes: ['222', '222', null], ref: '222', qty: 2 }), 0).cost, 11.8);
  assert.strictEqual(L.priceAt(D, line({ codes: ['222', '222', null], ref: '222', qty: 3 }), 0).cost, 15);
  const club = L.priceAt(D, line({ codes: ['555', '555', '555'], ref: '555' }), 2);
  assert.strictEqual(club, null); // not sold at C at all
  const D2 = data(); D2.items[5][3][2] = 4; L.prepare(D2);
  const c2 = L.priceAt(D2, line({ codes: ['555', '555', '555'], ref: '555' }), 2);
  assert.strictEqual(c2.cost, 4); assert.strictEqual(c2.promo.club, true); assert.strictEqual(c2.promo.applied, false);
});

test('recommendation: fewest missing first, then cheapest; split and saving', () => {
  const D = data();
  const lines = [
    line({ name: 'חלב', codes: ['111', '111', '111'], ref: '111' }),   // A 7.2, B 7.35, C 7.0
    line({ name: 'במבה', codes: ['555', '555', null], ref: '555' }),   // A 3.9, B 3.5, C missing
  ];
  const c = L.compare(D, lines);
  assert.strictEqual(c.stores[2].missing.length, 1);
  assert.strictEqual(c.best.store.name, 'B');            // C is cheapest per item but misses one
  assert.ok(Math.abs(c.best.total - 10.85) < 1e-9);
  assert.ok(Math.abs(c.saving - (11.1 - 10.85)) < 1e-9); // vs the dearest store with the same coverage (A)
  assert.ok(Math.abs(c.split.total - (7.0 + 3.5)) < 1e-9);
  assert.deepStrictEqual(c.split.stores.sort(), [1, 2]);
  assert.deepStrictEqual(c.rows[0].cheapest, [false, false, true]);
});

test('categories by keyword', () => {
  assert.strictEqual(L.category('עגבניות'), 'ירקות ופירות');
  assert.strictEqual(L.category('קוטג 5%'), 'מוצרי חלב וביצים');
  assert.strictEqual(L.category('נייר טואלט'), 'ניקיון וחד פעמי');
  assert.strictEqual(L.category('משהו מוזר'), 'אחר');
});

test('money format', () => { assert.strictEqual(L.money(12.9), '₪12.90'); });
