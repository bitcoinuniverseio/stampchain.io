import {
  rejects as assertRejects,
  strictEqual as assertEquals,
} from "node:assert";
import { WorkDrain } from "../../server/lifecycle/workDrain.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

Deno.test("shutdown retains a late child of accepted work", async () => {
  const work = new WorkDrain();
  const parent = deferred();
  const child = deferred();
  const accepted = work.run(async () => {
    await parent.promise;
    void work.run(() => child.promise);
  });
  work.stopAdmission();
  await assertRejects(() => work.run(async () => {}));
  parent.resolve();
  let drained = false;
  const drain = work.drain().then(() => drained = true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assertEquals(drained, false);
  assertEquals(work.active, 1);
  child.resolve();
  await accepted;
  await drain;
  assertEquals(work.active, 0);
});

Deno.test("disconnected real HTTP caller does not release handler work", async () => {
  const work = new WorkDrain();
  const entered = deferred();
  const release = deferred();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, () => {
    return work.run(async () => {
      entered.resolve();
      await release.promise;
      return new Response("completed");
    });
  });
  const controller = new AbortController();
  const caller = fetch(`http://127.0.0.1:${server.addr.port}`, {
    signal: controller.signal,
  }).catch(() => {});
  await entered.promise;
  controller.abort();
  await caller;
  work.stopAdmission();
  let done = false;
  const drain = work.drain().then(() => done = true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assertEquals(done, false);
  assertEquals(work.active, 1);
  release.resolve();
  await drain;
  await server.shutdown();
  assertEquals(work.active, 0);
});

Deno.test("caller deadline returns while its physical driver remains retained", async () => {
  const work = new WorkDrain();
  const driver = deferred();
  const caller = work.run(() => {
    work.retain(driver.promise);
    return Promise.reject(new Error("synthetic original caller deadline"));
  });
  await assertRejects(() => caller, /caller deadline/);
  work.stopAdmission();
  let drained = false;
  const drain = work.drain().then(() => drained = true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assertEquals(drained, false);
  driver.resolve();
  await drain;
  assertEquals(work.active, 0);
});
