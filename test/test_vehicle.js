/**
 * Unit tests for the make/model fallback matching.
 *
 * The model lists below are the real ones ANWB returned, so the tests reflect
 * what the matcher will actually face rather than invented data.
 */
const assert = require('node:assert');
const path = require('node:path');

const VehicleUtils = require(path.join(__dirname, '..', 'utils', 'vehicle.js'));
const { Confidence } = VehicleUtils;

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

const opts = (list) => list.map((text) => ({ text, value: text }));

// Real ANWB data (sampled).
const ANWB_BRANDS = opts(['Abarth', 'Alfa Romeo', 'Audi', 'BMW', 'Byd', 'Mercedes', 'Volkswagen', 'Tesla', 'Peugeot', 'Citroen']);
const ANWB_MODELS = {
  Mercedes: opts(['A-Klasse', 'Amg-Gt', 'C-Klasse', 'E-Klasse', 'Eqc', 'G-Klasse', 'Glc-Klasse', 'Glk-Klasse', 'Sprinter']),
  BMW: opts(['1-Serie', '2-Serie', '3-Serie', '5-Serie', '7-Serie', 'I3', 'I4', 'X1', 'X3']),
  Audi: opts(['A1', 'A3', 'A4', 'A6', 'Q3', 'Q5', 'Tt']),
  Volkswagen: opts(['Fox', 'Golf', 'Golf Plus', 'Polo', 'Passat', 'Tiguan']),
  Peugeot: opts(['108', '208', '2008', '308', '3008', '508']),
  Tesla: opts(['Model 3', 'Model S', 'Model X', 'Model Y']),
};

console.log('vehicle — brand matching');

test('matches an exact brand name', () => {
  const r = VehicleUtils.matchBrand(ANWB_BRANDS, 'Audi');
  assert.strictEqual(r.option.text, 'Audi');
  assert.strictEqual(r.confidence, Confidence.HIGH);
});

test('maps Mercedes-Benz to Mercedes via alias', () => {
  const r = VehicleUtils.matchBrand(ANWB_BRANDS, 'Mercedes-Benz');
  assert.strictEqual(r.option.text, 'Mercedes');
  assert.strictEqual(r.confidence, Confidence.HIGH);
});

test('matches brands whose spelling differs only by punctuation', () => {
  assert.strictEqual(VehicleUtils.matchBrand(ANWB_BRANDS, 'Alfa Romeo').option.text, 'Alfa Romeo');
  assert.strictEqual(VehicleUtils.matchBrand(ANWB_BRANDS, 'Citroën').option.text, 'Citroen');
});

test('returns no match and NONE confidence for an unknown brand', () => {
  const r = VehicleUtils.matchBrand(ANWB_BRANDS, 'Lada');
  assert.strictEqual(r.option, null);
  assert.strictEqual(r.confidence, Confidence.NONE);
});

test('does not match on empty input', () => {
  assert.strictEqual(VehicleUtils.matchBrand(ANWB_BRANDS, '').option, null);
  assert.strictEqual(VehicleUtils.matchBrand([], 'Audi').option, null);
});

console.log('\nvehicle — model matching');

test('matches models that are identical on both sites', () => {
  for (const [brand, as24] of [['Volkswagen', 'Golf'], ['Peugeot', '208'], ['Tesla', 'Model 3']]) {
    const r = VehicleUtils.matchModel(ANWB_MODELS[brand], as24);
    assert.strictEqual(r.option.text, as24, `${brand} ${as24} -> ${r.option && r.option.text}`);
    assert.strictEqual(r.confidence, Confidence.HIGH);
  }
});

test('trims AS24 trim names down to the ANWB model', () => {
  const r = VehicleUtils.matchModel(ANWB_MODELS.Audi, 'A3 Sportback');
  assert.strictEqual(r.option.text, 'A3');
  assert.strictEqual(r.confidence, Confidence.HIGH);
});

test('matches "GLC 300" to "Glc-Klasse" on the leading token', () => {
  const r = VehicleUtils.matchModel(ANWB_MODELS.Mercedes, 'GLC 300');
  assert.strictEqual(r.option.text, 'Glc-Klasse');
  assert.ok(r.confidence >= Confidence.MEDIUM);
});

test('does not let "Golf Plus" shadow "Golf"', () => {
  // "golfplus".includes("golf") is true, but exact must win first.
  const r = VehicleUtils.matchModel(ANWB_MODELS.Volkswagen, 'Golf');
  assert.strictEqual(r.option.text, 'Golf');
  assert.strictEqual(r.confidence, Confidence.HIGH);
});

