#!/usr/bin/env node

import { hideBin } from "yargs/helpers";
import { run } from "./run.js";

await run(hideBin(process.argv));
