#!/usr/bin/env node

import express from "express";
import cors from 'cors';
import bodyParser from "body-parser";

import { LogManager, Logger } from '@bluecadet/launchpad-utils';

import { Authentication } from './authentication.js';
import { HttpTransport } from './transports/http.js';
import { WebsocketsTransport } from './transports/websockets.js';
import { OscTransport } from './transports/osc.js';

export class LaunchpadServer {

  _config;

  _commandCenter;

  _app;

  _server;

  _logger;

  _auth = null;

  _httpApi = null;

  _websocketsTransport = null;

  _oscApi = null;

  constructor(config, parentLogger, commandCenter) {
    this._config = config;
    this._logger = LogManager.getInstance().getLogger('server', parentLogger);
    this._commandCenter = commandCenter;
  }

  startUp() {

    if (!this._config.server.enabled) {
      this._logger.warn("Server is disabled");
      return;
    }

    this._logger.info("Server Starting up!");
    // console.log(this._config);
    const PORT = this._config.server.transports.http.port;
    console.log(this._config.server.transports);

    // Initialize express and define a port
    this._app = express();
    this._app.use(cors());
    this._app.use(bodyParser.json()); // Tell express to use body-parser's JSON parsing

    // Check for use of Authentication.
    // At the moment, only http and ws server can use Authentication.
    if (this._config.server.auth.enabled && (this._config.server.transports.http.enabled || this._config.server.transports.http.enabled)) {
      this._auth = new Authentication(this);
      this._auth.init();
    }

    // http API
    if (this._config.server.transports.http.enabled) {
      this._httpApi = new HttpTransport(this);
      this._httpApi.init();
    }

    // websockets API
    if (this._config.server.transports.websockets.enabled) {
      this._websocketsTransport = new WebsocketsTransport(this);
    }

    // OSC API
    if (this._config.server.transports.osc.enabled) {
      this._oscApi = new OscTransport(this);
      this._oscApi.init();
    }

    // Start express on the defined port
    this._server = this._app.listen(PORT, () => {
      this._logger.info(`🚀 Server running on port ${PORT}`);
    });

    // Init wss after server is running.
    if (this._config.server.transports.websockets.enabled) {
      this._websocketsTransport.init();
    }
  }

  shutdown() {
    this._logger.info("Server shutting down...");

    // Disconnect OSC server.
    // TODO: how to do this correctly?

    // Disconnect websockets server.
    // TODO: how to do this correctly?

    // Disconnect http server.
    // TODO: how to do this correctly?

    this._logger.info("... server shut down");
  }

  updateContent() {
    this._commandCenter.run('update-content');
  }

  shutdown() {
    this._commandCenter.run('shutdown');
  }

  startApps() {
    this._commandCenter.run('start-apps');
  }

  stopApps() {
    this._commandCenter.run('stop-apps');
  }
}
