"use strict";

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced (not merged). Only plain objects are recursed.
 *
 * @param {object} target
 * @param {object} source
 * @returns {object} New merged object (does not mutate inputs)
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key]
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { deepMerge };
