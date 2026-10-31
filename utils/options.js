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
    {
      id: 'metallicPaint',
      anwb: ['metallic'],
      // paintType is authoritative, so no equipment words are needed.
      field: { name: 'paintType', matches: /^metallic$/i },
    },
    {
      id: 'sunroof',
      anwb: ['schuifdak', 'zonnedak', 'open dak', 'panoramadak', 'glazen dak'],
      as24: ['open dak', 'panoramadak', 'schuifdak', 'zonnedak'],
    },
    {
      id: 'leather',
      anwb: ['lederen bekleding', 'leer'],
      as24: ['lederen bekleding'],
    },
    {
      id: 'towbar',
      anwb: ['trekhaak'],
      as24: ['trekhaak'],
    },
    {
      id: 'navigation',
      anwb: ['navigatie'],
      as24: ['navigatiesysteem', 'navigatie'],
    },
    {
      id: 'cruiseControl',
      anwb: ['cruisecontrol'],
      as24: ['cruisecontrol'],
    },
    {
      id: 'parkingSensors',
      anwb: ['parkeersensoren', 'parkeerhulp'],
      as24: ['parkeerhulp'],
    },
    {
      id: 'alloyWheels',
      anwb: ['lichtmetalen velgen', 'aluminium velgen'],
      as24: ['lichtmetalen velgen'],
    },
    {
      id: 'seatHeating',
      anwb: ['stoelverwarming'],
      as24: ['stoelverwarming'],
    },
    {
      id: 'climateControl',
      anwb: ['klimaatregeling', 'airconditioning'],
      as24: ['automatische klimaatregeling', 'airconditioning'],
    },
  ];

  /** Does an ANWB option label belong to this concept? */
  function anwbMatchesConcept(concept, anwbLabel) {
    const text = normalise(anwbLabel);
    return concept.anwb.some((word) => text.includes(normalise(word)));
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
