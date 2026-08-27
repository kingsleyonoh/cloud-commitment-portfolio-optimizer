export interface ManagedCache<T> {
  get(): Promise<T>;
  close(): Promise<void>;
  reset(): Promise<void>;
}

export type ResourceDisposer<T> = (resource: T) => void | Promise<void>;

export function createManagedCache<T>(
  factory: () => T | Promise<T>,
  dispose: ResourceDisposer<T> = async () => undefined,
): ManagedCache<T> {
  let current: Promise<T> | undefined;
  let closing: Promise<void> | undefined;

  async function get(): Promise<T> {
    while (closing) await closing;
    if (current) return current;

    const created = Promise.resolve().then(factory);
    current = created;
    void created.catch(() => {
      if (current === created) current = undefined;
    });
    return created;
  }

  function close(): Promise<void> {
    if (closing) return closing;
    const acquired = current;
    current = undefined;
    const operation = closeGeneration(acquired, dispose);
    closing = operation;
    void operation.then(clearClosing, clearClosing);
    return operation;

    function clearClosing(): void {
      if (closing === operation) closing = undefined;
    }
  }

  return { get, close, reset: close };
}

async function closeGeneration<T>(
  acquired: Promise<T> | undefined,
  dispose: ResourceDisposer<T>,
): Promise<void> {
  if (!acquired) return;
  const resource = await acquired;
  await dispose(resource);
}
