import * as dotenv from 'dotenv';
dotenv.config();

import fs from "fs-extra";
import path from "path";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

let userData = {};
if (fs.existsSync('./users.json')) {
  let rawdata = fs.readFileSync('./users.json');
  userData = JSON.parse(rawdata);
}
else {
  userData = {
    "users": []
  }
}

class UserManager {
  findOne = (data) => {
    if (data.username) {
      let ud = false;
      userData.users.forEach((u) => {
        if (u.username == data.username) ud = u;
      });

      return ud;
    }
  }

  saveUser = (tmpUser) => {
    console.log(tmpUser);
    // Check if user has an ID.
    if (!("_id" in tmpUser) || tmpUser._id == null) {
      console.log("Checking for new user id");
      tmpUser._id = this.findNextUserId();
    }

    console.log(tmpUser);

    userData.users.push(tmpUser);

    this.writeFile();
  }

  findNextUserId = () => {
    let i = 0;

    userData.users.forEach((u) => {
      if (u._id > i) i = u._id;
    });
    console.log(i);
    return (i + 1);
  }

  writeFile() {
    fs.writeJson('./users.json', userData, { spaces: 2 });
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

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
    this.getUserManagerInstance();
  }

  init() {
    this._launchpadServer._app.post("/login", (req, res) => {
      try {
        // Get user input
        const { username, password } = req.body;

        // Validate user input
        if (!(username && password)) {
          res.status(400).send("All input is required");
        }

        let um = this.getUserManagerInstance();

        // Validate if user exist in our database
        const user = um.findOne({ username });
        if (user && (bcrypt.compareSync(password, user.passEncrypt))) {
          // Check for token.
          if (user.token == null || user.token == "") {
            // Create token
            const token = jwt.sign(
              { user_id: user._id, username: user.username },
              process.env.TOKEN_KEY,
              {
                expiresIn: "2h",
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

              log.warning("Exisitng token expired, creating new token.");
              // Create token
              const token = jwt.sign(
                { user_id: user._id, username: user.username },
                process.env.TOKEN_KEY,
                {
                  expiresIn: "2h",
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

