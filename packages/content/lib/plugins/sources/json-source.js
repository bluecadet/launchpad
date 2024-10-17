import chalk from "chalk";
import ky from "ky";

/**
 * @param {object} options
 * @param {Record<string, string>} options.files A mapping of json key -> url
 * @param {number} [options.maxTimeout] Max request timeout in ms. Defaults to 30 seconds.
 * @returns {import("../../content-plugin-driver.js").ContentPlugin}
 */
export default function jsonSource({ files, maxTimeout = 30_000 }) {
  return {
    name: 'json-source',
    hooks: {
      async onContentFetchData(ctx) {
        for (const [key, url] of Object.entries(files)) {
          ctx.logger.debug(`Downloading json ${chalk.blue(url)}`);
          const response = await ky(url, {
            timeout: maxTimeout
          });
          const json = await response.json();
          ctx.data.insert(key, json);
        }
      }
    }
  }
}