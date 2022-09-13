import * as dotenv from 'dotenv';
dotenv.config();

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import Router from 'koa-router';

import { LogManager, DatabaseManager } from '@bluecadet/launchpad-utils';
import chalk from "chalk";

export class UserManager {

  _authConfig;

  _userData;

  constructor(authConfig) {
    this._authConfig = authConfig;
  }

  async init() {
    this._userData = await DatabaseManager.getInstance().getCollection(this._authConfig.dbCollection, { "users": [], "userIdIncrement": 0 });
  }

  getAllUsers = () => {
    return this._userData.data.users;
  }

  findOne = (data) => {
    if (data.username) {
      let ud = false;
      this._userData.data.users.forEach((u) => {
        if (u.username == data.username) ud = u;
      });

      return ud;
    }
  }

  findOneById = (data) => {
    if (data._id) {
      let ud = false;
      this._userData.data.users.forEach((u, i) => {
        if (u._id == data._id) ud = u;
      });

      return ud;
    }
  }

  findOneByIdIndex = (data) => {
    if (data._id) {
      let ud = false;
      this._userData.data.users.forEach((u, i) => {
        if (u._id == data._id) ud = i;
      });

      return ud;
    }
  }

  saveUser = async (tmpUser) => {

    // Check if user has an ID.
    if (!("_id" in tmpUser) || tmpUser._id == null) {
      tmpUser._id = await this.findNextUserId();
      this._userData.data.users.push(tmpUser);
    }
    else {
      let index = this.findOneByIdIndex(tmpUser);
      this._userData.data.users[index] = tmpUser;
    }

    await this.writeDB();
  }

  deleteUser = async (user) => {
    if (!("_id" in user) || user._id == null) {
      return;
    }

    let index = this.findOneByIdIndex(user);

    if (index) {
      this._userData.data.users.splice(index, 1);
    }
    else if (index == 0 && this._userData.data.users.length == 1) {
      this._userData.data.users = [];
    }

    await this.writeDB();
  }

  async findNextUserId () {

    this._userData.data.userIdIncrement++;

    await this.writeDB();

    return this._userData.data.userIdIncrement;
  }

  async writeDB() {
    await this._userData.write();
  }

  getPublicUserObject(user) {
    return Object.fromEntries(Object.entries(user).filter(([key]) => !key.includes('passEncrypt')));
  }

  getUserToken(user) {
    return jwt.sign(
      {
        user_id: user._id,
        username: user.username,
        iat: (Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 3)) // TODO: remove this.
      },
      process.env.TOKEN_KEY,
      {
        expiresIn: this._authConfig.jwtExpiresIn
      }
    );
  }
}

export class Authentication {

  /** @type {UserManager} */
  _userManagerInstance = null;

  _launchpadServer;

  _logger;

  _loginUrl = "";

  _router;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
    this._logger = LogManager.getInstance().getLogger('authentication', launchpadServer._logger);
    this.getUserManagerInstance();

    this._loginUrl = launchpadServer._config.server.auth.loginUrl;

    this._router = new Router();
  }

  init() {
    // Login.
    let self = this;
    this._router.post("Login", this._loginUrl, (ctx, next) => {

      try {
        // Get user input
        const { username, password } = ctx.request.body;

        // Validate user input
        if (!(username && password)) {
          self._logger.error("Username and Password are required");

          ctx.status = 400;
          ctx.body = {
            message: "All fields are required"
          };
          return;
        }

        self.getUserManagerInstance().then((um) => {
          // Validate if user exist in our database
          const user = um.findOne({ username });
          if (user && (bcrypt.compareSync(password, user.passEncrypt))) {
            // Check for token.
            // If no token.
            if (user.token == null || user.token == "") {

              self._logger.debug("User does not have token. Creating User Token");

              // Create token
              const token = um.getUserToken(user);

              // Save user token
              self._logger.debug("User token created. Saving User");
              user.token = token;
              um.saveUser(user);
            }
            // Token exists.
            else {

              try {
                const decoded = jwt.verify(user.token, process.env.TOKEN_KEY);
                this._logger.debug(chalk.green("User verified: "));
                this._logger.debug(chalk.green(JSON.stringify(decoded)));

              } catch (err) {
                // Token Expired.
                if (err.name == "TokenExpiredError") {

                  // TODO: What to do when there is an expired token?
                  // this._logger.error(chalk.red("TokenExpiredError: ") + chalk.yellow(err.expiredAt));
                  this._logger.warn(chalk.yellow("Exisitng token expired, creating new token."));

                  // Create token
                  const token = um.getUserToken(user);;

                  // Save user token
                  self._logger.debug("New User token created. Saving User");
                  user.token = token;
                  um.saveUser(user);
                }
              }
            }

            // User
            const publicUser = um.getPublicUserObject(user);

            ctx.status = 200;
            ctx.body = publicUser;
            return;
          }

          // If no user or password is invalid.
          ctx.status = 400;
          ctx.body = {
            message: "Invalid Credentials"
          };

        });
      } catch (err) {

        ctx.status = 500;
        ctx.body = "Internal Error";

        // TODO: this should run through the logger, i think...
        this._logger.error(chalk.red(err));
      }

      next();
    });

    this._launchpadServer._app.use(this._router.routes());
  }

  /** @returns {UserManager} */
  async getUserManagerInstance() {
    if (this._userManagerInstance === null) {
      this._userManagerInstance = new UserManager(this._launchpadServer._config.server.auth);
      await this._userManagerInstance.init();
    }
    return this._userManagerInstance;
  }

}

