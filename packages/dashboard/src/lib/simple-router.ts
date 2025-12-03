import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { Result } from "neverthrow";
import { err, ok, ResultAsync } from "neverthrow";
import { type MatchFunction, match } from "path-to-regexp";

type DashboardRouteParams = Record<string, string | string[] | undefined>;

export type DashboardRouteHandler<T extends DashboardRouteParams = Record<string, never>> = (
	req: IncomingMessage,
	res: ServerResponse,
	params: T,
) => void | Promise<void>;

interface Route<T extends DashboardRouteParams = Record<string, never>> {
	method: string;
	handler: DashboardRouteHandler<T>;
	pathMatcher: MatchFunction<T>;
	path: string;
}

export class SimpleRouter {
	constructor(private logger: Logger) {}

	private routes: Route<DashboardRouteParams>[] = [];

	get<T extends DashboardRouteParams>(path: string, handler: DashboardRouteHandler<T>): this {
		this.addRoute("GET", path, handler);
		return this;
	}

	post<T extends DashboardRouteParams>(path: string, handler: DashboardRouteHandler<T>): this {
		this.addRoute("POST", path, handler);
		return this;
	}

	put<T extends DashboardRouteParams>(path: string, handler: DashboardRouteHandler<T>): this {
		this.addRoute("PUT", path, handler);
		return this;
	}

	patch<T extends DashboardRouteParams>(path: string, handler: DashboardRouteHandler<T>): this {
		this.addRoute("PATCH", path, handler);
		return this;
	}

	delete<T extends DashboardRouteParams>(path: string, handler: DashboardRouteHandler<T>): this {
		this.addRoute("DELETE", path, handler);
		return this;
	}

	private addRoute<T extends DashboardRouteParams>(
		method: string,
		path: string,
		handler: DashboardRouteHandler<T>,
	): void {
		const pathMatcher = match<T>(path);
		this.routes.push({
			method,
			// once we're matching, we don't need the specific type anymore, so
			// we can cast to DashboardRouteHandler<DashboardRouteParams> for simplicity
			handler: handler as DashboardRouteHandler<DashboardRouteParams>,
			// And same for the path matcher
			pathMatcher: pathMatcher as MatchFunction<DashboardRouteParams>,
			path,
		});
	}

	private matchRoute(
		method: string,
		path: string,
	): Result<{ route: Route<DashboardRouteParams>; params: DashboardRouteParams }, string> {
		for (const route of this.routes) {
			if (route.method === method) {
				const matchResult = route.pathMatcher(path);

				if (!matchResult) {
					continue;
				}
				const params = matchResult.params;
				return ok({ route, params });
			}
		}

		return err("No route found");
	}

	createRequestHandler() {
		return async (req: IncomingMessage, res: ServerResponse) => {
			const method = req.method || "GET";
			const path = req.url?.split("?")[0] || "/";

			const matchResult = this.matchRoute(method, path);

			if (matchResult.isErr()) {
				this.logger.warn(`No route matched for ${method} ${path}`);
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Not Found" }));
				return;
			}

			const { route, params } = matchResult.value;

			try {
				this.logger.verbose(`Handling ${method} ${path} with route ${route.path}`);
				await route.handler(req, res, params);
			} catch (error) {
				this.logger.error(new Error(`Error handling ${method} ${path}`, { cause: error }));
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: "Internal Server Error",
						message: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		};
	}

	listen(port: number, hostname = "localhost") {
		const server = createServer(this.createRequestHandler());
		server.listen(port, hostname, () => {
			this.logger.info(`Server running at http://${hostname}:${port}`);
		});

		return () => {
			return ResultAsync.fromPromise(
				new Promise<void>((resolve, reject) => {
					server.close((err) => {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				}),
				(err) => new Error("Error closing server", { cause: err }),
			);
		};
	}
}
