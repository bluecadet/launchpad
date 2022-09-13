
import Router from 'koa-router';
import jwt from 'jsonwebtoken';

export class HttpTransport {

  _launchpadServer;

  _router;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
    this._router = new Router();
  }

  init() {
    this._launchpadServer._logger.info("Initialising Http Transport...");

    const server = this._launchpadServer._app;

    // TODO: Variablize these??
    this._router.patch("Status", "/status", async (ctx, next) => {

      if (this._launchpadServer._config.server.auth.enabled && !ctx.state.user) {
        ctx.status = 400;
        ctx.body = {
          "status": "error",
          "message": "Unauthorized"
        };
        return;
      }

      await next();

      let status = await this._launchpadServer.getStatus();

      ctx.status = 200;
      ctx.body = {
        "status": "ok",
        "message": "status",
        "data": status
      };

    });

    this._router.patch("Update Content", "/update-content", async (ctx, next) => {

      if (this._launchpadServer._config.server.auth.enabled && !ctx.state.user) {
        ctx.status = 400;
        ctx.body = {
          "status": "error",
          "message": "Unauthorized"
        };
        return;
      }

      await next();

      this._launchpadServer.updateContentCmd();
      ctx.status = 200;
      ctx.body = {
        "status": "ok",
        "message": "updating content..."
      };

    });

    this._router.patch("Start Apps", "/start-apps", async (ctx, next) => {

      if (this._launchpadServer._config.server.auth.enabled && !ctx.state.user) {
        ctx.status = 400;
        ctx.body = {
          "status": "error",
          "message": "Unauthorized"
        };
        return;
      }

      await next();

      this._launchpadServer.startAppsCmd();
      ctx.status = 200;
      ctx.body = {
        "status": "ok",
        "message": "starting apps..."
      };

    });

    this._router.patch("Stop Apps", "/stop-apps", async (ctx, next) => {

      if (this._launchpadServer._config.server.auth.enabled && !ctx.state.user) {
        ctx.status = 400;
        ctx.body = {
          "status": "error",
          "message": "Unauthorized"
        };
        return;
      }

      await next();

      this._launchpadServer.stopAppsCmd();
      ctx.status = 200;
      ctx.body = {
        "status": "ok",
        "message": "stopping apps..."
      };

    });

    this._router.patch("Shutdown", "/shutdown", async (ctx, next) => {

      if (this._launchpadServer._config.server.auth.enabled && !ctx.state.user) {
        ctx.status = 400;
        ctx.body = {
          "status": "error",
          "message": "Unauthorized"
        };
        return;
      }

      await next();

      this._launchpadServer.stopAppsCmd();
      ctx.status = 200;
      ctx.body = {
        "status": "ok",
        "message": "shuting down..."
      };

    });

    this._launchpadServer._app.use(this._router.routes());

    this._launchpadServer._logger.info("...Http Transport Initialised");
  }
}
