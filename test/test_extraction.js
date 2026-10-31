const assert = require('assert');
const KentekenUtils = require('../utils/kenteken');

console.log('--- Testing AutoScout24 Data Extraction Simulation ---');

function extractPriceFromText(text) {
  if (typeof text === 'number') return Math.round(text);
  if (!text || typeof text !== 'string') return null;

  // 1. Raw numeric string (e.g. "32950")
  const rawOnlyDigits = text.trim().replace(/[^0-9]/g, '');
  if (/^\s*(?:€|EUR)?\s*[0-9\.\,\s]+(?:,-|-)?\s*$/i.test(text.trim())) {
    const n = parseInt(rawOnlyDigits, 10);
    if (!isNaN(n) && n >= 500 && n <= 2500000) {
      return n;
    }
  }

  // 2. Embedded in text
  const m = text.match(/(?:€|EUR)\s*([0-9]{1,3}(?:[\.\s][0-9]{3})*(?:,[0-9]{2})?|\d+)/i) ||
            text.match(/([0-9]{1,3}(?:[\.\s][0-9]{3})*(?:,[0-9]{2})?|\d+)\s*(?:€|EUR)/i);

  if (m) {
    const digits = m[1].replace(/,[0-9]{2}$/, '').replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    if (!isNaN(num) && num >= 500 && num <= 2500000) {
      return num;
    }
  }
  return null;
}

function extractAllPricesFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.matchAll(/(?:€|EUR)\s*([0-9]{1,3}(?:[\.\s][0-9]{3})*|\d+)/gi);
  const prices = [];
  for (const m of matches) {
    const digits = m[1].replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    if (num >= 500 && num <= 2500000) {
      prices.push(num);
    }
  }
  return prices;
}

function extractMileageFromText(text) {
  if (typeof text === 'number') return Math.round(text);
  if (!text || typeof text !== 'string') return null;

  if (/^\s*[0-9\.\,\s]+(?:\s*km)?\s*$/i.test(text.trim())) {
    const digits = text.replace(/[^0-9]/g, '');
    const n = parseInt(digits, 10);
    if (!isNaN(n) && n >= 100 && n <= 1000000) return n;
  }

  const patterns = [
    /(?:kilometerstand|tellerstand|km-stand|stand)[:\s]*([0-9]{1,3}(?:[\.\s][0-9]{3})*|\d+)\s*(?:km)?/i,
    /\b([0-9]{1,3}(?:[\.][0-9]{3})+)\s*km\b/i,
    /\b([0-9]{4,6})\s*km\b/i
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const digits = m[1].replace(/[^0-9]/g, '');
      const num = parseInt(digits, 10);
      if (!isNaN(num) && num >= 100 && num <= 1000000) {
        return num;
      }
    }
  }
  return null;
}

// 1. Reduced / Discounted Price Test (Excludes ex-BTW and old prices)
const samplePriceSection = `
<div data-testid="regular-price">
  <span class="PreviousPrice_crossedOut"><s>€ 23.999,-</s></span>
  <span class="Price_mainPrice">€ 22.999,-</span>
  <span class="Price_subPrice">€ 19.007,- (excl. BTW)</span>
</div>
`;

function extractConsumerPriceFromHtml(html) {
  let cleaned = html
    .replace(/<s\b[^>]*>.*?<\/s>/gis, '')
    .replace(/<del\b[^>]*>.*?<\/del>/gis, '')
    .replace(/<[^>]+class="[^"]*(?:crossed|previous|strike|old)[^"]*"[^>]*>.*?<\/[^>]+>/gis, '')
    .replace(/<[^>]+>[^<]*(?:excl|zonder\s*btw|netto)[^<]*<\/[^>]+>/gis, '');

  const lines = cleaned.split('\n').filter((l) => !/excl|zonder\s*btw|netto/i.test(l));
  const prices = extractAllPricesFromText(lines.join(' '));
  return prices[0] || null;
}

const reducedPrice = extractConsumerPriceFromHtml(samplePriceSection);
assert.strictEqual(reducedPrice, 22999);
console.log('✓ Reduced consumer price picked correctly (22999, ignoring 23999 old & 19007 ex-BTW):', reducedPrice);

// 2. Multi-number Price & Mileage Edge Cases
const trickyPrice1 = "€ 32.950,- Financiering vanaf € 412 / mnd";
const trickyPrice2 = "Vraagprijs: € 19.500 (BTW verrekenbaar)";
assert.strictEqual(extractPriceFromText(trickyPrice1), 32950);
assert.strictEqual(extractPriceFromText(trickyPrice2), 19500);

const trickyMileage1 = "Garantie tot 100.000 km of 5 jaar (vanaf 2021)";
const trickyMileage2 = "24.500 km • Elektrisch • Bouwjaar 2022";
const searchRadius = "Zoek binnen 50 km van Amsterdam";
assert.strictEqual(extractMileageFromText(trickyMileage1), 100000);
assert.strictEqual(extractMileageFromText(trickyMileage2), 24500);
assert.strictEqual(extractMileageFromText(searchRadius), null);
console.log('✓ Mileage and search radius handled correctly');

// 3. Next.js mock payload
const mockNextData = {
  props: {
    pageProps: {
      listingDetails: {
        id: 'bcb44279-e53b-4f7c-8525-4101947c6be0',
        prices: {
          primary: {
            amount: '32950'
          }
        },
        vehicleDetails: {
          mileageInKm: '24.500 km'
        },
        vehicle: {
          make: 'Audi',
          model: 'Q4 e-tron',
          modelVersionInput: '35 S edition 55 kWh'
        },
        tracking: {
          licensePlate: 'X-999-XX'
        }
      }
    }
  }
};

const listing = mockNextData.props.pageProps.listingDetails;
const plate = KentekenUtils.findInObject(listing);
const mileage = extractMileageFromText(listing.vehicleDetails.mileageInKm);
const price = extractPriceFromText(listing.prices.primary.amount);
const title = `${listing.vehicle.make} ${listing.vehicle.model} ${listing.vehicle.modelVersionInput}`.trim();

assert.strictEqual(plate, 'X-999-XX');
assert.strictEqual(mileage, 24500);
assert.strictEqual(price, 32950);
assert.strictEqual(title, 'Audi Q4 e-tron 35 S edition 55 kWh');

console.log('✓ Extracted from Mock Next.js:', { plate, mileage, price, title });

console.log('\nAll extraction tests passed successfully! 🚀');
