export interface MongoCommandSucceededEvent {
  commandName: string;
  databaseName: string;
  duration: number;
}

export function isSlowQuery(
  event: MongoCommandSucceededEvent,
  thresholdMs: number,
): boolean {
  return event.duration >= thresholdMs;
}

export function buildSlowQueryLogMessage(
  event: MongoCommandSucceededEvent,
): string {
  return `Slow query: ${event.commandName} on ${event.databaseName} took ${event.duration}ms`;
}
