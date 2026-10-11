import { AsyncLocalStorage } from "node:async_hooks";

interface WorkFrame {
  children: Set<Promise<unknown>>;
  closed: boolean;
}

/** A disconnected caller cannot release work that is still using a store. */
export class WorkDrain {
  readonly #context = new AsyncLocalStorage<WorkFrame>();
  readonly #actual = new Set<Promise<unknown>>();
  #accepting = true;

  get accepting(): boolean {
    return this.#accepting;
  }

  get active(): number {
    return this.#actual.size;
  }

  stopAdmission(): void {
    this.#accepting = false;
  }

  /** Registers an already admitted physical driver, not a new admission. */
  retain(actual: Promise<unknown>): void {
    const parent = this.#context.getStore();
    if (parent && !parent.closed) {
      parent.children.add(actual);
      actual.finally(() => parent.children.delete(actual)).catch(() => {});
    }
    this.#actual.add(actual);
    actual.finally(() => this.#actual.delete(actual)).catch(() => {});
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const parent = this.#context.getStore();
    if (parent?.closed || (!parent && !this.#accepting)) {
      return Promise.reject(new Error("Application work admission is closed"));
    }
    if (parent) {
      const actual = Promise.resolve().then(operation);
      parent.children.add(actual);
      actual.finally(() => parent.children.delete(actual)).catch(() => {});
      return actual;
    }
    const frame: WorkFrame = { children: new Set(), closed: false };
    const caller = this.#context.run(
      frame,
      () => Promise.resolve().then(operation),
    );
    const actual = caller.finally(async () => {
      while (frame.children.size) {
        await Promise.allSettled([...frame.children]);
      }
      frame.closed = true;
    });
    this.#actual.add(actual);
    actual.finally(() => this.#actual.delete(actual)).catch(() => {});
    // Preserve the caller's response/deadline while physical children drain.
    return caller;
  }

  async drain(): Promise<void> {
    while (this.#actual.size) {
      await Promise.allSettled([...this.#actual]);
    }
  }
}

export const applicationWork = new WorkDrain();
