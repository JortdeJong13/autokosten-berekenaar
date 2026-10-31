/**
 * The one calculator form, shared by the AutoScout24 floating panel and the
 * toolbar popup so both surfaces stay identical.
 *
 * Owns:
 *   - the fields (kenteken, km-stand, aanschafprijs)
 *   - the editable settings (bezitsduur, km per jaar, provincie), persisted to
 *     chrome.storage.local under `settings`
 *   - Dutch number formatting for the km/price inputs
 *   - validation and launching the ANWB calculator
 *
 * Styling lives in content/form.css (class prefix `cce-`), which both surfaces
 * load.
 */

(function (root, factory) {
  // `root` is the global (window/self) in a browser; the factory needs it to
  // reach chrome.*, KentekenUtils and window.open.
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.CalculatorForm = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Safari and Firefox expose the same API as `browser`; Chrome (and Safari's
  // compatibility layer) as `chrome`. Normalise once.
  if (root && !root.chrome && root.browser) root.chrome = root.browser;

  const PROVINCES = [
    'Drenthe', 'Flevoland', 'Friesland', 'Gelderland', 'Groningen', 'Limburg',
    'Noord-Brabant', 'Noord-Holland', 'Overijssel', 'Utrecht', 'Zeeland', 'Zuid-Holland',
  ];

  const OWNERSHIP_YEARS = Array.from({ length: 15 }, (_, i) => i + 1);

  const DEFAULT_SETTINGS = {
    ownershipYears: 8,
    kmPerYear: 10000,
    province: 'Noord-Holland',
  };

  const ANWB_URL = 'https://www.anwb.nl/auto/autokosten/berekenen';
  const MAX_DIGITS = 7; // up to 9.999.999

  // --- Dutch number formatting ---------------------------------------------

  /** 205557 -> "205.557" */
  function formatNumber(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('nl-NL');
  }

  /** "205.557" -> 205557 */
  function parseNumber(text) {
    const digits = String(text ?? '').replace(/\D/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
  }

  /**
   * Reformat as the user types, keeping the caret next to the same digit so
   * inserting separators doesn't shove the cursor to the end.
   */
  function attachNumberFormatting(input) {
    input.addEventListener('input', () => {
      const raw = input.value;
      const caret = input.selectionStart ?? raw.length;
      const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;

      const digits = raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
      input.value = digits ? Number(digits).toLocaleString('nl-NL') : '';

      // Walk to the position that has `digitsBeforeCaret` digits behind it.
      let pos = 0;
      let seen = 0;
      while (pos < input.value.length && seen < digitsBeforeCaret) {
        if (/\d/.test(input.value[pos])) seen++;
        pos++;
      }
      input.setSelectionRange(pos, pos);
    });
  }

  // --- Settings persistence -------------------------------------------------

  function readSettings() {
    return new Promise((resolve) => {
      if (!root.chrome?.storage?.local) return resolve({ ...DEFAULT_SETTINGS });
      root.chrome.storage.local.get(['settings'], (result) => {
        resolve({ ...DEFAULT_SETTINGS, ...(result?.settings || {}) });
      });
    });
  }

  function writeSettings(settings) {
    return new Promise((resolve) => {
      if (!root.chrome?.storage?.local) return resolve();
      root.chrome.storage.local.set({ settings }, resolve);
    });
  }

  // --- Launching ------------------------------------------------------------

  /**
   * Open the ANWB calculator with the pending payload already stored.
   *
   * Who opens the tab depends on where we are:
   *   - The popup can call `chrome.tabs.create` itself, so it does — one tab,
   *     no round trip.
   *   - A content script has no `chrome.tabs` access, so it asks the background
   *     page, which owns tab creation for that case.
   *
   * Either way the payload is already in storage, so the ANWB content script
   * picks it up when the page loads.
   */
  function launch(payload) {
    const openTabDirectly = () => {
      if (root.chrome?.tabs?.create) {
        root.chrome.tabs.create({ url: ANWB_URL, active: true });
      } else {
        root.open(ANWB_URL, '_blank');
      }
    };

    if (!root.chrome?.storage?.local) {
      openTabDirectly();
      return Promise.resolve();
    }

    const storeThenOpen = () => new Promise((resolve) => {
      root.chrome.storage.local.set({ pendingCalculation: payload }, () => {
        // The popup (and any context with tab access) opens the tab itself.
        if (root.chrome?.tabs?.create) {
          openTabDirectly();
          resolve();
          return;
        }

        if (!root.chrome?.runtime?.sendMessage) {
          openTabDirectly();
          resolve();
          return;
        }

        // Content script: only the background can create a tab.
        let settled = false;
        const settle = (opened) => {
          if (settled) return;
          settled = true;
          if (!opened) {
            console.warn('[AutokostenBerekenaar] Background gaf geen antwoord, tab zelf openen.');
            openTabDirectly();
          }
          resolve();
        };

        // Last-resort net for the case where the background never answers.
        const timer = setTimeout(() => settle(false), 3000);

        try {
          root.chrome.runtime.sendMessage({ action: 'startCalculation', data: payload }, (response) => {
            clearTimeout(timer);
            if (root.chrome.runtime.lastError) {
              console.warn('[AutokostenBerekenaar] sendMessage fout:', root.chrome.runtime.lastError.message);
              settle(false);
            } else {
              settle(Boolean(response?.success));
            }
          });
        } catch (err) {
          clearTimeout(timer);
          console.warn('[AutokostenBerekenaar] sendMessage mislukt:', err);
          settle(false);
        }
      });
    });

    return storeThenOpen();
  }

  // --- Rendering ------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /**
   * Render the form into `mount`.
   *
   * options:
   *   title      {string}  heading text (omit to hide the header)
   *   onClose    {fn}      renders a close button when provided
   *   onSubmit   {fn}      called with the payload after launch; return false
   *                        to keep the form open
   */
  function render(mount, options = {}) {
    const { title = 'ANWB Autokosten', onClose = null } = options;

    mount.innerHTML = `
      ${title || onClose ? `
        <div class="cce-header">
          <span class="cce-title">${escapeHtml(title)}</span>
          ${onClose ? '<button type="button" class="cce-close" data-role="close" aria-label="Sluiten">&times;</button>' : ''}
        </div>` : ''}

      <p class="cce-subtitle" data-role="subtitle"></p>

      <form class="cce-form" novalidate>
        <div class="cce-field">
          <label class="cce-label" for="cce-plate" data-role="plate-label">Kenteken</label>
          <div class="cce-plate">
            <span class="cce-plate-nl">NL</span>
            <input type="text" id="cce-plate" class="cce-plate-input" data-role="plate"
                   placeholder="XX-XX-XX" maxlength="9" autocomplete="off" spellcheck="false" />
          </div>
        </div>

        <div class="cce-row">
          <div class="cce-field">
            <label class="cce-label" for="cce-mileage">Km-stand</label>
            <input type="text" id="cce-mileage" class="cce-input" data-role="mileage"
                   inputmode="numeric" placeholder="000.000" autocomplete="off" />
          </div>
          <div class="cce-field">
            <label class="cce-label" for="cce-price">Aanschafprijs</label>
            <div class="cce-prefixed">
              <span class="cce-prefix">&euro;</span>
              <input type="text" id="cce-price" class="cce-input" data-role="price"
                     inputmode="numeric" placeholder="00.000" autocomplete="off" />
            </div>
          </div>
        </div>

        <fieldset class="cce-settings">
          <legend class="cce-legend">Uitgangspunten</legend>
          <div class="cce-row">
            <div class="cce-field">
              <label class="cce-label" for="cce-years">Bezitsduur</label>
              <select id="cce-years" class="cce-select" data-role="years"></select>
            </div>
            <div class="cce-field">
              <label class="cce-label" for="cce-kmyear">Km per jaar</label>
              <input type="text" id="cce-kmyear" class="cce-input" data-role="kmPerYear"
                     inputmode="numeric" placeholder="00.000" autocomplete="off" />
            </div>
          </div>
          <div class="cce-field">
            <label class="cce-label" for="cce-province">Provincie</label>
            <select id="cce-province" class="cce-select" data-role="province"></select>
          </div>
        </fieldset>

        <button type="submit" class="cce-submit" data-role="submit">
          <span data-role="submit-label">Bereken op ANWB.nl</span>
        </button>

        <div class="cce-feedback" data-role="feedback" hidden></div>
      </form>
    `;

    const $ = (role) => mount.querySelector(`[data-role="${role}"]`);
    const plate = $('plate');
    const mileage = $('mileage');
    const price = $('price');
    const kmPerYear = $('kmPerYear');
    const years = $('years');
    const province = $('province');
    const subtitle = $('subtitle');
    const feedback = $('feedback');
    const submit = $('submit');
    const submitLabel = $('submit-label');

    years.innerHTML = OWNERSHIP_YEARS
      .map((n) => `<option value="${n}">${n} jaar</option>`)
      .join('');
    province.innerHTML = PROVINCES
      .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
      .join('');

    attachNumberFormatting(mileage);
    attachNumberFormatting(price);
    attachNumberFormatting(kmPerYear);

    plate.addEventListener('input', () => {
      plate.value = plate.value.toUpperCase();
      const formatted = root.KentekenUtils?.format(plate.value);
      if (formatted) plate.value = formatted;
    });

    onClose && mount.querySelector('[data-role="close"]')?.addEventListener('click', onClose);

    function showFeedback(text, type = 'error') {
      feedback.textContent = text;
      feedback.className = `cce-feedback cce-feedback--${type}`;
      feedback.hidden = false;
    }

    function clearFeedback() {
      feedback.hidden = true;
    }

    // Vehicle details extracted from the listing. Used only when there is no
    // plate, to drive ANWB's make/model form instead.
    let vehicleDetails = null;

    function hasVehicleDetails() {
      return Boolean(vehicleDetails && vehicleDetails.brand && vehicleDetails.model);
    }

    /**
     * With the car's make and model known, ANWB can be driven without a plate.
     * Mark the field optional so it does not read as a required field the user
     * has to go and find — the fallback handles it.
     */
    function updatePlateHint() {
      const label = mount.querySelector('[data-role="plate-label"]');
      if (label) label.textContent = hasVehicleDetails() ? 'Kenteken (optioneel)' : 'Kenteken';

      // A "fill in a kenteken" complaint is obsolete once we know the car, so
      // drop it rather than leaving a stale warning on screen.
      if (hasVehicleDetails()) clearFeedback();
    }

    // Persist settings as soon as they change, so the next calculation uses them.
    const saveSettings = () => writeSettings(currentSettings());
    years.addEventListener('change', saveSettings);
    province.addEventListener('change', saveSettings);
    kmPerYear.addEventListener('change', saveSettings);

    function currentSettings() {
      return {
        ownershipYears: Number(years.value) || DEFAULT_SETTINGS.ownershipYears,
        kmPerYear: parseNumber(kmPerYear.value) || DEFAULT_SETTINGS.kmPerYear,
        province: province.value || DEFAULT_SETTINGS.province,
      };
    }

    async function applySettings(settings = {}) {
      const merged = { ...DEFAULT_SETTINGS, ...settings };
      years.value = String(merged.ownershipYears);
      province.value = merged.province;
      kmPerYear.value = formatNumber(merged.kmPerYear);
    }

    mount.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFeedback();

      const cleanPlate = root.KentekenUtils?.clean(plate.value) || '';
      const hasPlate = cleanPlate.length === 6 && root.KentekenUtils?.isValid(cleanPlate);

      // Without a plate we describe the car instead, so the user may submit
      // with the field empty — but only if we actually know what the car is.
      if (!hasPlate && !hasVehicleDetails()) {
        showFeedback(
          cleanPlate.length === 0
            ? 'Vul een kenteken in, of zoek de auto op merk en model.'
            : 'Dit is geen geldig Nederlands kenteken.'
        );
        plate.focus();
        return;
      }

      const settings = currentSettings();
      const payload = {
        licensePlate: hasPlate ? root.KentekenUtils.format(cleanPlate) : null,
        cleanPlate: hasPlate ? cleanPlate : null,
        mileage: parseNumber(mileage.value),
        price: parseNumber(price.value),
        ownershipYears: settings.ownershipYears,
        kmPerYear: settings.kmPerYear,
        province: settings.province,
        carTitle: subtitle.dataset.carTitle || '',
        // Present only on the make/model path; ignored when a plate is used.
        vehicle: hasPlate ? null : vehicleDetails,
        timestamp: Date.now(),
      };

      await saveSettings();

      submit.disabled = true;
      submitLabel.textContent = 'ANWB openen…';

      try {
        await launch(payload);
        if (options.onSubmit && options.onSubmit(payload) === false) return;
      } finally {
        submit.disabled = false;
        submitLabel.textContent = 'Bereken op ANWB.nl';
      }
    });

    return {
      /** Prefill the extracted AutoScout24 values. */
      setValues({ licensePlate, mileage: km, price: carPrice, title, vehicle } = {}) {
        if (licensePlate) plate.value = licensePlate;
        if (Number.isFinite(km)) mileage.value = formatNumber(km);
        if (Number.isFinite(carPrice)) price.value = formatNumber(carPrice);
        if (vehicle) vehicleDetails = vehicle;
        this.setTitle(title);
        updatePlateHint();
      },

      /**
       * Reflect whether a plate is required. With vehicle details on hand the
       * field is optional, and not saying so leaves the user stuck.
       */
      setVehicleDetails(vehicle) {
        vehicleDetails = vehicle || null;
        updatePlateHint();
      },

      setTitle(title) {
        subtitle.dataset.carTitle = title || '';
        subtitle.textContent = title || '';
        subtitle.hidden = !title;
      },

      async applySettings(settings) {
        await applySettings(settings);
      },

      /** True when no kenteken could be extracted from the page. */
      needsPlate() {
        return !root.KentekenUtils?.isValid(plate.value);
      },

      focusPlate() {
        plate.focus();
      },

      showFeedback,
      clearFeedback,
      element: mount,
    };
  }

  return {
    PROVINCES,
    OWNERSHIP_YEARS,
    DEFAULT_SETTINGS,
    ANWB_URL,
    formatNumber,
    parseNumber,
    attachNumberFormatting,
    readSettings,
    writeSettings,
    launch,
    render,
  };
});
