import { Cron } from "croner";

/**
 * Builds a function that resolves the next wall-clock fire `Date` after a given point in
 * time, for a validated 5-field cron expression. `paused: true` means croner is only used
 * as an expression evaluator here — it never schedules or runs anything itself.
 */
export function createCronNextRun(cronExpression: string): (from: Date) => Date | null {
	const job = new Cron(cronExpression, { paused: true });
	return (from: Date) => job.nextRun(from);
}
