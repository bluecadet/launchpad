/**
 * @param {string} [message]
 */
export const fetchError = (message) => ({
	type: 'fetch',
	message
});

/**
 * @param {string} [message]
 */
export const parseError = (message) => ({
	type: 'parse',
	message
});

/**
 * @param {string} [message]
 */
export const configError = (message) => ({
	type: 'config',
	message
});

/**
 * @typedef {ReturnType<typeof fetchError> | ReturnType<typeof parseError> | ReturnType<typeof configError>} SourceError
 */
