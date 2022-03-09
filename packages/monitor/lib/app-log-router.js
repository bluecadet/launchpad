import pm2 from 'pm2';
import path from 'path';
import autoBind from 'auto-bind';
import { Tail } from 'tail';
import { SubEmitterSocket } from 'axon'; // used by PM2
import { Logger, LogManager } from '@bluecadet/launchpad-utils';
import { AppOptions, AppLogOptions, LogModes } from './monitor-options.js';


export class LogRelay {
	/**
	 * @param {AppOptions} appOptions 
	 * @param {AppLogOptions} logOptions 
	 * @param {Logger} logger 
	 */
	constructor(appOptions, logOptions, logger) {
		/** @type {AppOptions} */
		this._appOptions = appOptions;
		/** @type {AppLogOptions} */
		this._logOptions = logOptions;
		/** @type {Logger} */
		this._logger = logger;
	}
}

export class FileLogRelay extends LogRelay {
	/** @type {Tail} */
	_outTail = null;
	/** @type {Tail} */
	_errTail = null;
	
	/**
	 * @param {pm2.ProcessDescription} appProcess 
	 */
	startTailing(appProcess) {
		const tailOptions = {useWatchFile: true, fsWatchOptions: {interval: 100}};
		const outFilepath = appProcess.pm2_env.pm_out_log_path;
		const errFilepath = appProcess.pm2_env.pm_err_log_path;
		
		if (this._outTail) {
			this._outTail.unwatch();
			this._outTail = null;
		}
		if (this._errTail) {
			this._errTail.unwatch();
			this._errTail = null;
		}
		
		if (!outFilepath) {
			this._logger.warn(`App process for ${appProcess.name} is missing the 'output' property.`);
		}
		if (!errFilepath) {
			this._logger.warn(`App process for ${appProcess.name} is missing the 'error' property.`);
		}
		
		if (this._logOptions.showStdout) {
			this._logger.debug(`Tailing stdout from ${outFilepath}`);
			this._outTail = new Tail(outFilepath, tailOptions);
			this._outTail.on('line', data => this._handleTailOutput(data));
			this._outTail.on('error', data => this._handleTailError(data, true));
			this._outTail.watch();
		}

		if (this._logOptions.showStderr) {
			this._logger.debug(`Tailing stderr from ${errFilepath}`);
			this._errTail = new Tail(errFilepath, tailOptions);
			this._errTail.on('line', data => this._handleTailError(data));
			this._errTail.on('error', data => this._handleTailError(data, true));
			this._errTail.watch();
		}
	}
	
	/**
	 * @param {pm2.ProcessDescription} appProcess 
	 */
	stopTailing(appProcess) {
		if (this._outTail) {
			this._outTail.unwatch();
			this._outTail = null;
		}
		if (this._errTail) {
			this._errTail.unwatch();
			this._errTail = null;
		}
	}
	
	_handleTailOutput(data) {
		if (this._logOptions.showStdout && this._logOptions.mode === LogModes.TailLogFile) {
			this._logger.info(data);
		}
	}
	
	_handleTailError(data, isTailError = false) {
		if (isTailError || (this._logOptions.showStderr && this._logOptions.mode === LogModes.TailLogFile)) {
			this._logger.error(data);
		}
	}
}

export class BusLogRelay extends LogRelay {
	/**
	 * @param {*} event 
	 */
	handleBusLogOut(event) {
		if (this._logOptions.showStdout && this._logOptions.mode === LogModes.LogBusEvents) {
			this._logger.info(event.data);
		}
	}
	/**
	 * @param {*} event 
	 */
	handleBusLogErr(event) {
		if (this._logOptions.showStderr && this._logOptions.mode === LogModes.LogBusEvents) {
			this._logger.error(event.data);
		}
	}
}

export default class AppLogRouter {
	/** @type {Logger} */
	_logger = null;
	/** @type {Map<string, FileLogRelay>} */
	_fileRelays = new Map();
	/** @type {Map<string, BusLogRelay>} */
	_busRelays = new Map();
	
	/**
	 * @param {Logger} logger
	 * @param {boolean} enabled
	 */
	constructor(logger) {
		autoBind(this);
		this._logger = logger;
	}
	
	/**
	 * 
	 * @param {AppOptions} appOptions 
	 * @return {AppOptions}
	 */
	initAppOptions(appOptions) {
		const pm2Options = appOptions.pm2;
		const logOptions = appOptions.logging;
		const appName = pm2Options.name;
		
		if (logOptions.logToLaunchpadDir) {
			// Move app logs from default pm2 dir to launchpad dir
			const outPath = LogManager.getInstance().getFilePath(`${appName}-stdout`);
			const errPath = LogManager.getInstance().getFilePath(`${appName}-stderr`);
			pm2Options.output = pm2Options.output || path.resolve(outPath);
			pm2Options.error = pm2Options.error || path.resolve(errPath);
			this._logger.debug(`Saving output logs of ${appName} to ${pm2Options.output}`);
			this._logger.debug(`Saving error logs of ${appName} to ${pm2Options.error}`);
		} else {
			pm2Options.output = null;
			pm2Options.error = null;
		}
		
		// Writing to these fields for backwards compatiblity
		// @see https://pm2.keymetrics.io/docs/usage/application-declaration/#log-files
		pm2Options.out_file = pm2Options.output;
		pm2Options.error_file = pm2Options.error;
		
		const appLogger = LogManager.getInstance().getLogger(appName, this._logger);
		const fileRelay = new FileLogRelay(appOptions, logOptions, appLogger);
		const busRelay = new BusLogRelay(appOptions, logOptions, appLogger);
		
		this._fileRelays.set(appName, fileRelay);
		this._busRelays.set(appName, busRelay);
	}
	
	/**
	 * @param {SubEmitterSocket} pm2Bus 
	 */
	connectToBus(pm2Bus) {
		pm2Bus.on('log:out', this._handleBusLogOutEvent);
		pm2Bus.on('log:err', this._handleBusLogErrEvent);
	}
	
	/**
	 * @param {pm2.ProcessDescription} appProcess 
	 */
	watchProcess(appProcess) {
		const fileRelay = this._fileRelays.get(appProcess.name);
		if (!fileRelay) {
			this._logger.warn(`No relay found for ${appProcess}`);
			return;
		}
		fileRelay.startTailing(appProcess);
	}
	
	/**
	 * @param {pm2.ProcessDescription} appProcess 
	 */
	unwatchProcess(appProcess) {
		const fileRelay = this._fileRelays.get(appProcess.name);
		if (!fileRelay) {
			this._logger.warn(`No relay found for ${appProcess}`);
			return;
		}
		fileRelay.stopTailing(appProcess);
	}
	
	/**
	 * @param {SubEmitterSocket} pm2Bus 
	 */
	disconnectFromBus(pm2Bus) {
		pm2Bus.off('log:out');
		pm2Bus.off('log:err');
	}
	
	/**
	 * @param {*} event 
	 */
	_handleBusLogOutEvent(event) {
		try {
			const appName = event.process.name;
			this._busRelays.get(appName).handleBusLogOut(event);
			
		} catch (err) {
			this._logger.error(`Could not process bus event`);
			this._logger.error(err);
		}
	}
	/**
	 * @param {*} event 
	 */
	_handleBusLogErrEvent(event) {
		try {
			const appName = event.process.name;
			this._busRelays.get(appName).handleBusLogErr(event);
			
		} catch (err) {
			this._logger.error(`Could not process bus event`);
			this._logger.error(err);
		}
	}
}
