#!/usr/bin/env node

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import {Authentication} from  './lib/authentication.js';
const userManager = Authentication.getUserManagerInstanceStatic();

import bcrypt from 'bcryptjs';

import { LogManager } from '@bluecadet/launchpad-utils';
const log = LogManager.getInstance().getLogger('server:userCli');
import chalk from "chalk";

import packageDetails from './package.json' assert { type: 'json' };

yargs(hideBin(process.argv))
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

  // TODO: create list-users command
  // TODO: create delete-user command
  // TODO: create update-password command

  .version(packageDetails.version)
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
  const regex = new RegExp(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/);

  if (!regex.test(argv.password)) {
    log.error(chalk.red("Password does not validate."));
    log.error(chalk.yellow("Password must be min 8 chars, at least one uppercase letter, one lowercase letter and one number"));
    process.exit(0);
  }

  tmpUser.passEncrypt = bcrypt.hashSync(argv.password, 10);

  userManager.saveUser(tmpUser);
  log.info("User saved");
}
