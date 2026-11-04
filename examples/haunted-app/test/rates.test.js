'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getRate, archiveReceipt } = require('../src/rates');
const { printOrder } = require('../src/index');

/** A local rates service. `handler(req, res, body)` decides each answer. */
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() });
    });
  });
}

test('getRate sends the query and the user agent, and returns the rate', async () => {
  let seen;
  const svc = await serve((req, res) => {
    seen = { url: req.url, ua: req.headers['user-agent'] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ rates: { EUR: 0.92 } }));
  });
  try {
    assert.equal(await getRate(svc.url, 'USD', 'EUR'), 0.92);
    assert.equal(seen.url, '/latest?base=USD&symbols=EUR');
    assert.equal(seen.ua, 'haunted-app/1.0');
  } finally {
    svc.close();
  }
});

test('getRate rejects on a non-200 answer', async () => {
  const svc = await serve((req, res) => {
    res.statusCode = 503;
    res.end('down');
  });
  try {
    await assert.rejects(getRate(svc.url, 'USD', 'EUR'), /rates service answered 503/);
  } finally {
    svc.close();
  }
});

test('getRate rejects when the symbol is missing', async () => {
  const svc = await serve((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ rates: {} }));
  });
  try {
    await assert.rejects(getRate(svc.url, 'USD', 'EUR'), /no rate for EUR/);
  } finally {
    svc.close();
  }
});

test('getRate rejects when the service is slow', async () => {
  const svc = await serve(() => {});
  try {
    await assert.rejects(getRate(svc.url, 'USD', 'EUR', { timeoutMs: 100 }));
  } finally {
    svc.close();
  }
});

test('archiveReceipt posts JSON and resolves status and parsed body', async () => {
  let seen;
  const svc = await serve((req, res, body) => {
    seen = { method: req.method, type: req.headers['content-type'], body };
    res.statusCode = 201;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ stored: true }));
  });
  try {
    const answer = await archiveReceipt(svc.url, { id: 7, text: 'hi' });
    assert.deepEqual(answer, { status: 201, body: { stored: true } });
    assert.equal(seen.method, 'POST');
    assert.match(seen.type, /^application\/json/);
    assert.deepEqual(JSON.parse(seen.body), { id: 7, text: 'hi' });
  } finally {
    svc.close();
  }
});

test('printOrder converts prices with the live rate and archives the receipt', async () => {
  const archived = [];
  const svc = await serve((req, res, body) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/latest')) return res.end(JSON.stringify({ rates: { EUR: 0.5 } }));
    archived.push(JSON.parse(body));
    res.end('{}');
  });
  try {
    const text = await printOrder(
      { id: 1, placedAt: '2026-11-01T00:00:00Z', items: [{ name: 'Tea', qty: 1, cents: 400 }] },
      { ratesUrl: svc.url, to: 'EUR', symbol: 'E' },
    );
    assert.match(text, /E2\.00$/m);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].id, 1);
  } finally {
    svc.close();
  }
});
