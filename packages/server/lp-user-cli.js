#!/usr/bin/env node

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

// import ServerOptions from './lib/server-options.js';

import { LogManager, ConfigManager } from '@bluecadet/launchpad-utils';
const log = LogManager.getInstance().getLogger('server:userCli');

// TODO: Is this the right way to do this?
// ConfigManager.getInstance().loadConfig();
// const config = ConfigManager.getInstance().getConfig();
// config.server = new ServerOptions(config.server);
// console.log(config);

import { Authentication, UserManager } from './lib/authentication.js';
const userManager = new UserManager("users");
await userManager.init();

import bcrypt from 'bcryptjs';


import chalk from "chalk";

// TODO: how do we do this properly?
// import packageDetails from './package.json' assert { type: 'json' };

yargs(hideBin(process.argv))
  .command(["list-users", "lu"], "List current Users", {}, function (argv) { listUsers(argv) })
  .command(["new-user", "nu"], "Create new Launchpad User", {
    username: {
      alias: 'u',
      describe: "Username",
      demandOption: true
    },
    password: {
      alias: 'p',
      describe: "password",
      demandOption: true
    }
  }, function (argv) { createNewUser(argv) })
  .command(["update-password", "up"], "Create new Launchpad User", {
    id: {
      alias: 'i',
      describe: "User ID",
      demandOption: true
    },
    oldpassword: {
      alias: 'op',
      describe: "Old Password",
      demandOption: true
    },
    newpassword: {
      alias: 'np',
      describe: "New Password",
      demandOption: true
    }
  }, function (argv) { updatePassword(argv) })

  // TODO: create delete-user command - but does this need to be authenticated?
  // We can create users at will... so why not delete?
  .command(["delete-user", "du"], "Delete User by ID", {
    id: {
      alias: 'i',
      describe: "User ID",
      demandOption: true
    }
  }, function (argv) { deleteUser(argv) })

  // .version(packageDetails.version)
  .version("0.0.1")
  .help()
  .argv;


function createNewUser(argv) {
  // console.log(argv);

  let tmpUser = {
    username: argv.username,
    token: "",
    passEncrypt: null
  };

  // Validate user.
  // Check unique username.
  if (userManager.findOne(tmpUser)) {
    console.log("User already exists");
    process.exit(0);
  }

  // Check valid password.
  if (!_validateUserPassword(argv.password)) {
    log.error(chalk.red("Password does not validate."));
    log.error(chalk.yellow("Password must be min 8 chars, at least one uppercase letter, one lowercase letter and one number"));
    process.exit(0);
  }

  tmpUser.passEncrypt = _encryptPassword(argv.password);

  userManager.saveUser(tmpUser);
  log.info("User saved");
}

function listUsers(argv) {
  const allUsers = userManager.getAllUsers();
  const publicUsers = allUsers.map((user) => {
    return {
      "_id": user._id,
      "username": user.username
    };
  });

  console.table(publicUsers);
}

function updatePassword(argv) {
  //console.log(argv);
  // Find user by id.
  const user = userManager.findOneById({"_id": argv.id});

  if (!user) {
    console.log(chalk.red("No User with that ID"));
    process.exit(0);
  }

  // Validate old passowrd.
  if (!bcrypt.compareSync(argv.oldpassword, user.passEncrypt)) {
    console.log(chalk.red("Invalid Old Password"));
    process.exit(0);
  }

  // Check New Password.
  if (!_validateUserPassword(argv.newpassword)) {
    log.error(chalk.red("Password does not validate."));
    log.error(chalk.yellow("Password must be min 8 chars, at least one uppercase letter, one lowercase letter and one number"));
    process.exit(0);
  }

  // Encrypt new password.
  user.passEncrypt = _encryptPassword(argv.newpassword);

  // Save user.
  userManager.saveUser(user);
}

function deleteUser(argv) {
  // Find user by id.
  const user = userManager.findOneById({ "_id": argv.id });

  if (!user) {
    console.log(chalk.red("No User with that ID"));
    process.exit(0);
  }

  userManager.deleteUser(user);
}

function _validateUserPassword(password) {
  const regex = new RegExp(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/);
  return regex.test(password);
}

function _encryptPassword(password) {
  return bcrypt.hashSync(password, 10);
}
