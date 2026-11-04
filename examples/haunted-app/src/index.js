'use strict';

const { renderReceipt } = require('./receipt');
const { getRate, archiveReceipt } = require('./rates');

/**
 * Print an order. With a rates service, prices are converted from USD to `to`
 * and the receipt is archived afterwards.
 */
async function printOrder(order, options) {
  const opts = options || {};
  let rate = 1;
  if (opts.ratesUrl && opts.to) {
    rate = await getRate(opts.ratesUrl, 'USD', opts.to);
  }
  const text = renderReceipt(order, {
    width: opts.width,
    fill: opts.fill,
    symbol: opts.symbol,
    rate,
  });
  if (opts.ratesUrl) {
    await archiveReceipt(opts.ratesUrl, { id: order.id, text });
  }
  return text;
}

module.exports = { printOrder, renderReceipt, getRate, archiveReceipt };
