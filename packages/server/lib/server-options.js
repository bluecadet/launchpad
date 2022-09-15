/**
 * Options for server.
 */
export class ServerOptions {
  constructor({
    enabled = false,
    auth = {
      "enabled": true,
      "jwtExpiresIn": "48h",
      "loginUrl": "/login",
      "dbCollection": "users"
    },
    transports = new TransportsOptions(),
    ...rest // Any additional custom arguments
  } = {}) {

    // TODO: add documentation
    /**
     *
     */
    this.enabled = enabled;

    // TODO: add documentation
    /**
     *
     */
    this.auth = auth;

    // TODO: add documentation
    /**
     *
     */
    this.transports = new TransportsOptions(transports);

    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export default ServerOptions;

export class TransportsOptions {
  constructor({
    http = new HttpOptions(),
    websockets = new WebsocketsOptions(),
    osc = new OscOptions(),
    ...rest // Any additional custom arguments
  } = { }) {

    // TODO: add documentation
    /**
     *
     */
    this.http = new HttpOptions(http);

    // TODO: add documentation
    /**
     *
     */
    this.websockets = new WebsocketsOptions(websockets);

    // TODO: add documentation
    /**
     *
     */
    this.osc = new OscOptions(osc);

    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export class HttpOptions {
  constructor({
    enabled = false,
    port = 7676,
    basePath = "", // Does not include trailing slash.
    ...rest // Any additional custom arguments
  } = {}) {
    // TODO: add documentation
    /**
     *
     */
    this.enabled = enabled;

    // TODO: add documentation
    /**
     *
     */
    this.port = port;

    // TODO: add documentation
    /**
     *
     */
    this.basePath = basePath;

    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export class WebsocketsOptions {
  constructor({
    enabled = false,
    port = 7676,  // TODO: enable this!
    basePath = "/ws", // TODO: enable this!
    ...rest // Any additional custom arguments
  } = {}) {
    // TODO: add documentation
    /**
     *
     */
    this.enabled = enabled;

    // TODO: add documentation
    /**
     *
     */
    this.port = port;

    // TODO: add documentation
    /**
     *
     */
    this.basePath = basePath;

    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export class OscOptions {
  constructor({
    enabled = false,
    port = 3000,
    ...rest // Any additional custom arguments
  } = {}) {
    // TODO: add documentation
    /**
     *
     */
    this.enabled = enabled;

    // TODO: add documentation
    /**
     *
     */
    this.port = port;
    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}
