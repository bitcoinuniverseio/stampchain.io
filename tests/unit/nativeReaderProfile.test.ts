import { getDatabaseConfig } from "../../server/config/database.config.ts";
import {
  nativeReaderSettings,
  prepareNativeReaderConnection,
  requireNativeProbeReply,
  sameNativeProofIdentity,
  validateNativeReaderProof,
} from "../../server/database/nativeReaderProfile.ts";
import { NativeReaderWork } from "../../server/database/nativeReaderWork.ts";
import type { Client } from "../../vendor/mysql-2.12.1/src/client.ts";

function assert(value: unknown): void {
  if (!value) throw new Error("Native reader control failed");
}

async function refused(
  operation: () => unknown | Promise<unknown>,
): Promise<void> {
  let failed = false;
  try {
    await operation();
  } catch {
    failed = true;
  }
  assert(failed);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const settingsEnv: Record<string, string> = {
  DB_READER_PROFILE: "owned-unix-readonly",
  DB_SOCKET_PATH: "/run/universe-stampchain-reader/mysql.sock",
  DB_NATIVE_READER_PROOF_PATH: "/run/universe-stampchain-reader/proof.json",
  DB_USER: "synthetic_readonly",
  DB_NAME: "synthetic_schema",
};

Deno.test("proof identity refuses mode/uid/link/time mutation at opened and post-read boundaries", () => {
  const base = {
    isFile: true,
    isSymlink: false,
    ino: 123,
    dev: 48,
    size: 1024,
    uid: 0,
    gid: 0,
    mode: 0o444,
    nlink: 1,
    mtime: new Date(1234),
    ctime: new Date(2345),
  } as Deno.FileInfo;
  assert(sameNativeProofIdentity(base, base));
  for (
    const delta of [
      { uid: 1 },
      { gid: 1 },
      { mode: 0o644 },
      { nlink: 2 },
      { ino: 124 },
      { dev: 49 },
      { size: 1025 },
      { mtime: new Date(1235) },
      { ctime: new Date(2346) },
      { isFile: false },
      { isSymlink: true },
    ]
  ) {
    assert(!sameNativeProofIdentity({ ...base, ...delta }, base));
  }
});

Deno.test("explicit profile refuses missing socket/proof and ordinary profile stays ordinary", async () => {
  assert(nativeReaderSettings(() => undefined) === null);
  for (
    const changes of [
      { DB_READER_PROFILE: "unknown" },
      { DB_READER_PROFILE: "" },
      { DB_SOCKET_PATH: "/tmp/unproved.sock" },
      { DB_NATIVE_READER_PROOF_PATH: "" },
      { DB_USER: "root" },
      { DB_ENABLE_TLS: "true" },
      { DB_NATIVE_TCP_FALLBACK: "true" },
      { DB_HOST: "127.0.0.1" },
      { DB_PORT: "3306" },
    ]
  ) {
    const values: Record<string, string | undefined> = {
      ...settingsEnv,
      ...changes,
    };
    await refused(() => nativeReaderSettings((key) => values[key]));
  }
});

Deno.test("actualDatabaseManager pooled probe retains client until driver settlement without recursion", async () => {
  // Only the immutable source-owned factory/verifier are overridden; the actual
  // manager getClient/attempt/execute/close paths and work gate run unchanged.
  const keys = [...Object.keys(settingsEnv), "DENO_ENV", "DB_HOST", "DB_PORT"];
  const previous = keys.map((key) => Deno.env.get(key));
  Object.entries(settingsEnv).forEach(([key, value]) =>
    Deno.env.set(key, value)
  );
  Deno.env.set("DENO_ENV", "test");
  Deno.env.delete("DB_HOST");
  Deno.env.delete("DB_PORT");
  Deno.args.push("build");
  try {
    const { DatabaseManager } = await import(
      "../../server/database/databaseManager.ts"
    );
    const probe = deferred<unknown[]>();
    let queryCount = 0, factories = 0, closed = 0, executed = 0;
    const fake = {
      async connect() {},
      async query() {
        queryCount++;
        return queryCount === 1
          ? [{ native_reader_probe: 1 }]
          : await probe.promise;
      },
      async execute() {
        executed++;
        return {};
      },
      close() {
        closed++;
      },
    };
    class Manager extends DatabaseManager {
      protected override async verifyNativeProfile() {}
      protected override makeNativeClient(): Client {
        factories++;
        return fake as unknown as Client;
      }
    }
    const manager = new Manager({
      DB_HOST: "",
      DB_USER: settingsEnv.DB_USER!,
      DB_PASSWORD: "synthetic-only",
      DB_PORT: 3306,
      DB_NAME: settingsEnv.DB_NAME!,
      DB_MAX_RETRIES: 1,
      ELASTICACHE_ENDPOINT: "",
      DENO_ENV: "test",
      CACHE: "false",
    });
    await manager.initialize();
    const call = manager.executeQuery("SELECT 'synthetic-feed'", []).then(
      () => false,
      () => true,
    );
    assert(await call);
    assert(factories === 1 && closed === 0 && executed === 1);
    assert(manager.getConnectionStats().activeConnections === 1);
    let drained = false;
    const cleanup = manager.closeAllClients().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert(!drained);
    probe.resolve([{ native_reader_probe: 1 }]);
    await cleanup;
    assert(closed === 1 && factories === 1 && executed === 1);
    assert(manager.getConnectionStats().activeConnections === 0);
  } finally {
    Deno.args.pop();
    keys.forEach((key, index) =>
      previous[index] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, previous[index]!)
    );
  }
});

