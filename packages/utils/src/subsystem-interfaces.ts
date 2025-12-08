import type { HTTPHandler } from "h3";
import type { ResultAsync } from "neverthrow";
import type { EventBus } from "./event-bus.js";
import type { Logger } from "./logger.js";
import type { PatchHandler, PatchHandlerWithVersion } from "./state-patcher.js";
import type { VersionedLaunchpadState } from "./types.js";

export type DisconnectReason =
	| { type: "manual" }
	| { type: "error"; error: Error }
	| { type: "signal"; signal: NodeJS.Signals };

/**
 * Optional interface for subsystems that can be gracefully disconnected.
 * The controller will call disconnect() during shutdown if implemented.
 */
export interface Disconnectable {
	/**
	 * Gracefully disconnect this subsystem.
	 * Should clean up resources, close connections, stop processes, etc.
	 */
	disconnect(reason: DisconnectReason): ResultAsync<void, Error>;
}

/**
 * Base command structure that all subsystem commands must follow.
 * Subsystems define their own specific command types that extend this.
 */
export type BaseCommand = {
	type: string;
	[key: string]: unknown;
};

/**
 * Optional interface for subsystems that can execute commands.
 * When implemented, the controller will route commands to this method.
 * The subsystem handles its own command routing internally.
 *
 * @template TCommand - The command type this subsystem accepts (must extend BaseCommand)
 */
export interface CommandExecutor<TCommand extends BaseCommand = BaseCommand> {
	/**
	 * Execute a command on this subsystem.
	 * @param command - Command object with type and parameters
	 * @returns Result of command execution
	 */
	executeCommand(command: TCommand): ResultAsync<unknown, Error>;
}

/**
 * Optional interface for subsystems that provide queryable state.
 * When implemented, the controller can aggregate state from all subsystems.
 *
 * @template TState - The state type this subsystem provides
 */
export interface StateProvider<TState = unknown> {
	/**
	 * Get the current (immutable) state of this subsystem.
	 * This should be a lightweight, synchronous operation.
	 * @returns Current state snapshot
	 */
	getState(): TState;

	/**
	 * Subscribe to state patches/updates.
	 * @param handler - Function called with an array of state patches
	 * @return Unsubscribe function
	 */
	onStatePatch(handler: PatchHandler): () => void;
}

/**
 * Represents a panel within a dashboard interface.
 * Panels are individual content blocks that can be arranged and ordered.
 */
export type DashboardPanel = {
	/** The HTML or text content to display in the panel */
	content: string;
	/** Optional display order for panel arrangement. Lower numbers appear first */
	order?: number;
};

/**
 * Represents a complete dashboard page that can contain either multiple panels or raw content.
 * Pages provide a way to organize dashboard content into separate views or sections.
 */
export type DashboardPage = {
	/** Optional display order for page arrangement. Lower numbers appear first */
	order?: number;
} & (
	| {
			/** Page with multiple organized panels */
			panels: DashboardPanel[];
	  }
	| {
			/** Page with raw HTML/text content */
			content: string;
	  }
);

export type DashboardRouteParams = Record<string, string | string[] | undefined>;

/**
 * Function type for handling HTTP requests to dashboard API endpoints.
 * Can return either a synchronous Response or a Promise that resolves to a Response.
 */
export type DashboardRouteHandler = HTTPHandler;

/**
 * Write-only interface for subsystems to register dashboard content.
 * This is the public API that subsystems use to contribute to the dashboard.
 * The dashboard subsystem maintains private methods to access the registered content.
 */
export interface DashboardRegistry {
	/**
	 * Registers a panel to the dashboard.
	 * Panels are individual content blocks that will be rendered in the dashboard interface.
	 * @param id - Unique identifier for the panel
	 * @param panel - The dashboard panel to register
	 */
	registerPanel(id: string, panel: DashboardPanel): this;

	/**
	 * Registers a page to the dashboard.
	 * Pages provide separate views or sections within the dashboard.
	 * @param id - Unique identifier for the page
	 * @param page - The dashboard page to register
	 */
	registerPage(id: string, page: DashboardPage): this;

	/**
	 * Registers a CSS file to the dashboard for custom styling.
	 * @param path - The file path or URL of the CSS file to include
	 */
	registerCSS(path: string): this;

