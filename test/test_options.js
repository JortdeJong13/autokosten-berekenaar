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

test('matches leather and parking options generically', () => {
  const results = OptionsUtils.resolveOptions(
    ['Lederen bekleding', 'Parkeersensoren'],
    MERCEDES
  );
  assert.deepStrictEqual(results.map((r) => r.tick), [true, true]);
});

test('plain air conditioning does not satisfy "automatic climate control"', () => {
  // ANWB asks for AUTOMATIC climate control specifically, so a car whose
  // equipment only says "Airconditioning" must not be ticked.
  const [r] = OptionsUtils.resolveOptions(['AUTOMATIC CLIMATE CONTROL'], MERCEDES);
  assert.strictEqual(r.concept, 'climateControl');
  assert.strictEqual(r.tick, false);

  const car = { equipment: ['Automatische klimaatregeling'] };
  const [t] = OptionsUtils.resolveOptions(['AUTOMATIC CLIMATE CONTROL'], car);
  assert.strictEqual(t.tick, true);
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

console.log('\noptions — near-miss labels (ANWB wording quirks)');

// These labels were captured from ANWB's own API. Each is a near-miss for a
// concept and must NOT be ticked, or the car's value is overstated.
const NEAR_MISSES = [
  ['VERWARMDE VOORRUIT', 'heatedSeats', 'heated windscreen is not heated seats'],
  ['ZIJRUITEN ELEKTRISCH VOOR', 'electricSeat', 'electric windows are not an electric seat'],
  ['SPIEGELS ELEKTRISCH', 'electricSeat', 'electric mirrors are not an electric seat'],
  ['HOOGTEVERSTELLING STOEL', 'electricSeat', 'seat height adjustment is not electric'],
];

test('does not tick labels that merely resemble a concept', () => {
  const car = {
    paintType: 'Metallic',
    equipment: ['Stoelverwarming', 'Elektrische stoelverstelling', 'Lederen bekleding'],
  };
  for (const [label, _conceptId, why] of NEAR_MISSES) {
    const [r] = OptionsUtils.resolveOptions([label], car);
    assert.strictEqual(r.tick, false, `${label} must not tick: ${why}`);
  }
});

test('still ticks the genuine labels these resemble', () => {
  const car = { equipment: ['Stoelverwarming', 'Elektrische stoelverstelling'] };
  const results = OptionsUtils.resolveOptions(
    ['STOELEN VERWARMED', 'STOEL ELEKTRISCH'],
    car
  );
  assert.deepStrictEqual(results.map((r) => r.tick), [true, true],
    'the real labels must still tick, including ANWB\'s "VERWARMED" spelling');
});

test('handles the full captured ANWB vocabulary without crashing', () => {
  const real = ['ACHTERBANK NEERKLAPBAAR','AIRBAG','ALARM','ARMSTEUN VOOR',
    'AUTOMATIC CLIMATE CONTROL','BOORDCOMPUTER','CRUISE CONTROL','GETINT GLAS',
    'HOOFDSTEUNEN ACHTER','HOOGTEVERSTELLING STOEL','LEDEREN BEKLEDING','LENDESTEUN',
    'LICHTMETALEN VELGEN','METALLIC LAK','NAVIGATIESYSTEEM','PARELEFFECTLAK',
    'PARKDISTANCE CONTROL ACHTER','PARKDISTANCE CONTROL VOOR','SPIEGELS  ELEKTRISCH',
    'SPIEGELS VERWARMD','STUUR IN HOOGTE VERSTELBAAR','XENON VERLICHTING',
    'ZIJRUITEN ELEKTRISCH VOOR','VERWARMDE VOORRUIT','STOELEN VERWARMED',
    'STOEL ELEKTRISCH','REGENSENSOR','ELECTRISCH BEDIEND SCHUIFDAK'];
  const car = {
    paintType: 'Metallic',
    equipment: ['Lederen bekleding','Automatische klimaatregeling','Cruisecontrol',
      'Regensensor','Stoelverwarming','Elektrische stoelverstelling','Parkeerhulp','Open dak'],
  };
  const r = OptionsUtils.resolveOptions(real, car);
  const ticked = r.filter((x) => x.tick).map((x) => x.label);
  assert.ok(ticked.includes('METALLIC LAK'));
  assert.ok(ticked.includes('LEDEREN BEKLEDING'));
  assert.ok(ticked.includes('ELECTRISCH BEDIEND SCHUIFDAK'));
  assert.ok(!ticked.includes('VERWARMDE VOORRUIT'));
  assert.ok(!ticked.includes('XENON VERLICHTING'));
  assert.ok(!ticked.includes('ALARM'));
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

test('every concept can actually match something', () => {
  for (const c of OptionsUtils.CONCEPTS) {
    assert.ok((c.anwb && c.anwb.length) || (c.anwbAll && c.anwbAll.length) || c.field,
      `concept ${c.id} has no matcher`);
  }
});

test('no concept mentions a specific make or model', () => {
  const forbidden = ['mercedes', 'bmw', 'audi', 'volkswagen', 'kia', 'toyota', 'tesla', 'glc', 'golf'];
  const dump = JSON.stringify(OptionsUtils.CONCEPTS).toLowerCase();
  for (const word of forbidden) {
    assert.ok(!dump.includes(word), `concept list mentions "${word}" — it must stay generic`);
  }
});

console.log(`\n${passed} option assertions passed`);
