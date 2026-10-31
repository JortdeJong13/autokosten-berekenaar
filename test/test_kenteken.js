const assert = require('assert');
const KentekenUtils = require('../utils/kenteken');

console.log('--- Testing KentekenUtils ---');

// 1. Validation and Formatting
const testCases = [
  { raw: '12-ABC-3', formatted: '12-ABC-3', valid: true },
  { raw: '12ABC3', formatted: '12-ABC-3', valid: true },
  { raw: 'N123AB', formatted: 'N-123-AB', valid: true },
  { raw: 'n-123-ab', formatted: 'N-123-AB', valid: true },
  { raw: 'AB12CD', formatted: 'AB-12-CD', valid: true },
  { raw: '99XXX9', formatted: '99-XXX-9', valid: true },
  { raw: 'X999XX', formatted: 'X-999-XX', valid: true },
  { raw: '1ABC23', formatted: '1-ABC-23', valid: true },
  { raw: 'GBB12D', formatted: 'GBB-12-D', valid: true },
  { raw: 'INVALID123', formatted: null, valid: false },
  { raw: '0612345678', formatted: null, valid: false },
  { raw: '', formatted: null, valid: false }
];

testCases.forEach((tc) => {
  const isValid = KentekenUtils.isValid(tc.raw);
  const formatted = KentekenUtils.format(tc.raw);
  assert.strictEqual(isValid, tc.valid, `Validation failed for: ${tc.raw}`);
  assert.strictEqual(formatted, tc.formatted, `Formatting failed for: ${tc.raw}`);
  console.log(`✓ Case passed: ${tc.raw} -> ${formatted} (valid: ${isValid})`);
});

// 2. Text extraction
console.log('\n--- Testing Text Extraction ---');
const textSamples = [
  { text: 'Prachtige Audi Q4 e-tron. Kenteken: N-123-AB. Dealers onderhouden.', expected: 'N-123-AB' },
  { text: 'Origineel Nederlands geleverd met kenteken 12ABC3 en NAP.', expected: '12-ABC-3' },
  { text: 'Prijs: € 32.500,- | X-999-XX | Bouwjaar 2022', expected: 'X-999-XX' },
  { text: 'Geen kenteken vermeld in deze advertentie. Bel 06-12345678.', expected: null }
];

textSamples.forEach((ts) => {
  const result = KentekenUtils.findInText(ts.text);
  assert.strictEqual(result, ts.expected, `Text extraction failed for: "${ts.text}"`);
  console.log(`✓ Text sample passed: "${ts.text.slice(0, 35)}..." -> ${result}`);
});

// 3. Object Deep Search
console.log('\n--- Testing Object Deep Search ---');
const sampleListingDetails = {
  id: 'bcb44279-e53b-4f7c-8525-4101947c6be0',
  vehicle: {
    make: 'Audi',
    model: 'Q4 e-tron',
    attributes: {
      registrationInfo: {
        licensePlate: 'GBB-12-D'
      }
    }
  }
};

const objResult = KentekenUtils.findInObject(sampleListingDetails);
assert.strictEqual(objResult, 'GBB-12-D');
console.log('✓ Deep object search found license plate:', objResult);

console.log('\nAll KentekenUtils tests passed successfully! 🎉');
