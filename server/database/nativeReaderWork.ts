import { AsyncLocalStorage } from "node:async_hooks";

interface Frame {
  deadline: number;
  children: Set<Promise<unknown>>;
  childFailures: unknown[];
  closed: boolean;
}

interface Waiting {
  start: () => void;
  expire: () => void;
}

/** Caller deadlines never release a slot before the actual driver settles. */
export class NativeReaderWork {
  readonly #context = new AsyncLocalStorage<Frame>();
  readonly #waiting: Waiting[] = [];
  readonly #actual = new Set<Promise<unknown>>();
  #active = 0;
  #stopped = false;

  get active(): number {
    return this.#active;
  }

  get queued(): number {
    return this.#waiting.length;
  }

  assertAdmitted(): void {
    if (
      !this.#context.getStore() || this.#context.getStore()!.closed ||
      Date.now() >= this.#context.getStore()!.deadline
    ) {
      throw new Error(
        "Native reader acquisition requires an admitted work slot",
      );
    }
  }

  stopAdmission(): void {
    this.#stopped = true;
    for (const waiting of [...this.#waiting]) waiting.expire();
  }

  async drain(): Promise<void> {
    while (this.#actual.size) await Promise.allSettled([...this.#actual]);
  }

  async run<T>(
    operation: () => Promise<T>,
    budgetMs: 4000 | 10000,
  ): Promise<T> {
    const parent = this.#context.getStore();
    const deadline = Math.min(
      Date.now() + budgetMs,
      parent?.deadline ?? Infinity,
    );
    if (parent) {
      if (parent.closed) {
        throw new Error("Native reader work context is closed");
      }
      const actual = Promise.resolve().then(operation);
      parent.children.add(actual);
      actual.catch((error) => parent.childFailures.push(error));
      actual.finally(() => parent.children.delete(actual)).catch(() => {});
      return await this.#bounded(actual, deadline);
    }
    if (this.#stopped) throw new Error("Native reader admission is closed");

    return await new Promise<T>((resolve, reject) => {
      let waiting: Waiting | undefined;
      const expire = () => {
        clearTimeout(timer);
        if (waiting) {
          const index = this.#waiting.indexOf(waiting);
          if (index >= 0) this.#waiting.splice(index, 1);
        }
        reject(new Error("Native reader deadline exceeded"));
      };
      const start = () => {
        waiting = undefined;
        if (Date.now() >= deadline) {
          clearTimeout(timer);
          expire();
          this.#next();
          return;
        }
        this.#active++;
        const frame: Frame = {
          deadline,
          children: new Set(),
          childFailures: [],
          closed: false,
        };
        const actual = this.#context.run(frame, async () => {
          let result: T | undefined;
          let failure: unknown;
          let failed = false;
          try {
            result = await operation();
          } catch (error) {
            failed = true;
            failure = error;
            // A known caller failure is observable now; its driver children
            // still retain the physical slot until the drain below completes.
            reject(error);
          }
          // Nested connection/auth work can outlive its caller timeout.
          while (frame.children.size) {
            await Promise.allSettled([...frame.children]);
          }
          frame.closed = true;
          if (failed) throw failure;
          if (frame.childFailures.length) {
            throw new Error("Native reader nested driver failed", {
              cause: frame.childFailures[0],
            });
          }
          return result as T;
        });
        this.#actual.add(actual);
        actual.then(
          (value) =>
            Date.now() >= deadline
              ? reject(new Error("Native reader deadline exceeded"))
              : resolve(value),
          reject,
        ).finally(() => {
          clearTimeout(timer);
          this.#actual.delete(actual);
          this.#active--;
          this.#next();
        }).catch(() => {});
      };
      const timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
      if (this.#active < 2) start();
      else if (this.#waiting.length < 2) {
        waiting = { start, expire };
        this.#waiting.push(waiting);
      } else {
        clearTimeout(timer);
        reject(new Error("Native reader work queue is full"));
      }
    });
  }

  #next(): void {
    while (this.#active < 2 && this.#waiting.length) {
      this.#waiting.shift()!.start();
    }
  }

  async #bounded<T>(actual: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        actual,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native reader deadline exceeded")),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
      if (Date.now() >= deadline) {
        throw new Error("Native reader deadline exceeded");
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
