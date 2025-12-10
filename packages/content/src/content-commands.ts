/**
 * Content subsystem command types.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import "@bluecadet/launchpad-utils/types";

// Declaration merging to add content commands to LaunchpadCommands
declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadCommands {
		/**
		 * Fetch content from all or specific sources
		 */
		"content.fetch": {
			/** If provided, only fetch these source IDs */
			sources?: string[];
		};

		/**
		 * Clear cached content
		 */
		"content.clear": {
			/** If provided, only clear these source IDs */
			sources?: string[];
			/** Clear temp directory */
			temp?: boolean;
			/** Clear backup directory */
			backups?: boolean;
			/** Clear downloads directory */
			downloads?: boolean;
		};

		/**
		 * Backup content
		 */
		"content.backup": {
			/** If provided, only backup these source IDs */
			sources?: string[];
		};

		/**
		 * Restore content from backup
		 */
		"content.restore": {
			/** If provided, only restore these source IDs */
			sources?: string[];
			/** Remove backups after restoring */
			removeBackups?: boolean;
		};
	}
}
