import { WebSocketServer } from 'ws';
import queryString from "query-string";
import jwt from 'jsonwebtoken';
import winston from 'winston';
import WebsocketsLogging from '../logging/websockets-logging.js';

import { LogManager } from '@bluecadet/launchpad-utils';

import Convert from 'ansi-to-html';
const convert = new Convert();

export class WebsocketsTransport {

  _launchpadServer;

  _websocketsServer;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
  }

  init() {

    // TODO: handle seperate server.
    this._websocketsServer = new WebSocketServer({
      noServer: true,
      path: "/ws"
    });

    // Expose Websocket to the server.
    let self = this;
    this._launchpadServer._server.on('upgrade', function upgrade(request, socket, head) {
      self._websocketsServer.handleUpgrade(request, socket, head, function done(ws) {
        self._websocketsServer.emit('connection', ws, request);
      });
    });

    this._websocketsServer.on('connection', function connection(ws, connectionRequest) {
      console.log("CONNECTION");
      const [_path, params] = connectionRequest?.url?.split("?");
      const connectionParams = queryString.parse(params);
      console.log(connectionParams);

      // TODO: use connection Params to distinguish type of connection. [admin, app, etc.]
      self._launchpadServer._logger.debug("Connection");

      // TODO: Validate Connection.
      const token = connectionParams.token || "";

      if (!token) {
        ws.close(3000, "A token is required for authentication");
      }

      try {
        const decoded = jwt.verify(token, process.env.TOKEN_KEY);
        ws.user = decoded;
        console.log(decoded);
      } catch (err) {
        console.log(err);
        ws.close(3000, "Invalid Token");
      }

      ws.on('message', (data) => {
        // console.log(data);
        // console.log(data.toString('utf-8'));
        let parsedData = JSON.parse(data.toString('utf-8'));
        // console.log(parsedData);

        self.handleWsMessages(parsedData, ws);
      });
    });

    // Add in Transport for logging over ws.
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
      case 'content:update':
        this._launchpadServer.updateContent();
        break;
      // case 'monitor:startup':
      //   this._launchpadServer.startup();
      //   break;
      case 'monitor:shutdown':
        this._launchpadServer.shutdown();
        break;
      case 'monitor:start-apps':
        this._launchpadServer.startApps();
        break;
      case 'monitor:stop-apps':
        this._launchpadServer.stopApps();
        break;
    }
  }

  handleLogMessage(info) {
    // Convert colors to html.
    info.message = convert.toHtml(info.message);

    this._websocketsServer.clients.forEach(function each(client) {
      // TODO: check if client should be recieving this.
      var msg = {
        type: "server:log",
        data: info
      };
      client.send(JSON.stringify(msg));
    });
  }
}
