/**
 * Options for server.
 */
export class ServerOptions {
  constructor({
    enabled = false,
    auth = { "enabled": true },
    transports = {
      "http": {
        "enabled": true,
        "port": 8080
      },
      "websockets": {
        "enabled": true,
        "port": 3000
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
