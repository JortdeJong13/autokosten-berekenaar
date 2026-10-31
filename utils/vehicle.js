/**
 * Make/model fallback.
 *
 * When a listing has no licence plate we cannot ask ANWB to look the car up, so
 * we have to describe it instead. ANWB's make/model form asks for Merk, Model,
 * Bouwjaar, Bouwmaand and (only for some cars — see below) Brandstofsoort.
 *
 * Everything here is a pure function so it can be unit tested without a browser.
 *
 * The hard part is that the two sites name models differently:
 *
 *   AutoScout24     ANWB                 outcome
 *   "Golf"          "Golf"               exact
 *   "A3 Sportback"  "A3"                 prefix
 *   "GLC 300"       "Glc-Klasse"         prefix on the first token
 *   "318I"          "3-Serie"            needs the numeric-series heuristic
 *
 * A wrong match gives a plausible but incorrect cost, which is worse than no
 * match. So `matchModel` reports a confidence, and anything below "high" is
 * meant to be confirmed by the user on the ANWB page rather than trusted.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VehicleUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Confidence levels, ordered. */
  const Confidence = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

  /**
   * AutoScout24 writes some brands differently from ANWB. Keys are normalised
   * (lowercase, alphanumerics only).
   */
  const BRAND_ALIASES = {
    mercedesbenz: ['mercedes', 'mercedes benz'],
    vw: ['volkswagen'],
    citroen: ['citroen'],
    alfaromeo: ['alfa romeo'],
    landrover: ['land rover'],
    greatwall: ['great wall'],
    ds: ['ds automobiles'],
    mini: ['mini'],
    seat: ['seat'],
    skoda: ['skoda'],
  };

  /** Lowercase, strip everything that is not a letter or digit. */
  function normalise(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip accents: Citroën -> Citroen
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Which ANWB fuel option each AutoScout24 label corresponds to.
   *
   * ANWB's dropdown varies per car. A car sold with several powertrains gets
   * four options (Benzine, Diesel, PHEV Benzine, PHEV Diesel); a car that is
   * only electric gets a single "Elektrisch". Both were checked against the
   * live site.
   *
   * The plug-in patterns are matched before the plain ones so that
   * "Elektro/Benzine" is not read as an ordinary petrol car.
   */
  const FUEL_MAP = [
    [/^elektro\s*\/\s*benzine$|^elektrobenzine$|^phev\s*benzine$/i, 'PHEV Benzine'],
    [/^elektro\s*\/\s*diesel$|^elektrodiesel$|^phev\s*diesel$/i, 'PHEV Diesel'],
    [/^benzine$|^petrol$|^gasoline$/i, 'Benzine'],
    [/^diesel$/i, 'Diesel'],
    // Pure battery electric. ANWB does offer this, for cars that are EV-only.
    [/^elektrisch$|^elektro$|^electric$|^bev$/i, 'Elektrisch'],
  ];

  /**
   * Map an AutoScout24 fuel label to the ANWB option text.
   *
   * Returns null only for labels ANWB genuinely has no equivalent for (LPG,
   * waterstof, ethanol, aardgas, overig). Callers must not treat null as
   * "leave the field blank" when ANWB is showing it and asking for an answer —
   * see resolveFuelOption in content/anwb.js.
   */
  function mapFuel(as24Fuel) {
    const raw = String(as24Fuel ?? '').trim();
    if (!raw) return null;

    const norm = normalise(raw);
    // "Elektro/Benzine" normalises to "elektrobenzine".
    for (const [pattern, anwb] of FUEL_MAP) {
      if (pattern.test(raw) || pattern.test(norm)) return anwb;
    }

    return null;
  }

  /** AutoScout24 transmission label -> ANWB option text. */
  function mapTransmission(as24Transmission) {
    const norm = normalise(as24Transmission);
    if (!norm) return null;
    if (/^(automatisch|automaat|automatic|auto)$/.test(norm)) return 'Automaat';
    if (/^(handgeschakeld|schakel|manual|manueel)$/.test(norm)) return 'Handgeschakeld';
    return null;
  }

  /**
   * "2021-01-01" -> { year: 2021, month: 1 }
   * Also accepts a bare year, or an AS24 "01/2021" style string.
   */
  function parseProductionDate(value) {
    if (value == null) return { year: null, month: null };
    const raw = String(value).trim();

    // ISO-ish: 2021-01-01
    let m = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };

    // Dutch/AS24 display: 01/2021 or 1-2021
    m = raw.match(/^(\d{1,2})[\/-](\d{4})$/);
    if (m) return { year: Number(m[2]), month: Number(m[1]) };

    // Bare year
    m = raw.match(/^(\d{4})$/);
    if (m) return { year: Number(m[1]), month: null };

    return { year: null, month: null };
  }

  const optionText = (option) => String(option?.text ?? option ?? '').trim();

  /**
   * Match an AutoScout24 brand against ANWB's brand list.
   * Returns { option, confidence } — option is null when nothing fits.
   */
  function matchBrand(anwbBrands, as24Brand) {
    const target = normalise(as24Brand);
    if (!target || anwbBrands.length === 0) return { option: null, confidence: Confidence.NONE };

    const options = anwbBrands.map((o) => ({ raw: o, norm: normalise(optionText(o)) }));

    // 1. Exact.
    const exact = options.find((o) => o.norm === target);
    if (exact) return { option: exact.raw, confidence: Confidence.HIGH };

    // 2. Alias (Mercedes-Benz -> Mercedes).
    for (const alias of BRAND_ALIASES[target] || []) {
      const hit = options.find((o) => o.norm === normalise(alias));
      if (hit) return { option: hit.raw, confidence: Confidence.HIGH };
    }

    // 3. One contains the other. "mercedesbenz" contains "mercedes".
    const contained = options.find((o) => o.norm && (target.includes(o.norm) || o.norm.includes(target)));
    if (contained) return { option: contained.raw, confidence: Confidence.MEDIUM };

    return { option: null, confidence: Confidence.NONE };
  }

  /**
   * Candidate prefixes for a model name, longest first.
   *
   * "GLC 300" -> ["glc300", "glc"]   (ANWB calls it "Glc-Klasse", so the
   *                                   leading letters are what match)
   * "A3 Sportback" -> ["a3sportback", "a3"]
   * "318I" -> ["i"]                 (leading digits are handled separately)
   */
  function modelPrefixes(value) {
    const norm = normalise(value);
    const leadingAlpha = norm.match(/^[a-z]+/)?.[0] || '';
    const alnumRun = norm.match(/^[a-z]*\d+[a-z]*/)?.[0] || norm;

    return [...new Set([norm, alnumRun, leadingAlpha])].filter((p) => p && p.length >= 2);
  }

  /** Leading digits of a model name: "318I" -> "318", "GLC 300" -> "". */
  function leadingNumber(value) {
    return normalise(value).match(/^(\d+)/)?.[1] || '';
  }

  /**
   * Match an AutoScout24 model against the ANWB model list for that brand.
   *
   * Returns { option, confidence, candidates }. `candidates` is always the full
   * list, so the caller can offer a picker when confidence is low.
   */
  function matchModel(anwbModels, as24Model) {
    const options = anwbModels.map((o) => ({ raw: o, norm: normalise(optionText(o)) }));
    const target = normalise(as24Model);

    // Candidate labels are plain strings so a picker can render them directly.
    const candidates = options.map((o) => optionText(o.raw));

    if (!target || options.length === 0) {
      return { option: null, confidence: Confidence.NONE, candidates };
    }

    // 1. Exact.
    const exact = options.find((o) => o.norm === target);
    if (exact) return { option: exact.raw, confidence: Confidence.HIGH, candidates };

    // 2. One contains the other: "A3 Sportback" <-> "A3".
    const contained = options.find((o) => o.norm.length > 1 && (o.norm.includes(target) || target.includes(o.norm)));
    if (contained) return { option: contained.raw, confidence: Confidence.HIGH, candidates };

    // 3. Shared prefix: "GLC 300" -> "Glc-Klasse", longest prefix first.
    for (const prefix of modelPrefixes(as24Model)) {
      const prefixed = options.find((o) => o.norm.startsWith(prefix));
      if (prefixed) return { option: prefixed.raw, confidence: Confidence.MEDIUM, candidates };
    }

    // 4. Numeric series: AutoScout24 names BMWs by engine ("318I") where ANWB
    //    uses the series ("3-Serie"). The leading digit is the series.
    const digits = leadingNumber(as24Model);
    if (digits) {
      const series = digits[0];
      const bySeries = options.find((o) => o.norm.startsWith(series) && /serie|klasse|class/.test(o.norm));
      if (bySeries) return { option: bySeries.raw, confidence: Confidence.LOW, candidates };
    }

    // No match: the caller should let the user pick. Note models like "318I"
    // landing here means the series heuristic missed, and a wrong guess would
    // silently produce the wrong running costs.
    return { option: null, confidence: Confidence.NONE, candidates };
  }

  const MONTH_NAMES = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ];

  /** 1 -> "Januari" (the text ANWB renders in its month dropdown). */
  function monthName(month) {
    const index = Number(month) - 1;
    return MONTH_NAMES[index] ? MONTH_NAMES[index][0].toUpperCase() + MONTH_NAMES[index].slice(1) : null;
  }

  /**
   * Build the payload for ANWB's make/model flow from extracted listing data.
   * Returns null when there is not enough to identify the car.
   */
  function buildVehiclePayload(vehicle = {}) {
    const { year, month } = parseProductionDate(vehicle.productionDate);
    const payload = {
      brand: vehicle.brand || null,
      model: vehicle.model || null,
      year: vehicle.year ?? year,
      month: vehicle.month ?? month,
      doors: vehicle.doors ?? null,
      fuel: vehicle.fuel || null,
      transmission: vehicle.transmission || null,
      // Evidence used later to answer ANWB's options step. Dropping these
      // here silently left every option unticked, because the matcher saw a
      // vehicle with no paint type and no equipment.
      paintType: vehicle.paintType || null,
      equipment: Array.isArray(vehicle.equipment) ? vehicle.equipment : [],
    };

    const usable = payload.brand && payload.model && payload.year;
    return usable ? payload : null;
  }

  return {
    Confidence,
    normalise,
    mapFuel,
    mapTransmission,
    parseProductionDate,
    matchBrand,
    matchModel,
    monthName,
    buildVehiclePayload,
    MONTH_NAMES,
  };
});
