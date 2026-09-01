/**
 * A local mirror of `GET /state`, kept current by `launchpad:state:patch` frames.
 *
 * Push is sugar over an authoritative read, never a replacement for one: a patch is
 * applied only when its `version` is exactly one past the mirror's, and every other
 * outcome — a version gap, a sequence gap, a reconnect, a patch that will not apply —
 * falls back to re-fetching the whole tree. That is why `pushStatePatches` requires the
 * operator to also enable `exposeState`; without the read there is no way back.
 */

import { applyPatches, enablePatches, type Patch } from "immer";
import type { ResultAsync } from "neverthrow";
import { ClientError } from "./errors.js";
import { type EventStream, isResyncSignal } from "./event-stream.js";
import { isRecord } from "./http.js";
import type { SubscribeOptions, Unsubscribe, VersionedWireState } from "./types.js";

enablePatches();

const STATE_PATCH_FRAME = "launchpad:state:patch";

export type StateMirrorDeps = {
	fetchState: () => ResultAsync<VersionedWireState, ClientError>;
	stream: EventStream;
	onError?: (error: ClientError) => void;
};

type PatchFrame = { patches: Patch[]; version: number };

/**
 * Immer's patch format, not RFC 6902: `path` is an array of segments, and only three
 * `op` values exist.
 */
function parsePatchFrame(data: unknown): PatchFrame | null {
	if (!isRecord(data) || typeof data.version !== "number" || !Array.isArray(data.patches)) {
		return null;
	}
	const valid = data.patches.every(
		(patch) => isRecord(patch) && typeof patch.op === "string" && Array.isArray(patch.path),
	);
	return valid ? { patches: data.patches as Patch[], version: data.version } : null;
}

export function subscribeState(
	deps: StateMirrorDeps,
	handler: (state: VersionedWireState) => void,
	options?: SubscribeOptions,
): Unsubscribe {
	if (options?.signal?.aborted) {
		return () => undefined;
	}

	let mirror: VersionedWireState | undefined;
	let stopped = false;
	let refetching = false;
	let refetchQueued = false;

	function refetch() {
		if (stopped) {
			return;
		}
		if (refetching) {
			// Collapse a burst of resync signals into one follow-up request.
			refetchQueued = true;
			return;
		}
		refetching = true;
		void deps
			.fetchState()
			.match(
				(state) => {
					// A patch applied while this was in flight can leave the mirror ahead of it.
					if (!stopped && (mirror === undefined || state._version >= mirror._version)) {
						mirror = state;
						handler(state);
					}
				},
				(error) => {
					if (!stopped) {
						deps.onError?.(error);
					}
				},
			)
			.finally(() => {
				refetching = false;
				if (refetchQueued && !stopped) {
					refetchQueued = false;
					refetch();
				}
			});
	}

	function applyFrame(frame: PatchFrame) {
		if (mirror === undefined || frame.version !== mirror._version + 1) {
			refetch();
			return;
		}
		try {
			const next = applyPatches(mirror, frame.patches);
			// Patches only ever touch plugin slices, so the version has to come off the frame.
			mirror = { ...next, _version: frame.version };
		} catch (cause) {
			deps.onError?.(
				new ClientError("malformed-response", "Could not apply a state patch", { cause }),
			);
			refetch();
			return;
		}
		handler(mirror);
	}

	const unsubscribeStream = deps.stream.subscribe(
		{
			onFrame: (frame) => {
				if (frame.event !== STATE_PATCH_FRAME) {
					return;
				}
				const parsed = parsePatchFrame(frame.data);
				if (parsed === null) {
					deps.onError?.(
						new ClientError("malformed-response", "A state patch frame was malformed"),
					);
					refetch();
					return;
				}
				applyFrame(parsed);
			},
			onConnection: (event) => {
				if (isResyncSignal(event)) {
					refetch();
				}
			},
		},
		options,
	);

	const stop = () => {
		stopped = true;
		options?.signal?.removeEventListener("abort", stop);
		unsubscribeStream();
	};
	options?.signal?.addEventListener("abort", stop, { once: true });

	refetch();

	return stop;
}