Deno.test("actualDatabaseManager fresh acquisition is tracked before late probe and starts no UTC after timeout", async () => {
  const keys = [...Object.keys(settingsEnv), "DENO_ENV", "DB_HOST", "DB_PORT"];
  const previous = keys.map((key) => Deno.env.get(key));
  Object.entries(settingsEnv).forEach(([key, value]) =>
    Deno.env.set(key, value)
  );
  Deno.env.set("DENO_ENV", "test");
  Deno.env.delete("DB_HOST");
  Deno.env.delete("DB_PORT");
  Deno.args.push("build");
  try {
    const { DatabaseManager } = await import(
      "../../server/database/databaseManager.ts"
    );
    const probe = deferred<unknown[]>();
    let factories = 0, closed = 0, executed = 0;
    const fake = {
      async connect() {},
      async query() {
        return await probe.promise;
      },
      async execute() {
        executed++;
        return {};
      },
      close() {
        closed++;
      },
    };
    class Manager extends DatabaseManager {
      protected override async verifyNativeProfile() {}
      protected override makeNativeClient(): Client {
        factories++;
        return fake as unknown as Client;
      }
    }
    const manager = new Manager({
      DB_HOST: "",
      DB_USER: settingsEnv.DB_USER!,
      DB_PASSWORD: "synthetic-only",
      DB_PORT: 3306,
      DB_NAME: settingsEnv.DB_NAME!,
      DB_MAX_RETRIES: 1,
      ELASTICACHE_ENDPOINT: "",
      DENO_ENV: "test",
      CACHE: "false",
    });
    await refused(() => manager.initialize());
    assert(factories === 1 && closed === 0 && executed === 0);
    let drained = false;
    const cleanup = manager.closeAllClients().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert(!drained);
    probe.resolve([{ native_reader_probe: 1 }]);
    await cleanup;
    assert(closed === 1 && factories === 1 && executed === 0);
    assert(manager.getConnectionStats().activeConnections === 0);
  } finally {
    Deno.args.pop();
    keys.forEach((key, index) =>
      previous[index] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, previous[index]!)
    );
  }
});

Deno.test("production native profile enforces2 instead of75 and cannot enable retries/compression", () => {
  const keys = [
    "DENO_ENV",
    "DB_READER_PROFILE",
    "DB_MAX_CONNECTIONS",
    "DB_ENABLE_COMPRESSION",
  ];
  const previous = keys.map((key) => Deno.env.get(key));
  try {
    Deno.env.set("DENO_ENV", "production");
    Deno.env.set("DB_READER_PROFILE", "owned-unix-readonly");
    Deno.env.set("DB_MAX_CONNECTIONS", "75");
    Deno.env.set("DB_ENABLE_COMPRESSION", "true");
    const native = getDatabaseConfig();
    assert(
      native.maxConnections === 2 && native.minConnections === 0 &&
        native.maxWaitingForConnection === 2,
    );
    assert(
      native.connectionTimeout === 4000 && native.acquireTimeout === 4000 &&
        native.maxRetries === 1,
    );
    assert(!native.enableCompression && !native.enableConnectionLogging);
    Deno.env.delete("DB_READER_PROFILE");
    assert(getDatabaseConfig().maxConnections === 75);
  } finally {
    keys.forEach((key, index) =>
      previous[index] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, previous[index]!)
    );
  }
});

