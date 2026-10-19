export type LegacyEvent = { type: string; properties: Record<string, unknown> };

/** V2 events carry data, not V1's properties. Only successful idle may resume. */
export function adaptEvent(event: {
  type: string;
  data?: unknown;
}): LegacyEvent[] {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const sessionID = data.sessionID;
  switch (event.type) {
    case 'session.created':
      return [
        {
          type: 'session.created',
          properties: { info: { ...data, id: sessionID } },
        },
      ];
    case 'session.deleted':
      return [
        {
          type: 'session.deleted',
          properties: { sessionID, info: { id: sessionID } },
        },
      ];
    case 'session.execution.started':
      return [
        {
          type: 'session.status',
          properties: { sessionID, status: { type: 'busy' } },
        },
      ];
    case 'session.execution.succeeded':
      return [{ type: 'session.idle', properties: { sessionID } }];
    case 'session.execution.interrupted':
      return [
        {
          type: 'session.error',
          properties: { sessionID, error: { name: 'AbortError' } },
        },
      ];
    case 'session.execution.failed':
      return [
        { type: 'session.error', properties: { sessionID, error: data.error } },
      ];
    default:
      return [];
  }
}
