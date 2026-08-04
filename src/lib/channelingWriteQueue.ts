const writeQueues = new WeakMap<object, Promise<void>>();

export function withChannelingWriteLock<T>(db: object, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeQueues.set(db, current.then(() => undefined, () => undefined));
  return current;
}
