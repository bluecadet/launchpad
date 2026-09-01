/**
 * Sequence-gap tracking, implementing the wire contract's reconnection rules verbatim.
 *
 * Three of those rules are easy to get subtly wrong, so each is written out here:
 *
 * - The first `id` a connection sees is the baseline, whatever it happens to be. The
 *   counter is transport-global and shared by every client, so a fresh connection
 *   routinely starts at 12, not 1, and a jump of ten between two frames a client cares
 *   about is other frames the same counter covered — not a gap.
 * - A real `id` is never `0`. An untagged frame (the replay backlog) must never seed or
 *   satisfy a baseline.
 * - Every reconnect is a gap, unconditionally. Whether a connection is the first ever is
 *   tracked in its own flag, because a reconnect that has not yet seen a sequenced frame
 *   also has no baseline, and inferring "first ever" from that would skip its resync.
 */

/** What an `open` means: only the first connection is not a resync signal. */
export type OpenOutcome = "connected" | "reconnected";

export type GapCheck =
	| { readonly gap: false }
	| { readonly gap: true; readonly expected: number; readonly received: number };

const NO_GAP: GapCheck = { gap: false };

export type SequenceTracker = {
	open(): OpenOutcome;
	check(seq: number | undefined): GapCheck;
};

export function createSequenceTracker(): SequenceTracker {
	let hasConnectedBefore = false;
	let lastSeq: number | undefined;

	return {
		open() {
			if (!hasConnectedBefore) {
				hasConnectedBefore = true;
				return "connected";
			}
			lastSeq = undefined;
			return "reconnected";
		},

		check(seq) {
			if (seq === undefined || seq === 0 || !Number.isFinite(seq)) {
				return NO_GAP;
			}
			const expected = lastSeq === undefined ? undefined : lastSeq + 1;
			lastSeq = seq;
			if (expected === undefined || expected === seq) {
				return NO_GAP;
			}
			return { gap: true, expected, received: seq };
		},
	};
}
