import type { NativeReaderProof } from "./nativeReaderProfile.ts";

const DIRECTORY = "/run/universe-stampchain-reader";
const CONTROL = `${DIRECTORY}/admission.sock`;
const ENDED = `${DIRECTORY}/native-ended.json`;

export interface NativeReaderLease {
  id: string;
  expiresAtUtc: string;
  factoryPid: number;
  factoryStartTicks: string;
  factoryMountNamespace: string;
  controlSocketPath: typeof CONTROL;
  controlDeviceAtomic: string;
  controlInodeAtomic: string;
}

export function requireNativeReaderLease(
  proof: NativeReaderProof,
  now = Date.now(),
): NativeReaderLease {
  const lease = proof.lease;
  if (
    !lease || !/^[0-9a-f]{64}$/.test(lease.id) ||
    !Number.isSafeInteger(lease.factoryPid) || lease.factoryPid <= 0 ||
    !/^[1-9][0-9]*$/.test(lease.factoryStartTicks) ||
    !/^mnt:\[[0-9]+\]$/.test(lease.factoryMountNamespace) ||
    lease.controlSocketPath !== CONTROL ||
    !/^[1-9][0-9]*$/.test(lease.controlDeviceAtomic) ||
    !/^[1-9][0-9]*$/.test(lease.controlInodeAtomic) ||
    !Number.isFinite(Date.parse(lease.expiresAtUtc)) ||
    Date.parse(lease.expiresAtUtc) <= now
  ) {
    throw new Error("Native reader managed lease is absent or expired");
  }
  return lease;
}

export function validateLeaseReply(
  value: unknown,
  lease: NativeReaderLease,
  nonce: string,
  proof: NativeReaderProof,
  now = Date.now(),
): void {
  const reply = value as Record<string, unknown> | null;
  if (
    !reply || reply.admitted !== true || reply.nonce !== nonce ||
    reply.leaseId !== lease.id || reply.factoryPid !== lease.factoryPid ||
    reply.factoryStartTicks !== lease.factoryStartTicks ||
    reply.nativePid !== proof.source.pid ||
    reply.nativeStartTicks !== proof.source.startTicks ||
    reply.listenerSocketInode !== proof.source.listenerSocketInode ||
    reply.expiresAtUtc !== lease.expiresAtUtc ||
    Date.parse(lease.expiresAtUtc) <= now
  ) {
    throw new Error("Native reader current source admission refused");
  }
}

export function watchNativeReaderLease(
  proof: NativeReaderProof,
  onRevoked: () => void,
): () => void {
  requireNativeReaderLease(proof);
  let stopped = false;
  let checking = false;
  const timer = setInterval(async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      requireNativeReaderLease(proof);
      try {
        await Deno.lstat(ENDED);
        throw new Error("Native reader lease revoked");
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    } catch {
      if (!stopped) onRevoked();
    } finally {
      checking = false;
    }
  }, 250);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Bounds the whole disposable metadata phase, including a pending connect. */
export async function boundedMetadataConnection<T>(
  connect: () => Promise<Deno.Conn>,
  operation: (connection: Deno.Conn, assertCurrent: () => void) => Promise<T>,
  budgetMs: number,
): Promise<T> {
  const deadline = Date.now() + Math.max(0, budgetMs);
  let expired = false;
  let connection: Deno.Conn | undefined;
  const close = () => {
    try {
      connection?.close();
    } catch { /* Metadata only. */ }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assertCurrent = () => {
    if (expired || Date.now() >= deadline) {
      throw new Error("Native reader metadata deadline expired");
    }
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      close();
      reject(new Error("Native reader metadata deadline expired"));
    }, Math.max(0, budgetMs));
  });
  const actual = (async () => {
    connection = await connect();
    try {
      assertCurrent();
      const value = await operation(connection, assertCurrent);
      assertCurrent();
      return value;
    } finally {
      close();
    }
  })();
  // A late connect is disposed by actual's finally and cannot admit SQL work.
  actual.catch(() => {});
  try {
    return await Promise.race([actual, timeout]);
  } finally {
    clearTimeout(timer);
    expired = true;
    close();
  }
}

/** Root owns the immutable parent and pinned socket; the factory holds pidfds. */
export async function admitNativeReaderLease(
  proof: NativeReaderProof,
  ensureAdmitted: () => void,
  remainingBudgetMs: () => number,
): Promise<void> {
  ensureAdmitted();
  const lease = requireNativeReaderLease(proof);
  try {
    await Deno.lstat(ENDED);
    throw new Error("Native reader lease was revoked");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const before = await Deno.lstat(CONTROL);
  if (
    !before.isSocket || before.isSymlink || before.uid !== 0 ||
    String(before.dev) !== lease.controlDeviceAtomic ||
    String(before.ino) !== lease.controlInodeAtomic
  ) {
    throw new Error("Native reader factory control socket refused");
  }
  const nonce = crypto.randomUUID();
  await boundedMetadataConnection(
    () => Deno.connect({ transport: "unix", path: CONTROL }),
    async (connection, assertCurrent) => {
      assertCurrent();
      ensureAdmitted();
      const request = new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: "universe-stamps-lease-admission-v1",
          leaseId: lease.id,
          nonce,
          operation: "readonly",
        }) + "\n",
      );
      let written = 0;
      while (written < request.length) {
        const count = await connection.write(request.subarray(written));
        if (count <= 0) throw new Error("Native reader admission write failed");
        written += count;
      }
      const bytes = new Uint8Array(4097);
      let length = 0;
      while (true) {
        const count = await connection.read(bytes.subarray(length));
        if (count === null || count === 0) {
          throw new Error("Native reader admission reply truncated");
        }
        length += count;
        if (length > 4096) {
          throw new Error("Native reader admission reply too large");
        }
        if (bytes[length - 1] === 10) break;
      }
      ensureAdmitted();
      const after = await Deno.lstat(CONTROL);
      if (
        after.dev !== before.dev || after.ino !== before.ino || after.uid !== 0
      ) {
        throw new Error("Native reader admission socket changed");
      }
      requireNativeReaderLease(proof);
      try {
        await Deno.lstat(ENDED);
        throw new Error("Native reader lease was revoked");
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      validateLeaseReply(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, length),
          ),
        ),
        lease,
        nonce,
        proof,
      );
      assertCurrent();
    },
    Math.min(remainingBudgetMs(), Date.parse(lease.expiresAtUtc) - Date.now()),
  );
}