Deno.test("source/principal/schema/socket mismatches refuse even with a claimed proof", async () => {
  const settings = nativeReaderSettings((key) => settingsEnv[key])!;
  const proof = {
    schemaVersion: "universe-stamps-mysql-reader-proof-v1",
    network: "mainnet",
    genesisHash:
      "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
    source: {
      containerId: "a".repeat(64),
      imageId: "sha256:" + "b".repeat(64),
      pid: 123,
      startTicks: "1234",
      mountNamespace: "mnt:[1234]",
      listenerSocketInode: "12345",
    },
    principal: {
      user: settings.user,
      host: "localhost",
      plugin: "caching_sha2_password",
      schema: settings.schema,
      selectOnlyVerified: true,
      maxUserConnections: 2,
    },
    socket: {
      aliasPath: settings.socketPath,
      deviceAtomic: "48",
      inodeAtomic: "12345",
      uid: 999,
      singleReadOnlyBindVerified: true,
    },
  };
  const socket = {
    isSocket: true,
    isSymlink: false,
    dev: 48,
    ino: 12345,
    uid: 999,
  };
  assert(
    validateNativeReaderProof(proof, settings, socket).principal.user ===
      settings.user,
  );
  for (
    const changed of [
      {
        ...proof,
        principal: { ...proof.principal, selectOnlyVerified: false },
      },
      { ...proof, principal: { ...proof.principal, schema: "wrong" } },
      { ...proof, principal: { ...proof.principal, user: "wrong" } },
      { ...proof, principal: { ...proof.principal, host: "%" } },
      { ...proof, principal: { ...proof.principal, plugin: "wrong" } },
      { ...proof, principal: { ...proof.principal, maxUserConnections: 0 } },
      { ...proof, socket: { ...proof.socket, inodeAtomic: "12346" } },
      {
        ...proof,
        socket: { ...proof.socket, singleReadOnlyBindVerified: false },
      },
      { ...proof, source: { ...proof.source, pid: 0 } },
    ]
  ) await refused(() => validateNativeReaderProof(changed, settings, socket));
  await refused(() =>
    validateNativeReaderProof(proof, settings, { ...socket, isSymlink: true })
  );
  await refused(() =>
    validateNativeReaderProof(proof, settings, { ...socket, uid: Deno.uid() })
  );
});

Deno.test("lazy connect cannot qualify readiness: actualSELECT and sessionUTC must complete", async () => {
  const settings = nativeReaderSettings((key) => settingsEnv[key])!;
  const calls: string[] = [];
  const client = {
    async connect(options: { socketPath: string }) {
      assert(options.socketPath === settings.socketPath);
      calls.push("connect");
    },
    async query(sql: string) {
      assert(sql === "SELECT 1 AS native_reader_probe");
      calls.push("query");
      return [{ native_reader_probe: 1 }];
    },
    async execute(sql: string, params: unknown[]) {
      assert(sql === "SET time_zone = '+00:00'" && params.length === 0);
      calls.push("sessionUTC");
    },
  };
  await prepareNativeReaderConnection(client, settings, "synthetic-only");
  assert(calls.join() === "connect,query,sessionUTC");
  await refused(() =>
    prepareNativeReaderConnection(
      {
        ...client,
        query: async () => {
          throw new Error("synthetic real query failure after lazy connect");
        },
      },
      settings,
      "synthetic-only",
    )
  );
  for (
    const rows of [null, {}, [], [null], [{ native_reader_probe: "1" }], [{
      native_reader_probe: 0,
    }], [{ native_reader_probe: 1 }, { native_reader_probe: 1 }]]
  ) {
    await refused(() => requireNativeProbeReply(rows));
  }
});

Deno.test("caller4s expires but two actual drivers retain both slots; third never starts", async () => {
  const work = new NativeReaderWork();
  const first = deferred<number>();
  const second = deferred<number>();
  let thirdStarted = false;
  const a = work.run(() => first.promise, 4000).then(() => false, () => true);
  const b = work.run(() => second.promise, 4000).then(() => false, () => true);
  const c = work.run(async () => {
    thirdStarted = true;
    return 3;
  }, 4000).then(() => false, () => true);
  assert(work.active === 2 && work.queued === 1);
  assert(await a && await b && await c);
  assert(work.active === 2 && !thirdStarted && work.queued === 0);
  first.resolve(1);
  second.resolve(2);
  await work.drain();
  assert(work.active === 0);
});

Deno.test("nested late driver and malformed/rejected work cannot promote readiness", async () => {
  const work = new NativeReaderWork();
  const driver = deferred<number>();
  const caller = work.run(
    async () => await work.run(() => driver.promise, 4000),
    4000,
  ).then(() => false, () => true);
  assert(await caller);
  assert(work.active === 1);
  driver.reject(new Error("synthetic driver failure"));
  await work.drain();
  assert(work.active === 0);
  await refused(() =>
    work.run(async () => {
      throw new Error("malformed SELECT1 reply");
    }, 4000)
  );
  assert(work.active === 0);
});

Deno.test("closed admission refuses new acquisition and waits actual10s feed work", async () => {
  const work = new NativeReaderWork();
  const driver = deferred<number>();
  const actual = work.run(() => driver.promise, 10000);
  work.stopAdmission();
  await refused(() => work.run(async () => 2, 4000));
  let drained = false;
  const drain = work.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert(!drained && work.active === 1);
  driver.resolve(1);
  assert(await actual === 1);
  await drain;
  assert(drained && work.active === 0);
});