	/**
	 * Registers a JavaScript file to the dashboard for custom functionality.
	 * @param path - The file path or URL of the JavaScript file to include
	 */
	registerJS(path: string): this;

	/**
	 * API route registration methods for handling HTTP requests.
	 * Allows subsystems to expose custom endpoints for dashboard interactions.
	 */
	api: {
		/**
		 * Registers a GET endpoint handler for retrieving data or resources.
		 * @param route - The API route path (e.g., "/api/status")
		 * @param handler - The endpoint handler function
		 */
		get: (route: string, handler: DashboardRouteHandler) => DashboardRegistry;

		/**
		 * Registers a POST endpoint handler for creating new resources.
		 * @param route - The API route path (e.g., "/api/commands")
		 * @param handler - The endpoint handler function
		 */
		post: (route: string, handler: DashboardRouteHandler) => DashboardRegistry;

		/**
		 * Registers a PUT endpoint handler for updating existing resources.
		 * @param route - The API route path (e.g., "/api/config")
		 * @param handler - The endpoint handler function
		 */
		put: (route: string, handler: DashboardRouteHandler) => DashboardRegistry;

		/**
		 * Registers a DELETE endpoint handler for removing resources.
		 * @param route - The API route path (e.g., "/api/sessions/:id")
		 * @param handler - The endpoint handler function
		 */
		delete: (route: string, handler: DashboardRouteHandler) => DashboardRegistry;
	};
}

/**
 * Optional interface for subsystems that want to contribute content to the dashboard.
 * When implemented, the controller will call buildDashboard() during subsystem setup
 * to allow the subsystem to register panels, pages, and API endpoints.
 */
export interface DashboardProvider {
	/**
	 * Allows the subsystem to contribute dashboard content.
	 * Subsystems should use the provided registry to register panels, pages, and API routes.
	 * @param registry - Dashboard registry instance for registering content and endpoints
	 */
	buildDashboard(registry: DashboardRegistry): void;
}

export interface SubsystemContext {
	readonly eventBus: EventBus;
	readonly logger: Logger;
	readonly abortSignal: AbortSignal;
	readonly cwd: string;
	readonly dispatchCommand: (command: BaseCommand) => ResultAsync<unknown, Error>;
	readonly getState: () => VersionedLaunchpadState;
	readonly onStatePatch: (handler: PatchHandlerWithVersion) => () => void;
}

/**
 * Generic subsystem type that can optionally implement any controller interfaces.
 *
 * @template TCommand - The command type this subsystem accepts (must extend BaseCommand)
 * @template TState - The state type this subsystem provides
 */
export type InstantiatedSubsystem<
	TCommand extends BaseCommand = BaseCommand,
	TState = unknown,
> = Partial<
	Disconnectable & CommandExecutor<TCommand> & StateProvider<TState> & DashboardProvider
> & {
	[key: string]: unknown;
};

/**
 * Interface for subsystems that require async setup/initialization.
 * Factories implement this interface to provide a formalized setup flow.
 *
 * @template TCommand - The command type this subsystem accepts
 * @template TState - The state type this subsystem provides
 * @template E - The error type returned on setup failure
 * @template TSubsystem - The actual subsystem type returned
 */
export interface SubsystemConfig<
	TCommand extends BaseCommand = BaseCommand,
	TState = unknown,
	E = Error,
	TSubsystem extends InstantiatedSubsystem<TCommand, TState> = InstantiatedSubsystem<
		TCommand,
		TState
	>,
> {
	/**
	 * Unique name of the subsystem.
	 */
	name: string;
	/**
	 * Initialize a subsystem instance with the provided context.
	 * This is called once during subsystem registration.
	 *
	 * @param ctx Subsystem context (logger, eventBus, cwd)
	 * @returns Configured subsystem instance that conforms to standard interfaces
	 */
	setup(ctx: SubsystemContext): ResultAsync<TSubsystem, E>;
}

// Helper that validates conformance while preserving concrete type
export function defineSubsystem<
	TCommand extends BaseCommand,
	TState,
	E,
	TSubsystem extends InstantiatedSubsystem<TCommand, TState>,
>(
	factory: SubsystemConfig<TCommand, TState, E, TSubsystem>,
): SubsystemConfig<TCommand, TState, E, TSubsystem> {
	return factory;
}
