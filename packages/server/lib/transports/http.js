
import jwt from 'jsonwebtoken';

export class HttpTransport {

  _launchpadServer;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
  }

  init() {
    this._launchpadServer._logger.info("Starting http Transport...");

    const server = this._launchpadServer._app;

    // TODO: Variablize these??

    server.patch("/update-content", (req, res) => {

      if (!this.isAuthorized(req.headers)) {
        res.status(400).send("Unauthorized");
      }

      this._launchpadServer.updateContent();
      res.status(200).json({"status": "ok"});
    });

    server.patch("/shutdown", (req, res) => {

      if (!this.isAuthorized(req.headers)) {
        res.status(400).send("Unauthorized");
      }

      this._launchpadServer.shutdown();
      res.status(200).json({"status": "ok"});
    });

    server.patch("/start-apps", (req, res) => {

      if (!this.isAuthorized(req.headers)) {
        res.status(400).send("Unauthorized");
      }

      this._launchpadServer.startApps();
      res.status(200).json({"status": "ok"});
    });

    server.patch("/stop-apps", (req, res) => {

      if (!this.isAuthorized(req.headers)) {
        res.status(400).send("Unauthorized");
      }

      this._launchpadServer.stopApps();
      res.status(200).json({"status": "ok"});
    });
  }

  isAuthorized(headers) {
    // If we are not requireing authentication, then return true.
    if (!this._launchpadServer._config.server.auth.enabled) {
      return true;
    }
    // TODO: Should we allow other places like url param for token?
    const token = headers.authorization.split(' ')[1];

    if (!token) {
      return false;
    }

    try {
      const decoded = jwt.verify(token, process.env.TOKEN_KEY);
      // TODO: log more info here so we can keep track of whats going on and who is doing it.
      console.log(decoded);
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }
}