for (const pooled of [true, false]) {
  Deno.test(`actualDatabaseManager ${pooled ? "pooled" : "fresh"} late microtask closes before timer callback`, async () => {
    const keys = [
      ...Object.keys(settingsEnv),
      "DENO_ENV",
      "DB_HOST",
      "DB_PORT",
    ];
    const previous = keys.map((key) => Deno.env.get(key));
    Object.entries(settingsEnv).forEach(([key, value]) =>
      Deno.env.set(key, value)
    );
    Deno.env.set("DENO_ENV", "test");
    Deno.env.delete("DB_HOST");
    Deno.env.delete("DB_PORT");
    Deno.args.push("build");
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    const held = deferred<unknown>();
    try {
      const { DatabaseManager } = await import(
        "../../server/database/databaseManager.ts"
      );
      const entered = deferred<void>();
      let factories = 0, closed = 0, queryCount = 0;
      const fake = {
        async connect() {},
        async query() {
          queryCount++;
          if (pooled && queryCount === 2) {
            entered.resolve();
            return await held.promise;
          }
          return [{ native_reader_probe: 1 }];
        },
        async execute() {
          if (!pooled) {
            entered.resolve();
            return await held.promise;
          }
          return {};
        },
        close() {
          closed++;
        },
      };
      class Manager extends DatabaseManager {
        protected override async verifyNativeProfile() {}
        protected override makeNativeClient(): Client {
          factories++;
          return fake as unknown as Client;
        }
      }
      const manager = new Manager({
        DB_HOST: "",
        DB_USER: settingsEnv.DB_USER!,
        DB_PASSWORD: "synthetic-only",
        DB_PORT: 3306,
        DB_NAME: settingsEnv.DB_NAME!,
        DB_MAX_RETRIES: 1,
        ELASTICACHE_ENDPOINT: "",
        DENO_ENV: "test",
        CACHE: "false",
      });
      if (pooled) await manager.initialize();
      const pending = (pooled
        ? manager.executeQuery("SELECT 'synthetic-feed'", [])
        : manager.initialize()).then(() =>
          false, () => true);
      await entered.promise;
      // No real timer fires: advance the wall-clock and settle the driver in a microtask.
      now += 5000;
      held.resolve(pooled ? [{ native_reader_probe: 1 }] : {});
      assert(await pending);
      await manager.closeAllClients();
      assert(
        closed === 1 && factories === 1 &&
          manager.getConnectionStats().activeConnections === 0,
      );
    } finally {
      held.resolve({});
      Date.now = realNow;
      Deno.args.pop();
      keys.forEach((key, index) =>
        previous[index] === undefined
          ? Deno.env.delete(key)
          : Deno.env.set(key, previous[index]!)
      );
    }
  });
}

Deno.test("actualDatabaseManager tracked unreleased leases block a third factory", async () => {
  const keys = [...Object.keys(settingsEnv), "DENO_ENV", "DB_HOST", "DB_PORT"];
  const previous = keys.map((key) => Deno.env.get(key));
  Object.entries(settingsEnv).forEach(([key, value]) =>
    Deno.env.set(key, value)
  );
  Deno.env.set("DENO_ENV", "test");
  Deno.env.delete("DB_HOST");
  Deno.env.delete("DB_PORT");
  Deno.args.push("build");
  try {
    const { DatabaseManager } = await import(
      "../../server/database/databaseManager.ts"
    );
    const clients: Client[] = [];
    class Manager extends DatabaseManager {
      protected override async verifyNativeProfile() {}
      protected override makeNativeClient(): Client {
        const fake = {
          async connect() {},
          async query() {
            return [{ native_reader_probe: 1 }];
          },
          async execute() {
            return {};
          },
          close() {},
        } as unknown as Client;
        clients.push(fake);
        return fake;
      }
      override releaseClient(_client: Client) {
        /* Simulate two forgotten, tracked leases. */
      }
    }
    const manager = new Manager({
      DB_HOST: "",
      DB_USER: settingsEnv.DB_USER!,
      DB_PASSWORD: "synthetic-only",
      DB_PORT: 3306,
      DB_NAME: settingsEnv.DB_NAME!,
      DB_MAX_RETRIES: 1,
      ELASTICACHE_ENDPOINT: "",
      DENO_ENV: "test",
      CACHE: "false",
    });
    await manager.initialize();
    await manager.initialize();
    await refused(() => manager.initialize());
    assert(
      clients.length === 2 &&
        manager.getConnectionStats().activeConnections === 2,
    );
    for (const client of clients) await manager.closeClient(client);
    await manager.closeAllClients();
    assert(manager.getConnectionStats().activeConnections === 0);
  } finally {
    Deno.args.pop();
    keys.forEach((key, index) =>
      previous[index] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, previous[index]!)
    );
  }
});
