import { applicationWork, type WorkDrain } from "./workDrain.ts";

export class ApplicationLifecycle {
  #stopping = false;
  #shutdown: Promise<void> | undefined;
  #server: Deno.HttpServer | undefined;
  readonly #resources: Array<() => Promise<void>> = [];
  readonly #producers: Array<() => void> = [];
  readonly #lateListeners = new Set<Promise<void>>();

  constructor(readonly work: WorkDrain = applicationWork) {}

  get stopping(): boolean {
    return this.#stopping;
  }

  ownServer(server: Deno.HttpServer): void {
    if (this.#stopping) {
      // A delayed startup cannot leave a newly allocated listener behind.
      const closed = server.shutdown();
      closed.catch(() => {});
      this.#lateListeners.add(closed);
      return;
    }
    this.#server = server;
  }

  ownProducer(stop: () => void): void {
    if (this.#stopping) stop();
    else this.#producers.push(stop);
  }

  ownResource(close: () => Promise<void>): void {
    this.#resources.push(close);
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#stopping = true;
    this.work.stopAdmission();
    const stopFailures: unknown[] = [];
    for (const stop of this.#producers) {
      try {
        stop();
      } catch (error) {
        stopFailures.push(error);
      }
    }
    const httpDrain = this.#server?.shutdown();
    httpDrain?.catch(() => {});
    this.#shutdown = (async () => {
      // Includes delayed startup and children of requests that disconnected.
      await this.work.drain();
      await httpDrain;
      for (const closed of this.#lateListeners) await closed;
      if (stopFailures.length) {
        throw new AggregateError(
          stopFailures,
          "Background admission could not close",
        );
      }
      for (const close of this.#resources) await close();
    })();
    return this.#shutdown;
  }
}
