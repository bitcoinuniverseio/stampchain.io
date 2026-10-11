import { throws as assertThrows } from "node:assert";
import {
  boundedMetadataConnection,
  requireNativeReaderLease,
  validateLeaseReply,
} from "../../server/database/nativeReaderLease.ts";
import type { NativeReaderProof } from "../../server/database/nativeReaderProfile.ts";

function proof(): NativeReaderProof {
  return {
    schemaVersion: "universe-stamps-mysql-reader-proof-v1",
    network: "mainnet",
    genesisHash:
      "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
    source: {
      containerId: "a".repeat(64),
      imageId: `sha256:${"b".repeat(64)}`,
      pid: 123,
      startTicks: "456",
      mountNamespace: "mnt:[78]",
      listenerSocketInode: "90",
    },
    principal: {
      user: "purpose",
      host: "localhost",
      plugin: "caching_sha2_password",
      schema: "synthetic",
      selectOnlyVerified: true,
      maxUserConnections: 2,
    },
    socket: {
      aliasPath: "/run/universe-stampchain-reader/mysql.sock",
      deviceAtomic: "1",
      inodeAtomic: "2",
      uid: 999,
      singleReadOnlyBindVerified: true,
    },
    lease: {
      id: "c".repeat(64),
      expiresAtUtc: new Date(10_000).toISOString(),
      factoryPid: 234,
      factoryStartTicks: "567",
      factoryMountNamespace: "mnt:[89]",
      controlSocketPath: "/run/universe-stampchain-reader/admission.sock",
      controlDeviceAtomic: "3",
      controlInodeAtomic: "4",
    },
  };
}

Deno.test("managed lease rejects absent, expired and unprotected control paths", () => {
  const value = proof();
  requireNativeReaderLease(value, 9999);
  assertThrows(() => requireNativeReaderLease(value, 10_000));
  const { lease: _lease, ...withoutLease } = value;
  assertThrows(() => requireNativeReaderLease(withoutLease, 0));
  assertThrows(() =>
    requireNativeReaderLease({
      ...value,
      lease: { ...value.lease!, factoryPid: 0 },
    }, 0)
  );
});

Deno.test("current source reply refuses replay and changed producer identity", () => {
  const value = proof();
  const lease = requireNativeReaderLease(value, 0);
  const reply = {
    admitted: true,
    nonce: "synthetic-nonce",
    leaseId: lease.id,
    factoryPid: lease.factoryPid,
    factoryStartTicks: lease.factoryStartTicks,
    nativePid: value.source.pid,
    nativeStartTicks: value.source.startTicks,
    listenerSocketInode: value.source.listenerSocketInode,
    expiresAtUtc: lease.expiresAtUtc,
  };
  validateLeaseReply(reply, lease, "synthetic-nonce", value, 0);
  for (
    const wrong of [
      { ...reply, nonce: "old-nonce" },
      { ...reply, nativeStartTicks: "457" },
      { ...reply, factoryPid: 235 },
      { ...reply, admitted: false },
      { ...reply, expiresAtUtc: new Date(20_000).toISOString() },
    ]
  ) {
    assertThrows(() =>
      validateLeaseReply(wrong, lease, "synthetic-nonce", value, 0)
    );
  }
  assertThrows(() =>
    validateLeaseReply(reply, lease, "synthetic-nonce", value, 10_000)
  );
});

Deno.test("pending metadata connect expires and late connection cannot admit SQL", async () => {
  let release!: (value: Deno.Conn) => void;
  const pending = new Promise<Deno.Conn>((yes) => {
    release = yes;
  });
  let closed = 0;
  let admitted = 0;
  const result = boundedMetadataConnection(() => pending, () => {
    admitted++;
    return Promise.resolve();
  }, 10);
  const { rejects, equal } = await import("node:assert");
  await rejects(() => result, /metadata deadline/);
  release({
    close: () => {
      closed++;
    },
  } as Deno.Conn);
  await new Promise((yes) => setTimeout(yes, 0));
  equal(admitted, 0);
  equal(closed > 0, true);
});
Deno.test("metadata body deadline closes only disposable connection", async () => {
  const { rejects, equal } = await import("node:assert");
  let closed = false;
  let release!: () => void;
  const pending = new Promise<void>((yes) => {
    release = yes;
  });
  await rejects(() =>
    boundedMetadataConnection(
      () =>
        Promise.resolve({
          close: () => {
            closed = true;
          },
        } as Deno.Conn),
      async (_connection, assertCurrent) => {
        await pending;
        assertCurrent();
      },
      10,
    ), /metadata deadline/);
  equal(closed, true);
  release();
  await new Promise((yes) => setTimeout(yes, 0));
});

