import { rejects, strictEqual as equal } from "node:assert";
import { ApplicationLifecycle } from "../../server/lifecycle/applicationLifecycle.ts";
import { WorkDrain } from "../../server/lifecycle/workDrain.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

Deno.test("shutdown waits accepted HTTP and store work before closing pool", async () => {
  const work = new WorkDrain();
  const lifecycle = new ApplicationLifecycle(work);
  const entered = deferred();
  const driver = deferred();
  let poolClosed = false;
  let futureJobsStopped = false;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, () => {
    return work.run(async () => {
      entered.resolve();
      await driver.promise;
      equal(poolClosed, false);
      return new Response("settled");
    });
  });
  lifecycle.ownServer(server);
  lifecycle.ownProducer(() => futureJobsStopped = true);
  lifecycle.ownResource(() => {
    poolClosed = true;
    return Promise.resolve();
  });
  const response = fetch(`http://127.0.0.1:${server.addr.port}`);
  await entered.promise;
  const closing = lifecycle.shutdown();
  equal(futureJobsStopped, true);
  equal(poolClosed, false);
  driver.resolve();
  await (await response).text();
  await closing;
  equal(poolClosed, true);
});

Deno.test("late startup resource is closed after its actual startup settles", async () => {
  const work = new WorkDrain();
  const lifecycle = new ApplicationLifecycle(work);
  const startup = deferred();
  let closed = false;
  const accepted = work.run(async () => {
    await startup.promise;
    lifecycle.ownResource(() => {
      closed = true;
      return Promise.resolve();
    });
    equal(lifecycle.stopping, true);
  });
  const stopping = lifecycle.shutdown();
  equal(closed, false);
  startup.resolve();
  await accepted;
  await stopping;
  equal(closed, true);
});

Deno.test("uncertain pool close is a shutdown failure, never successful drain", async () => {
  const lifecycle = new ApplicationLifecycle(new WorkDrain());
  lifecycle.ownResource(() =>
    Promise.reject(new Error("synthetic pool close uncertainty"))
  );
  await rejects(() => lifecycle.shutdown(), /pool close uncertainty/);
  equal(lifecycle.stopping, true);
  await rejects(() => lifecycle.shutdown(), /pool close uncertainty/);
});

Deno.test("delayed startup listener is closed rather than escaping shutdown", async () => {
  const work = new WorkDrain();
  const lifecycle = new ApplicationLifecycle(work);
  const release = deferred();
  let server: Deno.HttpServer<Deno.NetAddr> | undefined;
  const startup = work.run(async () => {
    await release.promise;
    server = Deno.serve(
      { hostname: "127.0.0.1", port: 0 },
      () => new Response("late"),
    );
    lifecycle.ownServer(server);
  });
  const stopping = lifecycle.shutdown();
  release.resolve();
  await startup;
  await stopping;
  await rejects(() => fetch(`http://127.0.0.1:${server!.addr.port}`));
});

Deno.test("uncertain producer stop retains stores instead of reporting clean close", async () => {
  const lifecycle = new ApplicationLifecycle(new WorkDrain());
  let closed = false;
  lifecycle.ownProducer(() => {
    throw new Error("synthetic stop failure");
  });
  lifecycle.ownResource(() => {
    closed = true;
    return Promise.resolve();
  });
  await rejects(() => lifecycle.shutdown(), /Background admission/);
  equal(closed, false);
});
