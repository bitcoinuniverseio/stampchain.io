export const NATIVE_READER_PROFILE = "owned-unix-readonly";
export const NATIVE_READER_DIRECTORY = "/run/universe-stampchain-reader";

export interface NativeReaderSettings {
  socketPath: string;
  proofPath: string;
  user: string;
  schema: string;
}

export function requireNativeProbeReply(rows: unknown): void {
  if (
    !Array.isArray(rows) || rows.length !== 1 ||
    rows[0] === null || typeof rows[0] !== "object" ||
    rows[0].native_reader_probe !== 1
  ) {
    throw new Error("Native reader connection probe malformed");
  }
}

export async function prepareNativeReaderConnection(
  client: {
    connect(
      options: {
        socketPath: string;
        username: string;
        password: string;
        db: string;
        timeout: number;
        idleTimeout: number;
        poolSize: number;
      },
    ): Promise<unknown>;
    query(sql: string): Promise<unknown>;
    execute(sql: string, params: unknown[]): Promise<unknown>;
  },
  settings: NativeReaderSettings,
  password: string,
  ensureAdmitted: () => void = () => {},
): Promise<void> {
  await client.connect({
    socketPath: settings.socketPath,
    username: settings.user,
    password,
    db: settings.schema,
    timeout: 4000,
    idleTimeout: 0,
    poolSize: 1,
  });
  ensureAdmitted();
  requireNativeProbeReply(
    await client.query("SELECT 1 AS native_reader_probe"),
  );
  ensureAdmitted();
  await client.execute("SET time_zone = '+00:00'", []);
  ensureAdmitted();
}

export interface NativeReaderProof {
  schemaVersion: "universe-stamps-mysql-reader-proof-v1";
  network: "mainnet";
  genesisHash: string;
  source: {
    containerId: string;
    imageId: string;
    pid: number;
    startTicks: string;
    mountNamespace: string;
    listenerSocketInode: string;
  };
  principal: {
    user: string;
    host: "localhost";
    plugin: "caching_sha2_password";
    schema: string;
    selectOnlyVerified: true;
    maxUserConnections: 2;
  };
  socket: {
    aliasPath: string;
    deviceAtomic: string;
    inodeAtomic: string;
    uid: number;
    singleReadOnlyBindVerified: true;
  };
}

export function nativeReaderRequested(get = Deno.env.get): boolean {
  const profile = get("DB_READER_PROFILE");
  if (profile !== undefined && profile !== NATIVE_READER_PROFILE) {
    throw new Error("Unknown native database reader profile");
  }
  return profile === NATIVE_READER_PROFILE;
}

export function nativeReaderSettings(
  get = Deno.env.get,
): NativeReaderSettings | null {
  if (!nativeReaderRequested(get)) return null;
  const socketPath = get("DB_SOCKET_PATH");
  const proofPath = get("DB_NATIVE_READER_PROOF_PATH");
  const user = get("DB_USER");
  const schema = get("DB_NAME");
  if (
    socketPath !== `${NATIVE_READER_DIRECTORY}/mysql.sock` ||
    proofPath !== `${NATIVE_READER_DIRECTORY}/proof.json` ||
    !user || user.toLowerCase() === "root" || !schema ||
    get("DB_HOST") !== undefined || get("DB_PORT") !== undefined ||
    get("DB_ENABLE_TLS") === "true" || get("DB_NATIVE_TCP_FALLBACK") === "true"
  ) {
    throw new Error(
      "Native reader requires its fixed socket and principal proof",
    );
  }
  return { socketPath, proofPath, user, schema };
}

