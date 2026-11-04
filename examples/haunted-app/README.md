# Haunted Cafe

A small receipt printer for an imaginary cafe. **It is haunted on purpose.**

Its three dependencies were picked because they are dead or dying, so that
[Necromancer](https://github.com/tsumita2929/necromancer) has something real to raise:

| Package | Used for | Why it is haunted |
|---|---|---|
| `left-pad` | zero padded order numbers and the money column | deprecated; `String.prototype.padStart` replaced it |
| `request` | the exchange-rate lookup and the receipt archive call | fully deprecated in 2020, with a known advisory that will never be patched |
| `moment` | the date line | in maintenance mode, but the engine does not flag it today: it is the control, and the one the Night Watch demo makes worse |

Verdicts come from the Necromancer engine, not from this README. Run an autopsy to see them.

## Use

```js
const { printOrder } = require('./src');

const text = await printOrder(order, {
  width: 40,            // columns
  fill: '.',            // padding character for the money column (default ' ')
  ratesUrl: 'http://rates.example',  // optional: convert and archive
  to: 'EUR',
});
```

`order` is `{ id, placedAt, items: [{ name, qty, cents }] }`.

## Test

```
npm install
npm test
```

The tests start a small local HTTP server as the rates service. No network is needed.

## Do not "fix" it by hand

The demo is the starting point of the Necromancer end-to-end run. The run copies this directory
to a scratch repository and migrates the copy on a local branch. This directory stays haunted.
