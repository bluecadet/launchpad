/**
 * Options for server.
 */
export class ServerOptions {
  constructor({
    enabled = false,
    auth = {
      "enabled": true,
      "jwtEXpiresIn": "48h", // todo: enable this!
      "loginUrl": "/url" // todo: enable this!
    },
    transports = {
      "http": {
        "enabled": true,
        "port": 7676
      },
      "websockets": {
        "enabled": true,
        "port": 7676,
        "basePath": "/ws" // todo: enable this!
      },
      "osc": {
        "enabled": true,
        "port": 3000
      }
    },
    ...rest // Any additional custom arguments
  } = {}) {

    /**
     * @todo: add documentation
     */
    this.enabled = enabled;

    /**
     * @todo: add documentation
     */
    this.auth = auth;

    /**
     * @todo: add documentation
     */
    this.transports = transports;

    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export default ServerOptions;
