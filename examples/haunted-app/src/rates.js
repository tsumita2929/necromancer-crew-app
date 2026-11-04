'use strict';

const request = require('request');

const USER_AGENT = 'haunted-app/1.0';

/**
 * Ask the rates service for one exchange rate.
 * GET {baseUrl}/latest?base=FROM&symbols=TO  ->  { "rates": { "TO": 0.92 } }
 */
function getRate(baseUrl, from, to, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    request(
      {
        url: baseUrl + '/latest',
        qs: { base: from, symbols: to },
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        json: true,
        timeout: opts.timeoutMs || 2000,
      },
      (err, res, body) => {
        if (err) return reject(err);
        if (res.statusCode !== 200) {
          return reject(new Error('rates service answered ' + res.statusCode));
        }
        const rate = body && body.rates && body.rates[to];
        if (typeof rate !== 'number') return reject(new Error('no rate for ' + to));
        resolve(rate);
      },
    );
  });
}

/**
 * Archive a rendered receipt. POST {baseUrl}/receipts with a JSON body.
 * Resolves { status, body } for any answer the service gives.
 */
function archiveReceipt(baseUrl, payload, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    request.post(
      {
        url: baseUrl + '/receipts',
        headers: { 'User-Agent': USER_AGENT },
        json: payload,
        timeout: opts.timeoutMs || 2000,
      },
      (err, res, body) => {
        if (err) return reject(err);
        resolve({ status: res.statusCode, body });
      },
    );
  });
}

module.exports = { getRate, archiveReceipt };
