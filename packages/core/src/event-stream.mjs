export function validateEventStream(events) {
  const errors = [];

  if (events.length === 0) {
    return { valid: true, errors };
  }

  const runId = events[0].run_id;
  const eventIds = new Set();
  let previousTime = Number.NEGATIVE_INFINITY;

  if (events[0].type !== "run.created") {
    errors.push("the first event must be run.created");
  }

  events.forEach((event, index) => {
    const expectedSequence = index + 1;

    if (event.sequence !== expectedSequence) {
      errors.push(
        `event ${event.event_id} has sequence ${event.sequence}; expected ${expectedSequence}`
      );
    }

    if (event.run_id !== runId) {
      errors.push(`event ${event.event_id} belongs to a different run`);
    }

    if (eventIds.has(event.event_id)) {
      errors.push(`event id ${event.event_id} is duplicated`);
    }
    eventIds.add(event.event_id);

    const eventTime = Date.parse(event.at);
    if (!Number.isFinite(eventTime)) {
      errors.push(`event ${event.event_id} has an invalid timestamp`);
    } else if (eventTime < previousTime) {
      errors.push(`event ${event.event_id} is older than the previous event`);
    }
    previousTime = eventTime;
  });

  return { valid: errors.length === 0, errors };
}

