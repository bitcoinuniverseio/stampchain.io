import { throws as assertThrows } from "node:assert";
import {
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
