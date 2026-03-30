import type { Patch } from "@bluecadet/launchpad-utils/state-patcher";

const SEP = "\x1F";

function pathToKey(path: (string | number)[]): string {
	return path.map(String).join(SEP);
}

function keyToPath(key: string): (string | number)[] {
	return key.split(SEP);
}

function isProxiable(value: unknown): value is object {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null || Array.isArray(value);
}

export function createTrackingProxy<T extends object>(
	state: T,
	accessed: Set<string>,
	path: (string | number)[] = [],
): T {
	return new Proxy(state, {
		get(target, prop, receiver) {
			if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
			const key: string | number =
				Array.isArray(target) && /^\d+$/.test(prop) ? Number(prop) : prop;
			const currentPath = [...path, key];
			// Remove the parent path: it was only traversed to reach this child,
			// not read as a value itself. This keeps deps as leaf paths only,
			// preventing sibling subtrees from matching each other's patches.
			accessed.delete(pathToKey(path));
			accessed.add(pathToKey(currentPath));
			const value = Reflect.get(target, prop, receiver);
			if (!isProxiable(value)) return value;
			// Non-configurable, non-writable properties must return their exact value —
			// wrapping in a new Proxy would violate the invariant.
			const descriptor = Object.getOwnPropertyDescriptor(target, prop);
			if (descriptor && !descriptor.configurable && descriptor.writable === false) {
				return value;
			}
			return createTrackingProxy(value, accessed, currentPath);
		},
	});
}

function isPrefix(prefix: (string | number)[], full: (string | number)[]): boolean {
	if (prefix.length > full.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (String(prefix[i]) !== String(full[i])) return false;
	}
	return true;
}

export function isPanelAffected(deps: Set<string>, patches: Patch[]): boolean {
	for (const patch of patches) {
		for (const depKey of deps) {
			const dep = keyToPath(depKey);
			if (isPrefix(patch.path, dep) || isPrefix(dep, patch.path)) return true;
		}
	}
	return false;
}