Deno.test("metadata final completion after deadline refuses even before timer runs", async () => {
  const { rejects, equal } = await import("node:assert");
  const oldNow = Date.now;
  let clock = oldNow();
  let closed = false;
  Date.now = () => clock;
  try {
    await rejects(() =>
      boundedMetadataConnection(
        () =>
          Promise.resolve({
            close: () => {
              closed = true;
            },
          } as Deno.Conn),
        () => {
          clock += 11;
          return Promise.resolve("late");
        },
        10,
      ), /metadata deadline/);
    equal(closed, true);
  } finally {
    Date.now = oldNow;
  }
});

Deno.test("production owned profile skips Redis while ordinary production remains enabled", async () => {
  const { equal } = await import("node:assert");
  for (
    const [profile, expected] of [["owned-unix-readonly", "true"], [
      "",
      "false",
    ]]
  ) {
    const code = `if(${
      JSON.stringify(profile)
    })Deno.env.set("DB_READER_PROFILE",${
      JSON.stringify(profile)
    });else Deno.env.delete("DB_READER_PROFILE");await import("./server/config/env.ts");console.log("SKIP_PROOF="+globalThis.SKIP_REDIS_CONNECTION);`;
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        "--frozen",
        "--lock=deno.lock",
        "--config=deno.json",
        "--no-check",
        code,
      ],
      cwd: Deno.cwd(),
      env: { DENO_ENV: "production", FORCE_REDIS_CONNECTION: "true" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    equal(result.code, 0);
    equal(
      new TextDecoder().decode(result.stdout).includes(
        "SKIP_PROOF=" + expected,
      ),
      true,
    );
  }
});
Deno.test("unknown requested production reader profile refuses before Redis eligibility", async () => {
  const { equal } = await import("node:assert");
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "--frozen",
      "--lock=deno.lock",
      "--config=deno.json",
      "--no-check",
      'Deno.env.set("DB_READER_PROFILE","invalid");await import("./server/config/env.ts");console.log("UNEXPECTED_ADMISSION");',
    ],
    cwd: Deno.cwd(),
    env: { DENO_ENV: "production" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  equal(result.code !== 0, true);
  equal(
    new TextDecoder().decode(result.stderr).includes(
      "Unknown native database reader profile",
    ),
    true,
  );
  equal(
    new TextDecoder().decode(result.stdout).includes("UNEXPECTED_ADMISSION"),
    false,
  );
});

Deno.test("owned production Redis wrapper never opens a network connection", async () => {
  const { equal } = await import("node:assert");
  const code =
    `Deno.env.set("DB_READER_PROFILE","owned-unix-readonly");await import("./server/config/env.ts");let calls=0;Deno.connect=()=>{calls++;throw Error("unexpected redis connect");};Deno.connectTls=()=>{calls++;throw Error("unexpected redis tls");};const redis=await import("./server/cache/redisClient.ts");await redis.getRedisConnection();console.log("NETWORK_CALLS="+calls);`;
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "--frozen",
      "--lock=deno.lock",
      "--config=deno.json",
      "--no-check",
      code,
    ],
    cwd: Deno.cwd(),
    env: { DENO_ENV: "production", FORCE_REDIS_CONNECTION: "true" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  equal(result.code, 0);
  equal(
    new TextDecoder().decode(result.stdout).includes("NETWORK_CALLS=0"),
    true,
  );
});
