#!/usr/bin/env node

import express from "express";
import cors from 'cors';
import bodyParser from "body-parser";

import { LogManager, Logger } from '@bluecadet/launchpad-utils';

import { Authentication } from './authentication.js';
// import { HttpApi } from './httpApi.js';
// import { WsApi } from './wsApi.js';
// import { OscApi } from './oscApi.js';

export class LaunchpadServer {

  _config;

  _app;

  _server;

  _logger;

  _auth = null;

  _httpApi = null;

  _wsApi = null;

  _oscApi = null;

  constructor(config, parentLogger, commandCenter) {
    this._config = config;
    this._logger = LogManager.getInstance().getLogger('server', parentLogger);
  }

  startUp() {

    if (!this._config.server.enabled) {
      this._logger.warn("Server is disabled");
      return;
    }

    this._logger.info("Server Starting up!");
    const PORT = this._config.server.transports.http.port;

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
    // if (this._config.server.httpApi.enabled) {
    //   this._httpApi = new HttpApi(this);
    //   this._httpApi.init();
    // }

    // // ws API
    // if (this._config.server.wsApi.enabled) {
    //   this._wsApi = new WsApi(this);
    // }

    // // esc API
    // if (this._config.server.oscApi.enabled) {
    //   this._oscApi = new OscApi(this);
    //   this._oscApi.init();
    // }

    // // Start express on the defined port
    // this._server = this._app.listen(this._config.server.port, () => {
    //   this._logger.info(`🚀 Server running on port ${this._config.server.port}`);
    // });

    // // Init wss after server is running.
    // if (this._config.server.wsApi.enabled) {
    //   this._wsApi.init();
    // }
  }

  shutdown() {
    this._logger.info("Server shutting down...");
    this._logger.info("... server shut down");
  }
}
