/**
 * Unit tests for utils/dom-utils.js (pure helpers + React value setting).
 * Runs against a real DOM via jsdom-free minimal stub, kept dependency-light.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'dom-utils.js'), 'utf8');

// Evaluate the UMD bundle in a sandbox with the globals it needs.
const sandbox = { self: {}, window: {}, getComputedStyle: () => ({}) };
sandbox.self = sandbox;
// eslint-disable-next-line no-new-func
new Function('self', 'window', 'getComputedStyle', 'HTMLSelectElement', source)(
  sandbox, sandbox, sandbox.getComputedStyle, function HTMLSelectElement() {}
);
const DOM = sandbox.DOMUtils;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('dom-utils');

test('exports the helpers the content scripts use', () => {
  for (const name of [
    'sleep', 'isVisible', 'waitFor', 'setInputValue', 'setSelectValue',
    'setSelectWhenReady', 'findButton', 'clickButton',
    'dismissCookieBanners', 'removeBlockingOverlays', 'AbortedError',
  ]) {
    assert.strictEqual(typeof DOM[name], 'function', `missing ${name}`);
  }
});

test('findButton matches text case-insensitively and skips disabled buttons', () => {
  const make = (text, disabled) => ({ textContent: text, value: '', disabled, getBoundingClientRect: () => ({ width: 10, height: 10 }) });
  const disabled = make('Volgende stap', true);
  const enabled = make('Volgende stap', false);

  const root = { querySelectorAll: () => [disabled, enabled] };
  sandbox.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  sandbox.document = root;

  assert.strictEqual(DOM.findButton(/volgende stap/i, root), enabled);
  assert.strictEqual(DOM.findButton(/niet aanwezig/i, root), null);
});

(async () => {
  await asyncTest('waitFor resolves as soon as the predicate is truthy', async () => {
    let calls = 0;
    const value = await DOM.waitFor(() => (++calls >= 2 ? 'klaar' : null), { interval: 5, timeout: 500 });
    assert.strictEqual(value, 'klaar');
  });

  await asyncTest('waitFor rejects with a timeout error', async () => {
    await assert.rejects(
      () => DOM.waitFor(() => null, { interval: 5, timeout: 60 }),
      /Timeout na 60ms/
    );
  });

  await asyncTest('waitFor surfaces AbortedError from the guard', async () => {
    const boom = () => { throw new DOM.AbortedError(); };
    await assert.rejects(
      () => DOM.waitFor(() => null, { interval: 5, timeout: 500, guard: boom }),
      (err) => err instanceof DOM.AbortedError
    );
  });

  console.log(`\n${passed} assertions passed`);
})();
