import ffi from 'ffi-napi';
import ref from 'ref-napi';
import robotjs from 'robotjs';

/**
 * The default key to emaulate in order to gain focus (circumvents a windows restriction).
 * Key reference: https://robotjs.io/docs/syntax#keys
 * @type {string} 
 */
export let defaultFakeKey = 'control';

/*
 * Inspired by:
 * - https://stackoverflow.com/a/39604463/782899
 * - https://stackoverflow.com/a/37737797/782899
 * - https://github.com/node-ffi/node-ffi/issues/142#issuecomment-40880764
 */

export const voidPtr = ref.refType(ref.types.void);
export const stringPtr = ref.refType(ref.types.CString);
export const lpdwordPtr = ref.refType(ref.types.ulong);
export const lpctStr = {
    name: 'lpctstr',
    indirection: 1,
    size: ref.sizeof.pointer,
    get: function(buffer, offset) {
        var _buf = buffer.readPointer(offset);
        if(_buf.isNull()) {
            return null;
        }
        return _buf.readCString(0);
    },
    set: function(buffer, offset, value) {
        const _buf = ref.allocCString(value, 'ucs2');
        return buffer.writePointer(_buf, offset);
    },
    ffi_type: ffi.types.CString.ffi_type
};

export const user32 = new ffi.Library('user32', {
	AttachThreadInput: ['bool', ['int', 'long', 'bool']],
	BringWindowToTop: ['bool', ['long']],
	EnumWindows: ['bool', [voidPtr, 'int32']],
	EnumChildWindows: ['bool', ['long', voidPtr, 'int32']],
	EnumThreadWindows: ['bool', ['int', voidPtr, 'int32']],
	FindWindowA: ['long', [lpctStr, lpctStr]],
	GetForegroundWindow: ['long', []],
	GetTopWindow: ['long', ['long']],
	GetWindowInfo: ['long', ['int32', 'pointer']],
	GetWindowPlacement: ['bool', ['int32', 'pointer']],
	GetWindowRect: ['bool', ['int32', 'pointer']],
	GetWindowTextA : ['long', ['long', stringPtr, 'long']],
	GetWindowThreadProcessId: ['int', ['int', lpdwordPtr]],
	IsWindowVisible: ['bool', ['int32']],
	SetActiveWindow: ['long', ['long']],
	SetFocus: ['long', ['long']],
	SetForegroundWindow: ['bool', ['long']],
	SetWindowPos: ['bool', ['long', 'long', 'int', 'int', 'int', 'int', 'uint']],
	ShowWindow: ['bool', ['long', 'int']],
	SwitchToThisWindow: ['void', ['long', 'bool']],
});

/**
 * Modes that can be passed to ShowWindow.
 * @see https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow
 */
export const ShowWindowModes = Object.freeze({
	/** Hides the window and activates another window. */
	SW_HIDE: 0, 
	/** Activates and displays a window. If the window is minimized or maximized, the system restores it to its original size and position. An application should specify this flag when displaying the window for the first time. */
	SW_SHOWNORMAL: 1,
	SW_NORMAL: 1,
	/** Activates the window and displays it as a minimized window. */
	SW_SHOWMINIMIZED: 2,
	/** Activates the window and displays it as a maximized window. */
	SW_SHOWMAXIMIZED: 3,
	SW_MAXIMIZE: 3,
	/** Displays a window in its most recent size and position. This value is similar to 	SW_SHOWNORMAL, except that the window is not activated. */
	SW_SHOWNOACTIVATE: 4,
	/** Activates the window and displays it in its current size and position. */
	SW_SHOW: 5,
	/** Minimizes the specified window and activates the next top-level window in the Z order. */
	SW_MINIMIZE: 6,
	/** Displays the window as a minimized window. This value is similar to SW_SHOWMINIMIZED, 	except the window is not activated. */
	SW_SHOWMINNOACTIVE: 7,
	/** Displays the window in its current size and position. This value is similar to SW_SHOW, 	except that the window is not activated. */
	SW_SHOWNA: 8,
	/** Activates and displays the window. If the window is minimized or maximized, the system 	restores it to its original size and position. An application should specify this flag when 	restoring a minimized window. */
	SW_RESTORE: 9,
	/** Sets the show state based on the SW_ value specified in the STARTUPINFO structure 	passed to the CreateProcess function by the program that started the application. */
	SW_SHOWDEFAULT: 10,
	/** Minimizes a window, even if the thread that owns the window is not responding. This 	flag should only be used when minimizing windows from a different thread. */
	SW_FORCEMINIMIZE: 11,
});

