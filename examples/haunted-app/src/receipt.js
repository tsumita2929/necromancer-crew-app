'use strict';

const leftPad = require('left-pad');
const moment = require('moment');

const QTY_WIDTH = 4;
const PRICE_WIDTH = 10;

function money(cents, symbol) {
  return symbol + (cents / 100).toFixed(2);
}

function padRight(text, width) {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

/**
 * Render an order as a fixed-width text receipt.
 *
 * order:   { id: number, placedAt: ISO string, items: [{ name, qty, cents }] }
 * options: width (columns, default 40), fill (padding character for the money
 *          column, default a space), symbol (default "$"), rate (multiplier
 *          applied to prices, default 1)
 */
function renderReceipt(order, options) {
  const opts = options || {};
  const width = opts.width || 40;
  const fill = opts.fill === undefined ? ' ' : opts.fill;
  const symbol = opts.symbol || '$';
  const rate = opts.rate || 1;
  const nameWidth = Math.max(width - QTY_WIDTH - PRICE_WIDTH, 1);

  const lines = [];
  lines.push(padRight('HAUNTED CAFE', width - 9) + '#' + leftPad(order.id, 8, '0'));
  lines.push(moment(order.placedAt).utc().format('YYYY-MM-DD HH:mm') + ' UTC');
  lines.push('-'.repeat(width));

  let total = 0;
  for (const item of order.items) {
    const cents = Math.round(item.cents * item.qty * rate);
    total += cents;
    lines.push(
      padRight(item.name, nameWidth) +
        leftPad('x' + item.qty, QTY_WIDTH) +
        leftPad(money(cents, symbol), PRICE_WIDTH, fill),
    );
  }

  lines.push('-'.repeat(width));
  lines.push(
    padRight('TOTAL', width - PRICE_WIDTH) + leftPad(money(total, symbol), PRICE_WIDTH, fill),
  );
  return lines.join('\n');
}

module.exports = { renderReceipt, money };
