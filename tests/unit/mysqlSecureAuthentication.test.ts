import { start } from "../../vendor/mysql-2.12.1/src/auth_plugin/caching_sha2_password.ts";
import type { ReceivePacket } from "../../vendor/mysql-2.12.1/src/packets/packet.ts";
import { encryptWithPublicKey } from "../../vendor/mysql-2.12.1/src/auth_plugin/crypt.ts";
import auth from "../../vendor/mysql-2.12.1/src/auth.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
    if (
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) {
      throw new Error("Authentication reply bytes differ");
    }
  } else if (actual !== expected) {
    throw new Error("Authentication reply state differs");
  }
}

async function assertRejects(
  operation: () => Promise<unknown>,
  errorType: typeof Error,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof errorType && error.message.includes(message)) return;
    throw new Error("Authentication refusal did not preserve its cause");
  }
  throw new Error("Authentication status unexpectedly accepted");
}

function statusPacket(flag: number): ReceivePacket {
  return {
    body: {
      skip() {
        return this;
      },
      readUint8() {
        return flag;
      },
    },
  } as unknown as ReceivePacket;
}

Deno.test("concurrent secure handshakes retain their own password state", async () => {
  const first = await start(new Uint8Array([1, 2]), "synthetic-first", true);
  const second = await start(new Uint8Array([3, 4]), "synthetic-second", true);
  const firstReply = await first.next!(statusPacket(4));
  const secondReply = await second.next!(statusPacket(4));
  assertEquals(firstReply.data, new TextEncoder().encode("synthetic-first\0"));
  assertEquals(
    secondReply.data,
    new TextEncoder().encode("synthetic-second\0"),
  );
});

Deno.test("secure full authentication preserves UTF-8 and the terminating NUL", async () => {
  const handler = await start(new Uint8Array([1]), "synthetic-Ï€", true);
  const reply = await handler.next!(statusPacket(4));
  assertEquals(reply.data, new TextEncoder().encode("synthetic-Ï€\0"));
  assertEquals(reply.done, false);
  assertEquals((await reply.next!(statusPacket(0))).done, true);
});

Deno.test("absent or false secure context never sends plaintext credentials", async () => {
  for (const secure of [undefined, false]) {
    const handler = await start(
      new Uint8Array([1]),
      "synthetic-never-plaintext",
      secure,
    );
    const reply = await handler.next!(statusPacket(4));
    assertEquals(reply.data, new Uint8Array([2]));
    assertEquals(reply.done, false);
  }
});

Deno.test("unrecognized authentication status fails closed", async () => {
  for (const flag of [0, 5, 99, 255]) {
    const handler = await start(new Uint8Array([1]), "synthetic", true);
    await assertRejects(
      () => handler.next!(statusPacket(flag)),
      Error,
      "Unsupported caching_sha2_password authentication status",
    );
  }
});

Deno.test("the existing fast-authentication continuation remains unchanged", async () => {
  const handler = await start(new Uint8Array([1]), "synthetic", true);
  const reply = await handler.next!(statusPacket(3));
  assertEquals(reply.quickRead, true);
  assertEquals(reply.data, undefined);
  assertEquals(reply.done, false);
});

Deno.test("owned crypto copies preserve exactly the supplied offset and length", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const pem = "-----BEGIN PUBLIC KEY-----\n" +
    btoa(String.fromCharCode(...spki)) + "\n-----END PUBLIC KEY-----";
  const padded = new Uint8Array([9, 1, 2, 3, 8]);
  const encrypted = await encryptWithPublicKey(pem, padded.subarray(1, 4));
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      pair.privateKey,
      encrypted,
    ),
  );
  assertEquals(plain, new Uint8Array([1, 2, 3]));
  assertEquals(padded, new Uint8Array([9, 1, 2, 3, 8]));
});

Deno.test("authentication hash bytes retain both original algorithms", async () => {
  const password = "synthetic-hash-view";
  const padded = new Uint8Array([
    99,
    ...Array.from({ length: 20 }, (_, i) => i),
    88,
  ]);
  const seed = padded.subarray(1, 21);
  const bytes = new TextEncoder().encode(password);
  const digest = async (algorithm: string, data: Uint8Array) =>
    new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(data)));
  const xor = (a: Uint8Array, b: Uint8Array) =>
    Uint8Array.from(a, (value, index) => value ^ b[index]);
  for (
    const [plugin, algorithm] of [
      ["mysql_native_password", "SHA-1"],
      ["caching_sha2_password", "SHA-256"],
    ]
  ) {
    const first = await digest(algorithm, bytes);
    const second = await digest(algorithm, first);
    const joined = plugin === "mysql_native_password"
      ? Uint8Array.from([...seed, ...second])
      : Uint8Array.from([...second, ...seed]);
    const third = await digest(algorithm, joined);
    assertEquals(auth(plugin, password, seed), xor(first, third));
  }
  assertEquals(padded[0], 99);
  assertEquals(padded[21], 88);
});