test('maps BMW engine codes to the series, flagged LOW so the user confirms', () => {
  const r = VehicleUtils.matchModel(ANWB_MODELS.BMW, '318I');
  assert.strictEqual(r.option.text, '3-Serie');
  assert.strictEqual(r.confidence, Confidence.LOW, 'series guesses must not claim high confidence');
});

test('matches BMW models that are already series names', () => {
  const r = VehicleUtils.matchModel(ANWB_MODELS.BMW, 'X3');
  assert.strictEqual(r.option.text, 'X3');
  assert.strictEqual(r.confidence, Confidence.HIGH);
});

test('always returns the full candidate list for a picker', () => {
  const r = VehicleUtils.matchModel(ANWB_MODELS.BMW, '318I');
  assert.deepStrictEqual(r.candidates, ['1-Serie', '2-Serie', '3-Serie', '5-Serie', '7-Serie', 'I3', 'I4', 'X1', 'X3']);
});

test('returns no match for an unrecognisable model', () => {
  const r = VehicleUtils.matchModel(ANWB_MODELS.Mercedes, 'Zzz 999');
  assert.strictEqual(r.option, null);
  assert.strictEqual(r.confidence, Confidence.NONE);
});

console.log('\nvehicle — fuel mapping');

test('maps AS24 fuel labels onto ANWB options', () => {
  assert.strictEqual(VehicleUtils.mapFuel('Elektro/Benzine'), 'PHEV Benzine');
  assert.strictEqual(VehicleUtils.mapFuel('Elektro/Diesel'), 'PHEV Diesel');
  assert.strictEqual(VehicleUtils.mapFuel('Benzine'), 'Benzine');
  assert.strictEqual(VehicleUtils.mapFuel('Diesel'), 'Diesel');
});

test('returns null for pure electric, which ANWB never asks about', () => {
  assert.strictEqual(VehicleUtils.mapFuel('Elektro'), null);
  assert.strictEqual(VehicleUtils.mapFuel('Elektrisch'), null);
});

test('does not guess when the fuel is unknown', () => {
  assert.strictEqual(VehicleUtils.mapFuel(''), null);
  assert.strictEqual(VehicleUtils.mapFuel(null), null);
  assert.strictEqual(VehicleUtils.mapFuel('Waterstof'), null);
});

console.log('\nvehicle — transmission and dates');

test('maps transmission labels', () => {
  assert.strictEqual(VehicleUtils.mapTransmission('Automatisch'), 'Automaat');
  assert.strictEqual(VehicleUtils.mapTransmission('Handgeschakeld'), 'Handgeschakeld');
  assert.strictEqual(VehicleUtils.mapTransmission(''), null);
});

test('parses production dates in the formats both sites use', () => {
  assert.deepStrictEqual(VehicleUtils.parseProductionDate('2021-01-01'), { year: 2021, month: 1 });
  assert.deepStrictEqual(VehicleUtils.parseProductionDate('12/2023'), { year: 2023, month: 12 });
  assert.deepStrictEqual(VehicleUtils.parseProductionDate('2021'), { year: 2021, month: null });
  assert.deepStrictEqual(VehicleUtils.parseProductionDate(null), { year: null, month: null });
});

test('names months the way ANWB renders them', () => {
  assert.strictEqual(VehicleUtils.monthName(1), 'Januari');
  assert.strictEqual(VehicleUtils.monthName(10), 'Oktober');
  assert.strictEqual(VehicleUtils.monthName(13), null);
});

console.log('\nvehicle — payload building');

test('builds a payload from a full listing', () => {
  const p = VehicleUtils.buildVehiclePayload({
    brand: 'Mercedes-Benz', model: 'GLC 300', productionDate: '2021-01-01',
    doors: 5, fuel: 'Elektro/Benzine', transmission: 'Automatisch',
  });
  assert.strictEqual(p.brand, 'Mercedes-Benz');
  assert.strictEqual(p.year, 2021);
  assert.strictEqual(p.month, 1);
  assert.strictEqual(p.doors, 5);
});

test('refuses to build a payload without brand, model and year', () => {
  assert.strictEqual(VehicleUtils.buildVehiclePayload({ brand: 'Audi' }), null);
  assert.strictEqual(VehicleUtils.buildVehiclePayload({ brand: 'Audi', model: 'A3' }), null);
  assert.strictEqual(VehicleUtils.buildVehiclePayload({}), null);
  assert.ok(VehicleUtils.buildVehiclePayload({ brand: 'Audi', model: 'A3', year: 2021 }));
});

console.log(`\n${passed} vehicle assertions passed`);