export const kernel32 = new ffi.Library('Kernel32.dll', {
	GetCurrentThreadId: ['int', []],
});

export class Point {
	x = 0;
	y = 0;
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

export class Size {
	width = 0;
	height = 0;
	constructor(width = 0, height = 0) {
		this.width = width;
		this.height = height;
	}
}

export class Rect {
	left = 0;
	top = 0;
	right = 0;
	bottom = 0;
	constructor(left = 0, top = 0, right = 0, bottom = 0) {
		this.left = left;
		this.top = top;
		this.right = right;
		this.bottom = bottom;
	}
	getSize() {
		const size = new Size();
		size.width = this.right - this.left;
		size.height = this.bottom - this.top;
		return size;
	}
	toString() {
		return `Rect (left: ${this.left}, top: ${this.top}, right: ${this.right}, bottom: ${this.bottom})`;
	}
}

export class WindowInfo {
	/**
	 * @type {number}
	 */
	hwnd = 0;
	
	/**
	 * @type {number}
	 */
	pid = 0;
	
	// /**
	//  * @type {string}
	//  */
	// name = '';
	
	/**
	 * @param {number} hwnd 
	 * @param {number?} pid 
	 * @param {string?} name 
	 */
	constructor(hwnd, pid = null, name = null) {
		this.hwnd = hwnd;
		this.pid = pid || getWindowPid(hwnd);
		// this.name = name || getWindowName(hwnd);
	}
	
	/**
	 * @returns {string}
	 */
	toString() {
		// return `(pid: ${this.pid}, hwnd: ${this.hwnd}, name: ${this.name})`;
		return `(pid: ${this.pid}, hwnd: ${this.hwnd})`;
	}
}

/**
 * @param {*} hwnd 
 * @returns {string}
 */
 export const getWindowName = (hwnd) => {
	const buffer = Buffer.alloc(255);
	const success = user32.GetWindowTextA(hwnd, buffer, 255);
	return success ? buffer.readCString() : '';
}

/**
 * @param {*} hwnd 
 * @returns {boolean} If the specified window, its parent window, its parent's parent window, and so forth, have the WS_VISIBLE style, the return value is nonzero. Otherwise, the return value is zero.

Because the return value specifies whether the window has the WS_VISIBLE style, it may be nonzero even if the window is totally obscured by other windows.
 */
 export const isWindowVisible = (hwnd) => {
	return hwnd && !!user32.IsWindowVisible(hwnd);
}

/**
 * Converts a rectPtr 4x4byte buffer to a rect.
 * @see https://stackoverflow.com/a/57020318/782899
 * @param {Buffer} rectPtr 
 * @returns {Rect}
 */
 export function rectPtrToRect(rectPtr) {
	const rect = new Rect();
	rect.left = rectPtr.readUInt32LE(0);
	rect.top = rectPtr.readUInt32LE(4);
	rect.right = rectPtr.readUInt32LE(8);
	rect.bottom = rectPtr.readUInt32LE(12);
	return rect;
}

/**
 * Gets the rect of a window.
 * @see https://stackoverflow.com/a/57020318/782899
 * @param {*} hwnd 
 * @returns {Rect?} A Rect instance or null on failure.
 */
export const getWindowRect = function (hwnd) {
	if (!hwnd) {
		return null;
	}
  const rectPtr = Buffer.alloc(ref.sizeof.uint * 4);
	const success = user32.GetWindowRect(hwnd, rectPtr);
	return success ? rectPtrToRect(rectPtr) : null;
}

export class WindowPlacement {
	static defaultLength = ref.sizeof.uint + ref.sizeof.uint + ref.sizeof.uint +
		ref.sizeof.uint * 2 + ref.sizeof.uint * 2 + ref.sizeof.uint * 4 + ref.sizeof.uint * 4;
	
