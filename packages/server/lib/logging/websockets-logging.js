import { LogManager } from '@bluecadet/launchpad-utils';

import Transport from 'winston-transport';
import util from 'util';

export default class WebsocketsLogging extends Transport {

  static _websocketsTransport;

  constructor(opts) {
    super(opts);
    //
    // Consume any custom options here. e.g.:
    // - Connection information for databases
    // - Authentication information for APIs (e.g. loggly, papertrail,
    //   logentries, etc.).
    //

    // this._wss = opts.wss;
    this._websocketsTransport = opts.websocketsTransport;
  }

  log(info, callback) {
    setImmediate(() => {
      this._websocketsTransport.handleLogMessage(info);
    });

    callback();
  }

}
