'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReceipt } = require('../src/receipt');

const order = {
  id: 42,
  placedAt: '2026-10-31T23:59:00Z',
  items: [
    { name: 'Espresso', qty: 2, cents: 300 },
    { name: 'Ghost pepper croissant', qty: 1, cents: 450 },
  ],
};

test('renders a 40 column receipt with a zero padded order number', () => {
  const lines = renderReceipt(order).split('\n');
  assert.equal(lines[0], 'HAUNTED CAFE                   #00000042');
  assert.equal(lines[1], '2026-10-31 23:59 UTC');
  assert.equal(lines[2], '-'.repeat(40));
  assert.equal(lines[3], 'Espresso                    x2     $6.00');
  assert.equal(lines[4], 'Ghost pepper croissant      x1     $4.50');
  assert.equal(lines[6], 'TOTAL                             $10.50');
});

test('every line of the table has the same width', () => {
  for (const width of [24, 40, 60]) {
    const lines = renderReceipt(order, { width }).split('\n');
    for (const line of lines.slice(2)) assert.equal(line.length, width);
  }
});

test('fill pads the money column', () => {
  const lines = renderReceipt(order, { fill: '.' }).split('\n');
  assert.equal(lines[3].slice(-10), '.....$6.00');
});

test('rate converts prices and symbol is configurable', () => {
  const text = renderReceipt(order, { rate: 0.5, symbol: 'E' });
  assert.match(text, /E5\.25$/m);
});
