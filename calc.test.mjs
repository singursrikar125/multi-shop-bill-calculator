import assert from 'node:assert/strict';
import * as c from '../js/calc.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('present total = SUM(qty*rate)', () => assert.equal(c.presentTotal([{ qty: 100, rate: 100 }, { qty: 10, rate: 150 }]), 11500));
t("today's due example (11500 - 5000 - 1000 = 5500)", () => assert.equal(c.todaysDue(11500, 5000, 1000), 5500));
t('ledger: Kangti Shop 10 example → 20,600', () => {
  const L = c.ledgerFor(19200, [{ id: 'b1', date: '2026-10-22', seq: 1, billNo: 'INV-1', presentTotal: 6400, cash: 0, upi: 0, oldPaidCash: 5000, oldPaidUpi: 0 }]);
  assert.equal(L.perBill.b1.prevDue, 19200); assert.equal(L.perBill.b1.todaysDue, 6400);
  assert.equal(L.perBill.b1.remaining, 20600); assert.equal(L.balance, 20600);
  assert.equal(19200 - 5000, 14200);
});
t('old due payment is not sales and not double counted', () => {
  const bills = [
    { id: 'a', date: '2026-10-20', seq: 1, presentTotal: 1000, cash: 0, upi: 0 },
    { id: 'b', date: '2026-10-21', seq: 2, presentTotal: 500, cash: 500, upi: 0, oldPaidCash: 300, oldPaidUpi: 200 },
  ];
  const L = c.ledgerFor(0, bills);
  assert.equal(L.perBill.b.prevDue, 1000); assert.equal(L.perBill.b.remaining, 500);
  const s = c.sumBills(bills, b => L.perBill[b.id]);
  assert.equal(s.present, 1500); assert.equal(s.oldPaid, 500); assert.equal(s.cash, 500);
});
t('delete/edit recalculates (ledger derived from remaining bills)', () => {
  const a = { id: 'a', date: '2026-10-20', seq: 1, presentTotal: 1000, cash: 0, upi: 0 };
  const b = { id: 'b', date: '2026-10-21', seq: 2, presentTotal: 500, cash: 0, upi: 0 };
  assert.equal(c.ledgerFor(0, [a, b]).perBill.b.prevDue, 1000);
  assert.equal(c.ledgerFor(0, [b]).perBill.b.prevDue, 0);
  assert.equal(c.ledgerFor(0, [{ ...a, presentTotal: 400 }, b]).perBill.b.prevDue, 400);
});
t('validation', () => {
  const ok = { date: '2026-10-22', shopId: 's', items: [{ itemId: 'i', qty: 10, rate: 10 }], cash: 50, upi: 50 };
  assert.deepEqual(c.validateBill(ok, 0), []);
  assert.ok(c.validateBill({ ...ok, cash: -1 }, 0).length);
  assert.ok(c.validateBill({ ...ok, cash: 80, upi: 50 }, 0).length);            // overpay current bill
  assert.ok(c.validateBill({ ...ok, oldPaidCash: 10 }, 0).length);               // old paid > prev
  assert.deepEqual(c.validateBill({ ...ok, oldPaidCash: 10 }, 10), []);
  assert.ok(c.validateBill({ ...ok, items: [] , cash:0, upi:0}, 0).length);
});
t('stock example: 10 + 100 - 60 - 2 = 48', () => {
  const items = [{ id: 'k', openingStock: 10 }];
  const stock = [{ itemId: 'k', date: '2026-10-22', loaded: 100, damaged: 2 }];
  const bills = [{ date: '2026-10-22', items: [{ itemId: 'k', qty: 60 }] }];
  const r = c.stockRowsForDate(items, c.stockIndex(items, stock, bills), '2026-10-22')[0];
  assert.equal(r.remaining, 48); assert.equal(r.sold, 60);
  const next = c.stockRowsForDate(items, c.stockIndex(items, stock, bills), '2026-10-23')[0];
  assert.equal(next.opening, 48);
});
t('stock: edit does not double count; negative detection', () => {
  const items = [{ id: 'k', openingStock: 0 }];
  const stock = [{ itemId: 'k', date: '2026-10-22', loaded: 50, damaged: 0 }];
  const orig = { id: 'x', date: '2026-10-22', items: [{ itemId: 'k', qty: 40 }] };
  const edited = { ...orig, items: [{ itemId: 'k', qty: 45 }] };
  const sim = [edited]; // old version REPLACED, not added
  assert.equal(c.stockRowsForDate(items, c.stockIndex(items, stock, sim), '2026-10-22')[0].remaining, 5);
  assert.equal(c.firstNegative(items, stock, [{ ...orig, items: [{ itemId: 'k', qty: 60 }] }], ['k'], '2026-10-22').remaining, -10);
  assert.equal(c.firstNegative(items, stock, sim, ['k'], '2026-10-22'), null);
});
t('date presets', () => {
  const now = new Date(2026, 9, 22); // Thu 22 Oct 2026
  assert.deepEqual(c.dateRange('week', {}, now), { from: '2026-10-19', to: '2026-10-22' });
  assert.deepEqual(c.dateRange('month', {}, now), { from: '2026-10-01', to: '2026-10-22' });
  assert.deepEqual(c.dateRange('yesterday', {}, now), { from: '2026-10-21', to: '2026-10-21' });
});
t('INR formatting', () => assert.equal(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(123456), '₹1,23,456.00'));
console.log(`\n${n} tests passed`);
