import { WebSocketServer } from 'ws';
import Router from 'koa-router';

import queryString from "query-string";
import jwt from 'jsonwebtoken';
import winston from 'winston';
import WebsocketsLogging from '../logging/websockets-logging.js';

import { LogManager } from '@bluecadet/launchpad-utils';
import chalk from "chalk";

import Convert from 'ansi-to-html';
const convert = new Convert();

export class WebsocketsTransport {

  _launchpadServer;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
  }

  init() {

    let self = this;
    const wsRouter = new Router();

    const loggerTest = this._launchpadServer._logger;

    // TODO: handle seperate server.
    // TODO: how to authenticate the connection?
    let connection = (ctx, next) => {
      // return `next` to pass the context (ctx) on to the next ws middleware
      this._launchpadServer._logger.info("Websocket Connection...");
      const [_path, params] = ctx.request?.url?.split("?");
      const connectionParams = queryString.parse(params);
      // console.log(connectionParams);

      // Example of setting params on ws client so we know basic classification of who is connecting.
      // if (connectionParams.admin === "true") {
      //   ctx.websocket.admin = true;
      // }

      // TODO: Validate Connection.
      const token = connectionParams.token || "";

      if (!token) {
        ctx.websocket.close(3000, "A token is required for authentication");
        return next(ctx);
      }

      try {
        const decoded = jwt.verify(token, process.env.TOKEN_KEY);
        ctx.websocket.user = decoded;
        this._launchpadServer._logger.info(decoded.username + " connected");
      } catch (err) {
        this._launchpadServer._logger.error(err.message);
        ctx.websocket.close(3000, "Invalid Token");
        return next(ctx);
      }

      return next(ctx);
    };

    // In order to pass this class into the function, we need to use bind().
    connection.bind(self);
    wsRouter.use(connection);

    wsRouter.all('/ws', async (ctx, next) => {

      // `ctx` is the regular koa context created from the `ws` onConnection `socket.upgradeReq` object.
      // the websocket is added to the context on `ctx.websocket`.
      ctx.websocket.on('message', (message) => {
        console.log(message.toString());

        let parsedData = JSON.parse(message.toString('utf-8'));
        self.handleWsMessages(parsedData, ctx.websocket);
      });
      return next;
    });

    this._launchpadServer._app.ws.use(wsRouter.routes());
    this._launchpadServer._app.ws.use(wsRouter.allowedMethods());









    // Add in Winston Transport for logging over websockets.
    const mainLogger = LogManager.getInstance();

    mainLogger._logger.add(new WebsocketsLogging({
      'websocketsTransport': this,
      format: winston.format.combine(
        mainLogger._logger.format,
        winston.format.uncolorize()
      )
    }));

  }

  handleWsMessages(parsedData, ws) {

    switch (parsedData.type) {
      case 'status':
        let statusObj = {
          appsRunning: "Okie Dokie", // TODO: figure this out.
          lastContentDownload: 0, // TODO: figure this out.
          recentLogMessages: [] // TODO: figure this out.
        };

        ws.send(JSON.stringify(statusObj));
        break;

      // TODO: the rest of these should be in config somewhere.
      case 'content':
        this._launchpadServer.updateContentCmd();
        break;
      // case 'monitor:startup':
      //   this._launchpadServer.startup();
      //   break;
      case 'shutdown':
        this._launchpadServer.shutdownCmd();
        break;
      case 'start-apps':
        this._launchpadServer.startAppsCmd();
        break;
      case 'stop-apps':
        this._launchpadServer.stopAppsCmd();
        break;
    }
  }

  handleLogMessage(info) {
    // Convert colors to html.
    info.message = convert.toHtml(info.message);

    if (!this._launchpadServer._app.ws.server) {
      console.log(chalk.red("**There is no websocket server running**"));
      return;
    }

    this._launchpadServer._app.ws.server.clients.forEach(function each(client) {
      // TODO: check if client should be recieving this.
      var msg = {
        type: "server:log",
        data: info
      };

      client.send(JSON.stringify(msg));
    });
  }
}
