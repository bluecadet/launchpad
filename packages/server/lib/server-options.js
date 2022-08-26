/**
 * Options for server.
 */
export class ServerOptions {
  constructor({
    enabled = false,
    auth = {
      "enabled": true,
      "jwtEXpiresIn": "48h", // TODO: enable this!
      "loginUrl": "/url" // TODO: enable this!
    },
    transports = {
      "http": {
        "enabled": true,
        "port": 7676
      },
      "websockets": {
        "enabled": true,
        "port": 7676,  // TODO: enable this!
        "basePath": "/ws" // TODO: enable this!
      },
      "osc": {
        "enabled": true,
        "port": 3000
      }
    },
    ...rest // Any additional custom arguments
  } = {}) {

    /**
     * TODO: add documentation
     */
    this.enabled = enabled;

    /**
     * TODO: add documentation
     */
    this.auth = auth;

    /**
     * TODO: add documentation
     */
    this.transports = transports;

    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export default ServerOptions;