export function validateNativeReaderProof(
  value: unknown,
  settings: NativeReaderSettings,
  socket: Pick<Deno.FileInfo, "isSocket" | "isSymlink" | "dev" | "ino" | "uid">,
): NativeReaderProof {
  const proof = value as NativeReaderProof | null;
  if (
    !proof || proof.schemaVersion !== "universe-stamps-mysql-reader-proof-v1" ||
    proof.network !== "mainnet" ||
    proof.genesisHash !==
      "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f" ||
    !proof.principal || proof.principal.user !== settings.user ||
    proof.principal.host !== "localhost" ||
    proof.principal.plugin !== "caching_sha2_password" ||
    proof.principal.schema !== settings.schema ||
    proof.principal.selectOnlyVerified !== true ||
    proof.principal.maxUserConnections !== 2 ||
    !proof.source || !/^[0-9a-f]{64}$/.test(proof.source.containerId) ||
    !/^sha256:[0-9a-f]{64}$/.test(proof.source.imageId) ||
    !Number.isSafeInteger(proof.source.pid) || proof.source.pid <= 0 ||
    !/^[1-9][0-9]*$/.test(proof.source.startTicks) ||
    !/^mnt:\[[0-9]+\]$/.test(proof.source.mountNamespace) ||
    !/^[1-9][0-9]*$/.test(proof.source.listenerSocketInode) ||
    !proof.socket || proof.socket.singleReadOnlyBindVerified !== true ||
    proof.socket.aliasPath !== settings.socketPath || socket.isSymlink ||
    !socket.isSocket ||
    !Number.isSafeInteger(socket.dev) || !Number.isSafeInteger(socket.ino) ||
    !Number.isSafeInteger(socket.uid) || socket.uid === null ||
    socket.uid < 0 ||
    String(socket.dev) !== proof.socket.deviceAtomic ||
    String(socket.ino) !== proof.socket.inodeAtomic ||
    socket.uid !== proof.socket.uid || socket.uid === Deno.uid()
  ) {
    throw new Error("Native reader source, socket or principal proof refused");
  }
  return proof;
}

/** Host PID/listener fences remain mandatory; this is the application-side check. */
export async function verifyNativeReaderProfile(
  settings: NativeReaderSettings,
): Promise<NativeReaderProof> {
  const directory = await Deno.lstat(NATIVE_READER_DIRECTORY);
  if (
    !directory.isDirectory || directory.isSymlink || directory.uid !== 0 ||
    directory.mode === null || (directory.mode & 0o022) !== 0
  ) {
    throw new Error("Native reader socket directory authority refused");
  }
  const before = await Deno.lstat(settings.proofPath);
  if (
    !before.isFile || before.isSymlink || before.uid !== 0 ||
    before.nlink !== 1 ||
    before.mode === null || (before.mode & 0o222) !== 0 || before.size > 16384
  ) {
    throw new Error("Native reader immutable proof file refused");
  }
  const file = await Deno.open(settings.proofPath, { read: true });
  let raw: Uint8Array;
  try {
    const opened = await file.stat();
    if (!sameNativeProofIdentity(opened, before)) {
      throw new Error("Native reader proof identity changed");
    }
    raw = new Uint8Array(before.size);
    let offset = 0;
    while (offset < raw.length) {
      const count = await file.read(raw.subarray(offset));
      if (count === null || count === 0) {
        throw new Error("Native reader proof truncated");
      }
      offset += count;
    }
  } finally {
    file.close();
  }
  const after = await Deno.lstat(settings.proofPath);
  if (!sameNativeProofIdentity(after, before)) {
    throw new Error("Native reader proof identity changed");
  }
  return validateNativeReaderProof(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
    settings,
    await Deno.lstat(settings.socketPath),
  );
}

export function sameNativeProofIdentity(
  a: Deno.FileInfo,
  b: Deno.FileInfo,
): boolean {
  return a.isFile && !a.isSymlink && a.ino === b.ino && a.dev === b.dev &&
    a.size === b.size && a.uid === b.uid && a.gid === b.gid &&
    a.mode === b.mode &&
    a.nlink === b.nlink && a.mtime?.getTime() === b.mtime?.getTime() &&
    a.ctime?.getTime() === b.ctime?.getTime();
}
