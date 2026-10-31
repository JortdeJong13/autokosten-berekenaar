/**
 * AutoScout24 Content Script (Lightweight & On-Demand)
 * Zero background loops or MutationObservers to keep AutoScout24 ultra-fast.
 * Extracts data on-demand when user clicks the floating button.
 *
 * The panel body is the shared CalculatorForm, so this surface and the toolbar
 * popup are always the same UI.
 */

(function () {
  'use strict';

  if (window.__carCostExtensionLoaded) return;
  window.__carCostExtensionLoaded = true;

  console.log('[AutokostenBerekenaar] AutoScout24 lightweight script ready');

  /**
   * Price Extractor
   */
  function extractPriceFromText(text) {
    if (typeof text === 'number') return Math.round(text);
    if (!text || typeof text !== 'string') return null;

    // 1. Raw numeric string
    const rawOnlyDigits = text.trim().replace(/[^0-9]/g, '');
    if (/^\s*(?:€|EUR)?\s*[0-9\.\,\s]+(?:,-|-)?\s*$/i.test(text.trim())) {
      const n = parseInt(rawOnlyDigits, 10);
      if (!isNaN(n) && n >= 500 && n <= 2500000) return n;
    }

    // 2. Embedded in text
    const m = text.match(/(?:€|EUR)\s*([0-9]{1,3}(?:[\.\s][0-9]{3})*(?:,[0-9]{2})?|\d+)/i) ||
              text.match(/([0-9]{1,3}(?:[\.\s][0-9]{3})*(?:,[0-9]{2})?|\d+)\s*(?:€|EUR)/i);

    if (m) {
      const digits = m[1].replace(/,[0-9]{2}$/, '').replace(/[^0-9]/g, '');
      const num = parseInt(digits, 10);
      if (!isNaN(num) && num >= 500 && num <= 2500000) return num;
    }
    return null;
  }

  /**
   * Mileage Extractor
   */
  function extractMileageFromText(text) {
    if (typeof text === 'number') return Math.round(text);
    if (!text || typeof text !== 'string') return null;

    // 1. Raw numeric string
    if (/^\s*[0-9\.\,\s]+(?:\s*km)?\s*$/i.test(text.trim())) {
      const digits = text.replace(/[^0-9]/g, '');
      const n = parseInt(digits, 10);
      // A delivery-mileage car legitimately reads "1 km", so the floor is 0.
      // The upper bound still guards against matching a year or a price.
      if (!isNaN(n) && n >= 0 && n <= 1000000) return n;
    }

    // 2. Embedded in text
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
        if (!isNaN(num) && num >= 0 && num <= 1000000) return num;
      }
    }
    return null;
  }

  /**
   * Extract all valid car prices from a text string
   */
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

  /**
   * Vehicle details used by the make/model fallback, when there is no plate.
   *
   * Source: the listing's JSON-LD `Car` block, which is structured rather than
   * scraped from markup, so it is far less brittle. Fields it provides:
   * manufacturer, model, productionDate, numberOfDoors, vehicleTransmission.
   * Fuel type is NOT in the JSON-LD, so it comes from __NEXT_DATA__'s
   * `fuelCategory.formatted`, which is already a readable label.
   */
  function extractVehicleDetails() {
    const vehicle = {
      brand: null, model: null, productionDate: null,
      doors: null, fuel: null, transmission: null,
      paintType: null, equipment: [],
    };

    const readJsonLd = () => {
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        let parsed;
        try {
          parsed = JSON.parse(script.textContent);
        } catch {
          continue;
        }

        // The Car sits under an Offer's itemOffered, but walk anything.
        const stack = [parsed];
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== 'object') continue;

          if (node['@type'] === 'Car') {
            vehicle.brand ||= node.manufacturer || null;
            vehicle.model ||= node.model || null;
            vehicle.productionDate ||= node.productionDate || null;
            vehicle.doors ||= node.numberOfDoors || null;
            vehicle.transmission ||= node.vehicleTransmission || null;
            return true;
          }

          for (const value of Object.values(node)) {
            if (value && typeof value === 'object') stack.push(value);
          }
        }
      }
      return false;
    };

    try {
      readJsonLd();
    } catch (err) {
      console.warn('[AutokostenBerekenaar] JSON-LD lezen mislukt:', err);
    }

    // Fuel type lives only in __NEXT_DATA__.
    if (!vehicle.fuel) {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        try {
          const parsed = JSON.parse(nextData.textContent);
          const find = (node) => {
            if (!node || typeof node !== 'object') return null;
            if (vehicle.fuel) return null;

            const category = node.fuelCategory;
            if (category && typeof category === 'object' && category.formatted) {
              return category.formatted;
            }

            for (const value of Object.values(node)) {
              const hit = find(value);
              if (hit) return hit;
            }
            return null;
          };
          vehicle.fuel = find(parsed);
        } catch (err) {
          console.warn('[AutokostenBerekenaar] __NEXT_DATA__ lezen mislukt:', err);
        }
      }
    }

    // Fall back to a labelled DOM row for fuel, if the data blobs failed.
    if (!vehicle.fuel) {
      for (const el of document.querySelectorAll('dt, th, span')) {
        if (!/^brandstof$/i.test(el.textContent.trim())) continue;
        const value = el.nextElementSibling?.textContent?.trim();
        if (value && value.length < 40) { vehicle.fuel = value; break; }
      }
    }

    // Paint type and the equipment list come from __NEXT_DATA__ too.
    readFromNextData(vehicle);

    return vehicle;
  }

  /**
   * Pull paint type and equipment out of __NEXT_DATA__.
   *
   * `paintType` is a dedicated field ("Metallic", "Solid"), which is what ANWB
   * means by its "Metallic lak" option — a concept, not a make-specific term.
   *
   * `equipment` is the flat list of feature names, which is how we answer
   * ANWB's other option questions without a per-make mapping table.
   */
  function readFromNextData(vehicle) {
    const nextData = document.getElementById('__NEXT_DATA__');
    if (!nextData) return;

    let parsed;
    try {
      parsed = JSON.parse(nextData.textContent);
    } catch (err) {
      console.warn('[AutokostenBerekenaar] __NEXT_DATA__ lezen mislukt:', err);
      return;
    }

    // Find listingDetails.vehicle once, then read several fields off it.
    const findVehicle = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.paintType !== undefined || node.equipment) return node;
      for (const value of Object.values(node)) {
        const hit = findVehicle(value);
        if (hit) return hit;
      }
      return null;
    };

    const vehicleNode = findVehicle(parsed);
    if (!vehicleNode) return;

    vehicle.paintType ||= vehicleNode.paintType || null;

    // equipment is grouped by category: { comfortAndConvenience: [ {id}, ... ] }
    if (!vehicle.equipment.length && vehicleNode.equipment && typeof vehicleNode.equipment === 'object') {
      const names = [];
      for (const items of Object.values(vehicleNode.equipment)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (item && typeof item.id === 'string') names.push(item.id);
        }
      }
      vehicle.equipment = names;
    }
  }

  /**
   * True for this extension's own bundled source.
   *
   * When the extension is packaged into an app, its scripts can end up in the
   * page's DOM. They contain example plates in comments, so scanning them
   * yields a plate belonging to no car. Matched on distinctive strings that
   * only our files carry.
   */
  function isExtensionSource(text) {
    return /AutokostenBerekenaar|__anwbAutokostenLoaded|__carCostExtensionLoaded|OptionsUtils|VehicleUtils|KentekenUtils/.test(text)
      || /Dutch License Plate \(Kenteken\) Utilities/.test(text);
  }

  /**
   * Fast, on-demand extraction from DOM (< 10ms execution time)
   */
  function extractCarDetails() {
    let licensePlate = null;
    let mileage = null;
    let price = null;
    let title = null;

    // 1. Title
    const h1 = document.querySelector('h1');
    title = h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : document.title;

    // 2. Price (handles price reductions / discounts & excludes ex-BTW prices)
    const priceEl = document.querySelector(
      '[data-testid="regular-price"], [data-testid*="price" i], [class*="Price_price" i], [class*="stage-price" i]'
    );
    if (priceEl) {
      // Clone price block
      const clone = priceEl.cloneNode(true);

      // A. Remove old / strikethrough prices
      const crossedOut = clone.querySelectorAll(
        's, del, [style*="line-through"], [class*="strike" i], [class*="crossed" i], [class*="previous" i], [class*="old" i]'
      );
      crossedOut.forEach((el) => el.remove());

      // B. Remove ex-BTW / without-VAT sub-labels so we only keep the consumer price (incl. BTW)
      const allSubNodes = clone.querySelectorAll('*');
      allSubNodes.forEach((node) => {
        const txt = node.textContent.toLowerCase();
        if ((txt.includes('excl') || txt.includes('zonder') || txt.includes('netto')) && !txt.includes('incl')) {
          node.remove();
        }
      });

      // Filter remaining lines to ensure no ex-BTW price slips through
      const cleanLines = clone.textContent.split('\n').filter((l) => !/excl|zonder\s*btw|netto/i.test(l));
      const cleanText = cleanLines.join(' ');

      const validPrices = extractAllPricesFromText(cleanText);
      if (validPrices.length > 0) {
        price = validPrices[0]; // Prominent consumer price incl. BTW
      } else {
        price = extractPriceFromText(cleanText);
      }
    }

    if (!price && document.body) {
      // Find all prices in body, excluding strikethrough
      price = extractPriceFromText(document.body.innerText);
    }

    // 3. Mileage
    const mileageEl = document.querySelector(
      '[data-testid="VehicleDetails-mileage_road"], [data-testid*="mileage" i], [data-testid*="kilometer" i]'
    );
    if (mileageEl) {
      mileage = extractMileageFromText(mileageEl.textContent);
    }
    if (!mileage && document.body) {
      mileage = extractMileageFromText(document.body.innerText);
    }

    // 4. License Plate
    // Check specific table / definition elements
    const labelElements = document.querySelectorAll('dt, th, span');
    for (const el of labelElements) {
      const text = el.textContent.trim().toLowerCase();
      if (text === 'kenteken' || text === 'kenteken:') {
        const next = el.nextElementSibling || el.parentElement?.querySelector('dd, td');
        if (next) {
          licensePlate = window.KentekenUtils?.format(next.textContent) || window.KentekenUtils?.findInText(next.textContent);
          if (licensePlate) break;
        }
      }
    }

    // Scan body text
    if (!licensePlate && document.body) {
      licensePlate = window.KentekenUtils?.findInText(document.body.innerText);
    }

    // Scan script tags as quick fallback.
    //
    // Only inline JSON payloads are scanned. A <script src> has no textContent,
    // but a *bundled* script does — and that includes our own source, whose
    // comments contain example plates like "N-123-AB". Reading those produced a
    // plate that is not on the car at all. Anything with a `src` is skipped.
    if (!licensePlate || !price || !mileage) {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.src) continue;

        const text = s.textContent || '';
        if (!text || text.length < 20 || text.length > 500000) continue;

        // Heuristics alone are not enough here: our own shipped modules contain
        // the word "kenteken" (in comments and selectors), so a keyword test
        // matches them. Exclude them by identity instead.
        if (isExtensionSource(text)) continue;

        // Structured data worth reading is JSON or a JS state object. Our
        // modules are neither and hold no vehicle facts.
        const looksLikeData = /^\s*[\[{]/.test(text)
          || /__NEXT_DATA__|application\/ld\+json/.test(text)
          || /"(?:priceRaw|priceAmount|primaryPrice|mileage|mileageInKm|kenteken)"\s*:/.test(text);
        if (!looksLikeData) continue;

        if (!licensePlate) {
          licensePlate = window.KentekenUtils?.findInText(text);
        }
        if (!price) {
          const pm = text.match(/"(?:priceRaw|priceAmount|primaryPrice|price)"\s*:\s*"?(\d+)"?/i);
          if (pm) price = parseInt(pm[1], 10);
        }
        if (!mileage) {
          const km = text.match(/"(?:mileage|mileageInKm|mileageRaw)"\s*:\s*"?(\d[\d\.\s]*)"?/i);
          if (km) mileage = extractMileageFromText(km[1]);
        }
        if (licensePlate && price && mileage) break;
      }
    }

    const vehicle = extractVehicleDetails();

    console.log('[AutokostenBerekenaar] Uitgelezen:', { title, price, mileage, licensePlate, vehicle });
    return { title, price, mileage, licensePlate, vehicle };
  }

  // Listen for message from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'extractCarDetails') {
        const details = extractCarDetails();
        sendResponse({ success: true, data: details });
      }
      return true;
    });
  }

  /**
   * Inject a minimal, static floating trigger button (zero performance impact).
   * The panel body is the shared CalculatorForm, so it matches the toolbar popup.
   */
  function injectFloatingBadge() {
    if (document.getElementById('anwb-cost-floating-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'anwb-cost-floating-badge';
    badge.className = 'anwb-floating-badge';
    badge.innerHTML = `
      <div class="anwb-floating-card" id="anwb-floating-card" hidden></div>
      <button class="anwb-floating-trigger" id="anwb-floating-trigger"
              title="Bereken ANWB Autokosten" aria-expanded="false">
        <span class="anwb-floating-label">ANWB Kosten</span>
      </button>
    `;

    document.body.appendChild(badge);

    const triggerBtn = badge.querySelector('#anwb-floating-trigger');
    const card = badge.querySelector('#anwb-floating-card');

    let form = null;

    const close = () => {
      card.hidden = true;
      triggerBtn.setAttribute('aria-expanded', 'false');
    };

    triggerBtn.addEventListener('click', async () => {
      if (!card.hidden) {
        close();
        return;
      }

      // Extract on-demand right when the user clicks.
      const details = extractCarDetails();

      if (!form) {
        form = window.CalculatorForm.render(card, {
          title: 'ANWB Autokosten',
          onClose: close,
        });
        form.setValues({
          licensePlate: details.licensePlate,
          mileage: details.mileage,
          price: details.price,
          title: details.title,
          vehicle: details.vehicle,
        });
        await form.applySettings(await window.CalculatorForm.readSettings());
      } else {
        form.setValues({
          licensePlate: details.licensePlate,
          mileage: details.mileage,
          price: details.price,
          title: details.title,
          vehicle: details.vehicle,
        });
      }

      card.hidden = false;
      triggerBtn.setAttribute('aria-expanded', 'true');

      // Nothing to say either way: the make/model fallback covers a missing
      // plate, and a notice here would just be noise.
      form.clearFeedback();
    });

    // Close when clicking elsewhere on the page.
    document.addEventListener('click', (event) => {
      if (card.hidden) return;
      if (badge.contains(event.target)) return;
      close();
    });
  }

  // Inject the floating badge once the DOM is ready (zero observers)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingBadge);
  } else {
    injectFloatingBadge();
  }
})();
