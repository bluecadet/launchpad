import * as dotenv from 'dotenv';
dotenv.config();

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { LogManager, Logger, DatabaseManager } from '@bluecadet/launchpad-utils';

/** ========================================================================= */
// TODO: this DB stuff should be in a pre-startup hook or something.
// Use JSON file for storage
// TODO: validate location and fallback if not there.
// const file = path.join(process.env.DB_LOC);
// const dir = path.resolve(process.env.DB_DIR);
// const file = path.join(dir, process.env.DB_FILE);

// if (!fs.existsSync(file)) {
//   fs.ensureDirSync(dir);
//   fs.writeJson(file, {"users": []}, { spaces: 2 });
// }
// const adapter = new JSONFile(file);
// const db = new Low(adapter);

// await db.read();
// console.log(db);
// // If file.json doesn't exist, db.data will be null
// // Set default data
// db.data ||= { "users": [] };




/** ========================================================================= */
export class UserManager {

  _collectionName;
  _userData;

  constructor(collectionName = "users") {
    this._collectionName = collectionName;
  }

  async init() {
    this._userData = await DatabaseManager.getInstance().getCollection(this._collectionName, { "users": [] });
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
      console.log("Checking for new user id");
      tmpUser._id = this.findNextUserId();

      this._userData.data.users.push(tmpUser);
    }
    else {
      let index = this.findOneByIdIndex(tmpUser);
      this._userData.data.users[index] = tmpUser;
    }

    await this.writeDB();
  }

  findNextUserId = () => {
    let i = 0;

    this._userData.data.users.forEach((u) => {
      if (u._id > i) i = u._id;
    });

    return (i + 1);
  }

  async writeDB() {
    await this._userData.write();
  }
}

export class Authentication {

  /** @type {UserManager} */
  _userManagerInstance = null;

  _launchpadServer;

  _logger;

  _loginUrl = "";

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
    this._logger = LogManager.getInstance().getLogger('authentication', launchpadServer._logger);
    this.getUserManagerInstance();

    this._loginUrl = launchpadServer._config.server.auth.loginUrl;
  }

  init() {

    // Login.
    this._launchpadServer._app.post(this._loginUrl, (req, res) => {
      try {
        // Get user input
        const { username, password } = req.body;

        // Validate user input
        if (!(username && password)) {
          this._logger.error("All input is required");
          res.status(400).send("All input is required");
        }

        let um = this.getUserManagerInstance();
        const jwtEXpiresIn = this._launchpadServer._config.server.auth.jwtEXpiresIn;

        // Validate if user exist in our database
        const user = um.findOne({ username });
        if (user && (bcrypt.compareSync(password, user.passEncrypt))) {
          // Check for token.
          if (user.token == null || user.token == "") {

            this._logger.debug("User does not have token");

            // Create token
            const token = jwt.sign(
              { user_id: user._id, username: user.username },
              process.env.TOKEN_KEY,
              {
                expiresIn: jwtEXpiresIn,
              }
            );

            // Save user token
            user.token = token;
            um.saveUser(user);
          }
          else {

            try {
              const decoded = jwt.verify(user.token, process.env.TOKEN_KEY);
              // TODO: log more here...
            } catch (err) {

              if (err.name == "TokenExpiredError") console.log(err.expiredAt);

              // TODO: What to do when there is an expired token?
              this._logger.warn("Exisitng token expired, creating new token.");
              // Create token
              const token = jwt.sign(
                { user_id: user._id, username: user.username },
                process.env.TOKEN_KEY,
                {
                  expiresIn: jwtEXpiresIn,
                }
              );

              // Save user token
              user.token = token;
              um.saveUser(user);
            }
          }

          // user
          const publicUser = Object.fromEntries(Object.entries(user).filter(([key]) => !key.includes('passEncrypt')));
          res.status(200).json(publicUser);
          return;
        }
        res.status(400).send("Invalid Credentials");
      } catch (err) {

        res.status(400).send(err.message);

        // TODO: this should runn through the logger, i think...
        console.log(err);
      }
    });
  }

  /** @returns {UserManager} */
  async getUserManagerInstance() {
    if (this._userManagerInstance === null) {
      this._userManagerInstance = new UserManager(this._launchpadServer._config.server.auth.dbCollection);
      await this._userManagerInstance.init();
    }
    return this._userManagerInstance;
  }

}

