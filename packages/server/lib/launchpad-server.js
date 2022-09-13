#!/usr/bin/env node
import Koa from 'koa';
import koaBody from 'koa-body';
import websockify from 'koa-websocket';
import jwt from 'koa-jwt';

import { LogManager } from '@bluecadet/launchpad-utils';

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
    const PORT = this._config.server.transports.http.port;

    // Initialize express and define a port.
    this._app = new Koa();
    this._app.use(koaBody());

    // TODO: enable CORS for koa.

    this._app.use(async (ctx, next) => {

      // Run All middleware.
      // TODO: should routes finish? Or do we need more for logging etc?
      await next();

      // Finalize everything here.
    });

    // Check for use of Authentication.
    // At the moment, only http and ws server can use Authentication.
    if (this._config.server.auth.enabled && (this._config.server.transports.http.enabled || this._config.server.transports.http.enabled)) {
      // Enable jwt token.
      // Custom 401 handling if you don't want to expose koa-jwt errors to users
      this._app.use(function(ctx, next){
        return next().catch((err) => {
          if (401 == err.status) {
            ctx.status = 401;
            ctx.body = 'Protected resource, use Authorization header to get access\n';
          } else {
            throw err;
          }
        });
      });

      this._app.use(jwt({
        secret: process.env.TOKEN_KEY,
        passthrough: true,
        getToken: (opts) => {
          console.log("Get Token");
          console.log(this);
          console.log(opts);
          return null;
        }
      }));


      this._auth = new Authentication(this);
      this._auth.init();
    }

    // Http API
    if (this._config.server.transports.http.enabled) {
      // this._httpApi = new HttpTransport(this);
      // this._httpApi.init();
    }

    // Websockets API
    if (this._config.server.transports.websockets.enabled) {
      this._app = websockify(this._app);
      this._websocketsTransport = new WebsocketsTransport(this);
      this._websocketsTransport.init();
    }

    // OSC API
    if (this._config.server.transports.osc.enabled) {
      this._oscApi = new OscTransport(this);
      this._oscApi.init();
    }

    // Start koa on the defined port
    this._server = this._app.listen(PORT);

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