	// @see https://docs.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-windowplacement
	length = WindowPlacement.defaultLength;
  flags = 0;
  showCmd = 0;
  ptMinPosition = new Point();
  ptMaxPosition = new Point();
  rcNormalPosition = new Rect();
  rcDevice = new Rect();
}

/**
 * Converts a rectPtr 4x4byte buffer to a rect.
 * @see https://stackoverflow.com/a/57020318/782899
 * @param {Buffer} ptr 
 * @returns {WindowPlacement}
 */
 export function placementPtrToPlacement(ptr) {
	const placement = new WindowPlacement();
	const souint = ref.sizeof.uint;
	let offset = 0;
	
	placement.length = ptr.readUInt32LE(offset); offset += souint;
	placement.flags = ptr.readUInt32LE(offset); offset += souint;
	placement.showCmd = ptr.readUInt32LE(offset); offset += souint;
	
	placement.ptMinPosition.x = ptr.readUInt32LE(offset); offset += souint;
	placement.ptMinPosition.y = ptr.readUInt32LE(offset); offset += souint;
	
	placement.ptMaxPosition.x = ptr.readUInt32LE(offset); offset += souint;
	placement.ptMaxPosition.y = ptr.readUInt32LE(offset); offset += souint;
	
	placement.rcNormalPosition.left = ptr.readUInt32LE(offset); offset += souint;
	placement.rcNormalPosition.top = ptr.readUInt32LE(offset); offset += souint;
	placement.rcNormalPosition.right = ptr.readUInt32LE(offset); offset += souint;
	placement.rcNormalPosition.bottom = ptr.readUInt32LE(offset); offset += souint;
	
	placement.rcDevice.left = ptr.readUInt32LE(offset); offset += souint;
	placement.rcDevice.top = ptr.readUInt32LE(offset); offset += souint;
	placement.rcDevice.right = ptr.readUInt32LE(offset); offset += souint;
	placement.rcDevice.bottom = ptr.readUInt32LE(offset); offset += souint;
	
	return placement;
}

/**
 * 
 * @param {*} hwnd 
 * @returns {WindowPlacement?} A WindowPlacement instance or null on failure.
 */
export const getWindowPlacement = function (hwnd) {
	const placementPtr = Buffer.alloc(WindowPlacement.defaultLength);
	placementPtr.writeUInt32LE(WindowPlacement.defaultLength, 0);
	const success = user32.GetWindowPlacement(hwnd, placementPtr);
	return success ? placementPtrToPlacement(placementPtr) : null;
}

/**
 * @param {*} hwnd 
 * @returns {number}
 */
export const getWindowPid = (hwnd) => {
	const buffer = ref.alloc(lpdwordPtr);
	user32.GetWindowThreadProcessId(hwnd, buffer);
	/**
	 * The process ID is returned as a LPDWORD, so we have to read it in the correct format
	 * @see https://stackoverflow.com/questions/58477755/what-is-the-equivalent-of-dword-in-nodejs
	 */
	return buffer.readUInt32LE();
}

/**
 * @param {function(WindowInfo) : boolean} callback Return `true` to continue iterating, `false` to stop.
 */
 export const enumWindows = (callback) => {
	user32.EnumWindows(ffi.Callback('bool', ['long', 'int32'], (hwnd, lParam) => {
		const win = new WindowInfo(hwnd);
				
		if (!callback(win)) {
			return false;
		}
		
		user32.EnumChildWindows(win.hwnd, ffi.Callback('bool', ['long', 'int32'], (childHwnd, lParam) => {
			const childWin = new WindowInfo(childHwnd);
			return callback(childWin);
		}), lParam);
	}), 0);
};

/**
 * @returns {Array<WindowInfo>}
 */
export const getAllWindows = () => {
	const windows = [];
	enumWindows(window => {
		windows.push(window);
		return true; // continue iteration
	});
	return windows;
}

/**
 * @param {string} name 
 * @returns {Array<WindowInfo>}
 */
export const getWindowsByName = (name) => {
	name = name.toLowerCase();
	return getAllWindows().filter(win => getWindowName(win.hwnd).toLowerCase().includes(name));
}

/**
 * @param {number} pid 
 * @returns {Array<WindowInfo>}
 */
export const getWindowsByPid = (pid) => {
	return getAllWindows().filter(win => win.pid === pid);
}

/**
 * Moves sets of windows to the foreground, minimizes them or hides them in a single call.
 * 
 * This is more efficient than calling foreground/minimize/hideWindowsByPid() individually.
 * 
 * @param {Array<number>} fgPids A list of process IDs.
 * @param {Array<number>} minPids A list of process IDs.
 * @param {Array<number>} hidePids A list of process IDs.
 * @param {string} fakeKey Which keyboard key to emaulate in order to gain focus (circumvents a windows restriction). Key reference: https://robotjs.io/docs/syntax#keys
 */
export const sortWindows = (fgPids, minPids, hidePids, fakeKey = defaultFakeKey) => {
	sendKeyTap(fakeKey);
	
	const allVisibleWins = getAllWindows().filter(win => {
		return isWindowVisible(win.hwnd);
	});
	
	allVisibleWins.filter(win => hidePids.includes(win.pid)).forEach(win => {
		user32.ShowWindow(win.hwnd, ShowWindowModes.SW_HIDE);
	});
	allVisibleWins.filter(win => minPids.includes(win.pid)).forEach(win => {
		user32.ShowWindow(win.hwnd, ShowWindowModes.SW_SHOWMINNOACTIVE);
	});
	allVisibleWins.filter(win => fgPids.includes(win.pid)).forEach(win => {
		user32.ShowWindow(win.hwnd, ShowWindowModes.SW_SHOW);
		user32.SetForegroundWindow(win.hwnd);
	});
}

/**
 * Shows, sets focus, activates and foregrounds all windows assigned to pid
 * @param {number} pid 
 * @param {string} fakeKey Which keyboard key to emaulate in order to gain focus (circumvents a windows restriction). Key reference: https://robotjs.io/docs/syntax#keys
 */
export const foregroundWindowsByPid = (pid, fakeKey = defaultFakeKey) => {
	if (!pid || pid === undefined) {
		return;
	}
	getWindowsByPid(pid).forEach(win => {
		sendKeyTap(fakeKey);
		if (isWindowVisible(win.hwnd)) {
			user32.ShowWindow(win.hwnd, ShowWindowModes.SW_SHOW);
			// user32.SetActiveWindow(win.hwnd);
			// user32.SetFocus(win.hwnd);
			// user32.BringWindowToTop(win.hwnd);
			/**
			 * Activates, gives keyboard focus and foregrounds
			 * the window if it's a child of this node thread.
			 * @see https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow
			 */
			user32.SetForegroundWindow(win.hwnd);
		}
	});
}

/**
 * Minimizes all windows assigned to pid
 * @param {number} pid 
 * @param {string} fakeKey Which keyboard key to emaulate in order to gain focus (circumvents a windows restriction). Key reference: https://robotjs.io/docs/syntax#keys
 */
 export const minimizeWindowsByPid = (pid, fakeKey = defaultFakeKey) => {
	sendKeyTap(fakeKey);
	getWindowsByPid(pid).forEach(win => {
		// See: https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow
		if (isWindowVisible(win.hwnd)) {
			// user32.ShowWindow(win.hwnd, ShowWindowModes.SW_SHOWNA);
			// user32.ShowWindow(win.hwnd, ShowWindowModes.SW_SHOWMINNOACTIVE);
			user32.ShowWindow(win.hwnd, ShowWindowModes.SW_SHOWMINIMIZED);
		}
	});
}

/**
 * Minimizes all windows assigned to pid
 * @param {number} pid 
 * @param {string} fakeKey Which keyboard key to emaulate in order to gain focus (circumvents a windows restriction). Key reference: https://robotjs.io/docs/syntax#keys
 */
 export const hideWindowsByPid = (pid, fakeKey = defaultFakeKey) => {
	sendKeyTap(fakeKey);
	getWindowsByPid(pid).forEach(win => {
		// See: https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow
		if (isWindowVisible(win.hwnd)) {
			user32.ShowWindow(win.hwnd, ShowWindowModes.SW_HIDE);
		}
	});
}

/**
* Send fake key tap (down and up) command to get around windows API restrictions 
* @see https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow#remarks
* @param {string} key @see https://robotjs.io/docs/syntax#keys. If null or undefined, this function does nothing.
*/
export const sendKeyTap = (key) => {
 if (key === null || key === undefined) {
	 return;
 } 
 robotjs.keyTap(key);
}

/**
 * Send fake key down command to get around windows API restrictions 
 * @see https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow#remarks
 * @param {string} key @see https://robotjs.io/docs/syntax#keys. If null or undefined, this function does nothing.
 */
export const sendKeyDown = (key) => {
	if (key === null || key === undefined) {
		return;
	} 
	robotjs.keyToggle(key, 'down');
}

/**
 * Send fake key up command to get around windows API restrictions 
 * @see https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow#remarks
 * @param {string} key @see https://robotjs.io/docs/syntax#keys. If null or undefined, this function does nothing.
 */
export const sendKeyUp = (key) => {
	if (key === null || key === undefined) {
		return;
	}
	robotjs.keyToggle(key, 'up');
}