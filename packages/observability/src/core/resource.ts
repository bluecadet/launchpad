import { randomUUID } from "node:crypto";
import type { DeploymentConfig } from "../observability-config.js";
import type { ResourceAttributes } from "./destination.js";

export const RESERVED_RESOURCE_ATTRIBUTE_KEYS = [
	"service.name",
	"service.instance.id",
	"deployment.environment.name",
	"launchpad.client",
	"launchpad.project",
	"launchpad.installation",
] as const;

/**
 * Build the canonical immutable resource shared by all destinations in one
 * observability setup. Call this once per setup so the instance id is stable
 * for that setup and changes after a restart.
 */
export function createResourceAttributes(deployment: DeploymentConfig): ResourceAttributes {
	return Object.freeze({
		...deployment.attributes,
		"service.name": "launchpad",
		"service.instance.id": randomUUID(),
		"deployment.environment.name": deployment.environment,
		"launchpad.client": deployment.client,
		"launchpad.project": deployment.project,
		"launchpad.installation": deployment.installation,
	});
}
