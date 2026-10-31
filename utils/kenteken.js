/**
 * Dutch License Plate (Kenteken) Utilities
 * Supports all RDW sidecodes (1 through 14)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KentekenUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // RDW Sidecodes 1 to 14 pattern definitions
  const SIDECODES = [
    { id: 1, regex: /^([A-Z]{2})([0-9]{2})([0-9]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 2, regex: /^([0-9]{2})([0-9]{2})([A-Z]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 3, regex: /^([0-9]{2})([A-Z]{2})([0-9]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 4, regex: /^([A-Z]{2})([0-9]{2})([A-Z]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 5, regex: /^([A-Z]{2})([A-Z]{2})([0-9]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 6, regex: /^([0-9]{2})([A-Z]{2})([A-Z]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 7, regex: /^([0-9]{2})([A-Z]{3})([0-9]{1})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 8, regex: /^([0-9]{1})([A-Z]{3})([0-9]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 9, regex: /^([A-Z]{2})([0-9]{3})([A-Z]{1})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 10, regex: /^([A-Z]{1})([0-9]{3})([A-Z]{2})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 11, regex: /^([A-Z]{3})([0-9]{2})([A-Z]{1})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 12, regex: /^([A-Z]{1})([0-9]{2})([A-Z]{3})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 13, regex: /^([0-9]{3})([A-Z]{2})([0-9]{1})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { id: 14, regex: /^([0-9]{1})([A-Z]{2})([0-9]{3})$/, format: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  ];

  /**
   * Clean input string by removing non-alphanumeric characters and converting to uppercase
   */
  function clean(input) {
    if (!input || typeof input !== 'string') return '';
    return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Check if cleaned string matches any valid Dutch sidecode
   */
  function isValid(input) {
    const cleaned = clean(input);
    if (cleaned.length !== 6) return false;
    return SIDECODES.some((sc) => sc.regex.test(cleaned));
  }

  /**
   * Format any raw license plate string to official Dutch hyphenated format (e.g. "12-ABC-3")
   * Returns null if not a valid Dutch plate.
   */
  function format(input) {
    const cleaned = clean(input);
    if (cleaned.length !== 6) return null;
    for (const sc of SIDECODES) {
      const match = cleaned.match(sc.regex);
      if (match) {
        return sc.format(match);
      }
    }
    return null;
  }

  /**
   * Scan text content to find potential Dutch license plates
   * 1. Looks for explicit "kenteken" labels first
   * 2. Scans for strict hyphenated patterns
   */
  function findInText(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. Explicit keyword match (highest confidence)
    // Matches patterns like "Kenteken: N-123-AB" or "kenteken 12ABC3"
    const labelRegex = /(?:kenteken|licence\s*plate|license\s*plate|kent\.)[:\s]+([a-zA-Z0-9\s-]{6,12})/gi;
    let labelMatch;
    while ((labelMatch = labelRegex.exec(text)) !== null) {
      const candidate = labelMatch[1];
      const cleaned = clean(candidate);
      if (cleaned.length >= 6) {
        const formatted = format(cleaned.slice(0, 6));
        if (formatted) return formatted;
      }
    }

    // 2. Strict hyphenated pattern matches (e.g., "12-ABC-3", "N-123-AB", "X-999-XX")
    const strictPattern = /\b([0-9A-Z]{1,3}-[0-9A-Z]{1,3}-[0-9A-Z]{1,3})\b/gi;
    let match;
    while ((match = strictPattern.exec(text)) !== null) {
      const formatted = format(match[1]);
      if (formatted) return formatted;
    }

    return null;
  }

  /**
   * Deep search an object for license plate fields
   */
  function findInObject(obj, maxDepth = 6) {
    if (!obj || typeof obj !== 'object' || maxDepth <= 0) return null;

    const targetKeys = [
      'licenseplate',
      'license_plate',
      'kenteken',
      'registrationnumber',
      'registration_number',
      'platenumber',
      'plate_number',
      'registration',
      'rdwkenteken'
    ];

    // Check direct keys first
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        const lowerKey = key.toLowerCase();
        if (targetKeys.some((tk) => lowerKey.includes(tk))) {
          const formatted = format(value) || findInText(value);
          if (formatted) return formatted;
        }
      }
    }

    // Recursive search
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        const found = findInObject(value, maxDepth - 1);
        if (found) return found;
      }
    }

    return null;
  }

  return {
    clean,
    isValid,
    format,
    findInText,
    findInObject,
    SIDECODES
  };
});
