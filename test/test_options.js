/**
 * Unit tests for ANWB option matching.
 *
 * The point of these is to pin the design rule: matching must be by *concept*,
 * with no make- or model-specific knowledge. The same vehicle description must
 * resolve the same way regardless of what car it is.
 */
const assert = require('node:assert');
const path = require('node:path');

const OptionsUtils = require(path.join(__dirname, '..', 'utils', 'options.js'));

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

// A listing as autoscout.js extracts it: structured fields + a flat
// equipment list, nothing make-specific.
const MERCEDES = {
  brand: 'Mercedes-Benz',
  paintType: 'Metallic',
  equipment: ['Airconditioning', 'Open dak', 'Parkeerhulp met camera', 'Lederen bekleding', 'LED verlichting'],
};

const KIA = {
  brand: 'Kia',
  paintType: 'Solid',
  equipment: ['Airconditioning', 'Cruisecontrol'],
};

console.log('options — concept matching');

test('ticks Metallic lak from the paintType field', () => {
  const [r] = OptionsUtils.resolveOptions(['Metallic lak'], MERCEDES);
  assert.strictEqual(r.tick, true);
  assert.strictEqual(r.concept, 'metallicPaint');
  assert.match(r.source, /paintType/);
});

test('does not tick metallic paint when paintType is Solid', () => {
  const [r] = OptionsUtils.resolveOptions(['Metallic lak'], KIA);
  assert.strictEqual(r.tick, false);
});

test('does not tick metallic paint when paintType is missing entirely', () => {
  const [r] = OptionsUtils.resolveOptions(['Metallic lak'], { equipment: [] });
  assert.strictEqual(r.tick, false);
});

test('ticks a roof option when AS24 lists any roof equipment', () => {
  const [r] = OptionsUtils.resolveOptions(['Electrisch bediend schuifdak'], MERCEDES);
  assert.strictEqual(r.tick, true);
  assert.strictEqual(r.concept, 'sunroof');
});

test('leaves the roof option alone when the car has no roof equipment', () => {
  const [r] = OptionsUtils.resolveOptions(['Electrisch bediend schuifdak'], KIA);
  assert.strictEqual(r.tick, false);
});

test('recognises roof under several ANWB wordings', () => {
  for (const label of ['Electrisch bediend schuifdak', 'Panoramadak', 'Glazen dak', 'Zonnedak']) {
    const [r] = OptionsUtils.resolveOptions([label], MERCEDES);
    assert.strictEqual(r.tick, true, `${label} should map to the sunroof concept`);
  }
});

test('matches leather, parking and climate options generically', () => {
  const results = OptionsUtils.resolveOptions(
    ['Lederen bekleding', 'Parkeersensoren', 'Klimaatregeling'],
    MERCEDES
  );
  assert.deepStrictEqual(results.map((r) => r.tick), [true, true, true]);
});

console.log('\noptions — safety behaviour');

test('leaves an unrecognised option unticked rather than guessing', () => {
  const [r] = OptionsUtils.resolveOptions(['Iets heel raars'], MERCEDES);
  assert.strictEqual(r.tick, false);
  assert.strictEqual(r.concept, null);
});

test('never ticks anything when the vehicle is empty', () => {
  const results = OptionsUtils.resolveOptions(['Metallic lak', 'Schuifdak', 'Trekhaak'], {});
  assert.deepStrictEqual(results.map((r) => r.tick), [false, false, false]);
});

test('handles no options at all', () => {
  assert.deepStrictEqual(OptionsUtils.resolveOptions([], MERCEDES), []);
  assert.deepStrictEqual(OptionsUtils.resolveOptions(null, MERCEDES), []);
});

console.log('\noptions — genericity');

test('the same logic applies to any make', () => {
  // Identical listing facts must give identical answers, whatever the car is.
  const facts = { paintType: 'Metallic', equipment: ['Open dak'] };
  for (const brand of ['Kia', 'Porsche', 'Toyota', 'Ferrari']) {
    const r = OptionsUtils.resolveOptions(['Metallic lak', 'Schuifdak'], { ...facts, brand });
    assert.deepStrictEqual(r.map((x) => x.tick), [true, true], `failed for ${brand}`);
  }
});

test('no concept mentions a specific make or model', () => {
  const forbidden = ['mercedes', 'bmw', 'audi', 'volkswagen', 'kia', 'toyota', 'tesla', 'glc', 'golf'];
  const dump = JSON.stringify(OptionsUtils.CONCEPTS).toLowerCase();
  for (const word of forbidden) {
    assert.ok(!dump.includes(word), `concept list mentions "${word}" — it must stay generic`);
  }
});

test('every concept defines at least one matcher', () => {
  for (const c of OptionsUtils.CONCEPTS) {
    assert.ok((c.anwb && c.anwb.length) || c.field, `concept ${c.id} can never match`);
  }
});

console.log(`\n${passed} option assertions passed`);
