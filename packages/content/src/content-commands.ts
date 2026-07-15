/**
 * Content plugin command types.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";
import type { Manifest } from "./manifest.js";

const stringArraySchema = z.array(z.string()).optional();

/**
 * Fetch content from all or specific sources
 */
export type ContentFetchCommand = BaseCommand & {
	type: "content.fetch";
	sources?: string[]; // If provided, only fetch these source IDs
};

/**
 * Clear cached content
 */
export type ContentClearCommand = BaseCommand & {
	type: "content.clear";
	sources?: string[]; // If provided, only clear these source IDs
	temp?: boolean; // Clear temp directory
	backups?: boolean; // Clear backup directory
	downloads?: boolean; // Clear downloads directory
};

/**
 * Backup content
 */
export type ContentBackupCommand = BaseCommand & {
	type: "content.backup";
	sources?: string[]; // If provided, only backup these source IDs
};

/**
 * Restore content from backup
 */
export type ContentRestoreCommand = BaseCommand & {
	type: "content.restore";
	sources?: string[]; // If provided, only restore these source IDs
	removeBackups?: boolean; // Remove backups after restoring
};

/**
 * Write/renew an ack lease for a consumer, extending retention of a named version
 * beyond keep-N for as long as the lease stays fresh. Only meaningful under versioning.
 */
export type ContentAckCommand = BaseCommand & {
	type: "content.ack";
	consumerId: string;
	versionId: string;
};

/**
 * Read the active version manifest (`manifest.json` in the published download path).
 * Only meaningful under versioning; without it the manifest never exists.
 */
export type ContentManifestReadCommand = BaseCommand & {
	type: "content.manifest.read";
};

/**
 * JSON-safe result of `content.manifest.read`. `invalid` carries the parse failure as a
 * message rather than an Error instance so results survive IPC serialization.
 */
export type ManifestReadCommandResult =
	| { status: "ok"; manifest: Manifest }
	| { status: "missing" }
	| { status: "invalid"; message: string };

/**
 * Union of all content command types
 */
export type ContentCommand =
	| ContentFetchCommand
	| ContentClearCommand
	| ContentBackupCommand
	| ContentRestoreCommand
	| ContentAckCommand
	| ContentManifestReadCommand;

export type ContentCommandMap = {
	"content.fetch": { input: ContentFetchCommand; output: undefined };
	"content.clear": { input: ContentClearCommand; output: undefined };
	"content.backup": { input: ContentBackupCommand; output: undefined };
	"content.restore": { input: ContentRestoreCommand; output: undefined };
	"content.ack": { input: ContentAckCommand; output: undefined };
	"content.manifest.read": {
		input: ContentManifestReadCommand;
		output: ManifestReadCommandResult;
	};
};

export const contentFetchCommandSchema = z
	.object({
		type: z.literal("content.fetch"),
		sources: stringArraySchema,
	})
	.strict();

export const contentClearCommandSchema = z
	.object({
		type: z.literal("content.clear"),
		sources: stringArraySchema,
		temp: z.boolean().optional(),
		backups: z.boolean().optional(),
		downloads: z.boolean().optional(),
	})
	.strict();

export const contentBackupCommandSchema = z
	.object({
		type: z.literal("content.backup"),
		sources: stringArraySchema,
	})
	.strict();

export const contentRestoreCommandSchema = z
	.object({
		type: z.literal("content.restore"),
		sources: stringArraySchema,
		removeBackups: z.boolean().optional(),
	})
	.strict();

export const contentAckCommandSchema = z
	.object({
		type: z.literal("content.ack"),
		consumerId: z.string().min(1),
		versionId: z.string().min(1),
	})
	.strict();

export const contentManifestReadCommandSchema = z
	.object({
		type: z.literal("content.manifest.read"),
	})
	.strict();

export const contentCommandSchema = z.discriminatedUnion("type", [
	contentFetchCommandSchema,
	contentClearCommandSchema,
	contentBackupCommandSchema,
	contentRestoreCommandSchema,
	contentAckCommandSchema,
	contentManifestReadCommandSchema,
]);
