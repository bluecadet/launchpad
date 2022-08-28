/**
 * Options for server.
 */
export class ServerOptions {
  constructor({
    enabled = false,
    auth = {
      "enabled": true,
      "jwtEXpiresIn": "48h",
      "loginUrl": "/login",
      "dbCollection": "users"
    },
    transports = {
      "http": {
        "enabled": false,
        "port": 7676,
        "basePath": "/" // TODO: enable this!
      },
      "websockets": {
        "enabled": false,
        "port": 7676,  // TODO: enable this!
        "basePath": "/ws" // TODO: enable this!
      },
      "osc": {
        "enabled": false,
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
