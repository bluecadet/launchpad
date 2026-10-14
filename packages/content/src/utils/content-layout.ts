/** Internal run namespaces are not source leaves, even when a source has the same name. */
export const RUN_LAYOUT = {
	downloads: "downloads",
	promotionRollback: ".promotion-rollback",
	recovery: ".recovery",
	recoveryRollback: ".recovery-rollback",
} as const;
