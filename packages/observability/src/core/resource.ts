import { randomUUID } from "node:crypto";
import type { ResourceAttributes } from "./destination.js";

/**
 * Build the immutable resource shared by all destinations in one observability
 * setup. Call this once per setup so the instance id is stable for that setup
 * and changes after a restart.
 */
export function createResourceAttributes(resource: ResourceAttributes = {}): ResourceAttributes {
	if (Object.hasOwn(resource, "service.instance.id")) {
		throw new Error('Resource attribute "service.instance.id" is managed by the runtime');
	}

	return Object.freeze({
		"service.name": "launchpad",
		...resource,
		"service.instance.id": randomUUID(),
	});
}
