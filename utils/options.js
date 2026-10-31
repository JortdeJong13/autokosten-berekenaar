/**
 * Matching ANWB's option questions against what AutoScout24 tells us.
 *
 * Design rule: this must NOT contain a per-make or per-model table. ANWB's
 * option list is per-car (a Mercedes GLC offers two, other cars offer others),
 * and hard-coding any of that would rot the moment either site changes.
 *
 * Instead we work at the level of *concepts*:
 *
 *   ANWB writes an option in Dutch  ->  which concept is it?
 *   AutoScout24 tells us facts      ->  do we have evidence for that concept?
 *
 * Both sides are generic. "Metallic lak" and "Metallic" are the same concept
 * whether the car is a Kia or a Porsche, and it is answered by a structured
 * field (`paintType`), not by a lookup table. A roof question is answered by
 * looking for any roof-related item in AS24's equipment list, regardless of
 * how the manufacturer words it.
 *
 * Unmatched concepts simply leave the box unticked. A wrong tick inflates the
 * car's value, so silence is the safer failure.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OptionsUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const normalise = (value) =>
    String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

  /**
   * Concept definitions, keyed by a neutral name.
   *
   * `anwb`  — words that identify the concept in ANWB's option text.
   * `as24`  — words that identify it in an AutoScout24 equipment item.
   * `field` — a structured AS24 field that answers it outright, if any.
   *
   * These are concept vocabularies, deliberately not make- or model-specific.
   */
  const CONCEPTS = [
    // --- Paint: answered by a structured field, not by equipment ---
    // AS24 reports paintType outright, and ANWB prices each finish
    // separately, so these map one-to-one on the word itself.
    {
      id: 'metallicPaint',
      anwb: ['metallic lak', 'metallic'],
      field: { name: 'paintType', matches: /^metallic$/i },
    },
    {
      id: 'micaPaint',
      anwb: ['mica lak', 'mica'],
      field: { name: 'paintType', matches: /^mica$/i },
    },
    {
      id: 'pearlPaint',
      anwb: ['pareleffectlak', 'parelmoer', 'pareleffect'],
      field: { name: 'paintType', matches: /^(parel|pearl)/i },
    },

    // --- Equipment: matched on the shared Dutch/English vocabulary ---
    // Both sites describe these the same way, so a concept mapping is enough
    // and no per-make list is involved.
    {
      id: 'leather',
      anwb: ['lederen bekleding', 'leren bekleding'],
      as24: ['lederen bekleding'],
    },
    {
      id: 'climateControl',
      anwb: ['automatic climate control', 'klimaatregeling'],
      as24: ['automatische klimaatregeling'],
    },
    {
      id: 'cruiseControl',
      anwb: ['cruise control', 'cruisecontrol'],
      // Adaptive cruise is a superset: a car with it also has cruise control.
      as24: ['cruisecontrol', 'adaptieve cruise control'],
    },
    {
      id: 'rainSensor',
      anwb: ['regensensor'],
      as24: ['regensensor'],
    },
    {
      id: 'heatedSeats',
      // "stoel" + "verwarm" also covers ANWB's "STOELEN VERWARMED" spelling,
      // while excluding "VERWARMDE VOORRUIT" (no seat).
      anwbAll: [['stoel', 'verwarm'], ['stoelverwarming']],
      as24: ['stoelverwarming'],
    },
    {
      id: 'electricSeat',
      // Excludes "ZIJRUITEN ELEKTRISCH VOOR" (no seat) and
      // "HOOGTEVERSTELLING STOEL" (not electric).
      anwbAll: [['stoel', 'elektrisch'], ['elektrische stoelverstelling']],
      as24: ['elektrische stoelverstelling'],
    },
    {
      id: 'parkingSensors',
      anwb: ['parkdistance', 'parkeersensoren', 'parkeerhulp', 'parkeerhulp'],
      as24: ['parkeerhulp'],
    },
    {
      id: 'alloyWheels',
      anwb: ['lichtmetalen velgen', 'aluminium velgen'],
      as24: ['lichtmetalen velgen'],
    },
    {
      id: 'navigation',
      anwb: ['navigatie'],
      as24: ['navigatiesysteem'],
    },

    // --- Roof: matched, but the type is not always specified ---
    // AS24 says only "Open dak". ANWB distinguishes a plain sliding roof from
    // an electrically operated one, at different prices. A car listed with a
    // roof almost certainly has the factory roof option, so this ticks, but it
    // is the least certain mapping here.
    {
      id: 'sunroof',
      anwb: ['schuifdak', 'zonnedak', 'open dak', 'panoramadak', 'glazen dak'],
      as24: ['open dak', 'panoramadak', 'schuifdak', 'zonnedak'],
    },
  ];


  /**
   * Does an ANWB option label belong to this concept?
   *
   * Two forms:
   *   `anwb`    — any one of these phrases appears.
   *   `anwbAll` — every token in one of these groups appears (order-free).
   *
   * The token form matters because ANWB's own labels are inconsistent: heated
   * seats appear as "STOELEN VERWARMED" (sic) in their data, while the heated
   * windscreen is "VERWARMDE VOORRUIT". Requiring both "stoel" and "verwarm"
   * distinguishes them without hard-coding a misspelling.
   */
  function anwbMatchesConcept(concept, anwbLabel) {
    const text = normalise(anwbLabel);
    const lower = text.replace(/\s+/g, ' ');

    if ((concept.anwb || []).some((phrase) => lower.includes(normalise(phrase)))) return true;

    return (concept.anwbAll || []).some((tokens) =>
      tokens.every((token) => lower.includes(normalise(token)))
    );
  }

  /** Is there AS24 evidence for this concept? */
  function hasEvidence(concept, vehicle) {
    if (!vehicle) return { supported: false, source: null };

    // A structured field answers it outright.
    if (concept.field) {
      const value = vehicle[concept.field.name];
      if (value != null) {
        return {
          supported: concept.field.matches.test(String(value)),
          source: `veld ${concept.field.name}=${value}`,
        };
      }
    }

    // Otherwise look through the equipment list.
    if (concept.as24 && Array.isArray(vehicle.equipment)) {
      const hit = vehicle.equipment.find((item) =>
        concept.as24.some((word) => normalise(item).includes(normalise(word)))
      );
      if (hit) return { supported: true, source: `uitrusting "${hit}"` };
    }

    return { supported: false, source: null };
  }

  /**
   * Decide whether to tick each of ANWB's offered options.
   *
   * @param {string[]} anwbOptions  option labels as ANWB renders them
   * @param {object}   vehicle      extracted listing data
   * @returns {Array<{label, tick, concept, source}>}
   */
  function resolveOptions(anwbOptions, vehicle) {
    return (anwbOptions || []).map((label) => {
      const concept = CONCEPTS.find((c) => anwbMatchesConcept(c, label));

      if (!concept) {
        // Unknown option: leave it, rather than guess. A wrong tick changes
        // the car's value, so an unticked box is the safe default.
        return { label, tick: false, concept: null, source: null };
      }

      const { supported, source } = hasEvidence(concept, vehicle);
      return { label, tick: supported, concept: concept.id, source };
    });
  }

  return { CONCEPTS, resolveOptions, normalise };
});
