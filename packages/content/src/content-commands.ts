/**
 * Content subsystem command types.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import type { BaseCommand } from "@bluecadet/launchpad-utils";

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
 * Union of all content command types
 */
export type ContentCommand =
	| ContentFetchCommand
	| ContentClearCommand
	| ContentBackupCommand
	| ContentRestoreCommand;
