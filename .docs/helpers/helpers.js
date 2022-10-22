/**
 * Launchpad helpers for jsdoc2markdown.
 * @see https://github.com/jsdoc2md/dmd
 * @module
 */

/**
 * Replaces all `\n`, `\r` and `\r\n` with `<br>`
 * @param {string} input 
 * @returns {string}
 */
exports.linebreaksToBr = function (options) {
  return options.fn(this).replace(/(?:\r\n|\r|\n)/g, '<br>');
}
