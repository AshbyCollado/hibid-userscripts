export function createCopyCoordinator(writeText: (value: string) => Promise<void>) {
  let latestRequest = 0;
  let writes: Promise<void> = Promise.resolve();

  return {
    begin(): number {
      latestRequest += 1;
      return latestRequest;
    },
    isCurrent(request: number): boolean {
      return request === latestRequest;
    },
    write(request: number, value: string): Promise<boolean> {
      const pending = writes.then(async () => {
        if (request !== latestRequest) return false;
        await writeText(value);
        return true;
      });
      writes = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
}
