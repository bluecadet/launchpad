import * as dotenv from 'dotenv';
dotenv.config();

import fs from "fs-extra";
import path from "path";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { Low, JSONFile } from 'lowdb';

import { LogManager, Logger } from '@bluecadet/launchpad-utils';

/** ========================================================================= */
// @TODO: this DB stuff should be in a pre-startup hook or something.
// Use JSON file for storage
// @TODO: validate location and fallback if not there.
// const file = path.join(process.env.DB_LOC);
const dir = path.resolve(process.env.DB_DIR);
const file = path.join(dir, process.env.DB_FILE);

if (!fs.existsSync(file)) {
  fs.ensureDirSync(dir);
  fs.writeJson(file, {"users": []}, { spaces: 2 });
}
const adapter = new JSONFile(file);
const db = new Low(adapter);

await db.read();
// If file.json doesn't exist, db.data will be null
// Set default data
db.data ||= {"users": []};

/** ========================================================================= */
class UserManager {
  findOne = (data) => {
    if (data.username) {
      let ud = false;
      db.data.users.forEach((u) => {
        if (u.username == data.username) ud = u;
      });

      return ud;
    }
  }

  findOneByIdIndex = (data) => {
    if (data._id) {
      let ud = false;
      db.data.users.forEach((u, i) => {
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

      db.data.users.push(tmpUser);
    }
    else {
      let index = this.findOneByIdIndex(tmpUser);
      db.data.users[index] = tmpUser;
    }

    await this.writeDB();
  }

  findNextUserId = () => {
    let i = 0;

    db.data.users.forEach((u) => {
      if (u._id > i) i = u._id;
    });
    console.log(i);
    return (i + 1);
  }

  async writeDB() {
    await db.write();
  }
}

export class Authentication {

  /** @type {UserManager} */
  static _userManagerInstanceStatic = null;

  /** @returns {UserManager} */
  static getUserManagerInstanceStatic() {
    if (this._userManagerInstanceStatic === null) {
      this._userManagerInstanceStatic = new UserManager();
    }
    return this._userManagerInstanceStatic;
  }

  /** @type {UserManager} */
  _userManagerInstance = null;

  _launchpadServer;

  _logger;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
    this._logger = LogManager.getInstance().getLogger('authentication', launchpadServer._logger);
    this.getUserManagerInstance();
  }

  init() {

    // Login.
    this._launchpadServer._app.post("/login", (req, res) => {
      try {
        // Get user input
        const { username, password } = req.body;

        // Validate user input
        if (!(username && password)) {
          this._logger.error("All input is required");
          res.status(400).send("All input is required");
        }

        let um = this.getUserManagerInstance();

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
                expiresIn: "48h",
              }
            );

            // Save user token
            user.token = token;
            um.saveUser(user);
          }
          else {

            try {
              const decoded = jwt.verify(user.token, process.env.TOKEN_KEY);
              console.log(decoded);
            } catch (err) {
              console.log(err);
              console.log(err.name);
              console.log(err.message);
              if (err.name == "TokenExpiredError") console.log(err.expiredAt);

              this._logger.warn("Exisitng token expired, creating new token.");
              // Create token
              const token = jwt.sign(
                { user_id: user._id, username: user.username },
                process.env.TOKEN_KEY,
                {
                  expiresIn: "48h",
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

        // todo: this should runn through the logger, i think...
        console.log(err);
      }
    });
  }

  /** @returns {UserManager} */
  getUserManagerInstance() {
    if (this._userManagerInstance === null) {
      this._userManagerInstance = new UserManager();
    }
    return this._userManagerInstance;
  }

}

