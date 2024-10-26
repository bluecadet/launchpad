/**
 * @param {string} [message]
 */
export const fetchError = (message) => ({
	type: /** @type {const} */ ('fetch'),
	message
});

/**
 * @param {string} [message]
 */
export const parseError = (message) => ({
	type: /** @type {const} */ ('parse'),
	message
});

/**
 * @param {string} [message]
 */
export const configError = (message) => ({
	type: /** @type {const} */ ('config'),
	message
});

/**
 * @typedef {ReturnType<typeof fetchError> | ReturnType<typeof parseError> | ReturnType<typeof configError>} SourceError
 */
