declare module "fs-native-extensions" {
	interface LockOptions {
		readonly shared?: boolean;
	}

	interface NativeFileExtensions {
		tryLock(fd: number, options?: LockOptions): boolean;
		tryLock(fd: number, offset: number, length?: number, options?: LockOptions): boolean;
		unlock(fd: number, offset?: number, length?: number): void;
	}

	const nativeFileExtensions: NativeFileExtensions;
	export default nativeFileExtensions;
}
