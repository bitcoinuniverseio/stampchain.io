/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />
/// <reference types="npm:@types/node" />

// Fix for EventTarget memory leak warning
// Suppress MaxListenersExceededWarning for AbortSignal to prevent memory leak warnings
// This is safe because we properly clean up listeners in our HTTP client
if (typeof process !== "undefined" && process.emitWarning) {
  const originalEmitWarning = process.emitWarning;
  // @ts-ignore - Complex overloaded function signature, but we handle it safely
  process.emitWarning = function (
    warning: string | Error,
    type?: string,
    code?: string,
    ctor?: Function,
  ) {
    // Suppress MaxListenersExceededWarning for AbortSignal
    if (
      type === "MaxListenersExceededWarning" &&
      typeof warning === "string" &&
      warning.includes("AbortSignal")
    ) {
      return;
    }
    // @ts-ignore - Complex overloaded function signature, but we handle it safely
    return originalEmitWarning.call(this, warning, type, code, ctor);
  };
}

import config from "$/fresh.config.ts";
import manifest from "$/fresh.gen.ts";
import "$/globals.d.ts";
import build from "$fresh/dev.ts";
import { createHandler } from "$fresh/server.ts";
import { serverConfig } from "$server/config/config.ts";
import { ApplicationLifecycle } from "$server/lifecycle/applicationLifecycle.ts";
import { applicationWork } from "$server/lifecycle/workDrain.ts";
import {
  nativeReaderRequested,
  nativeReaderSettings,
  verifyNativeReaderProfile,
} from "$server/database/nativeReaderProfile.ts";
import { watchNativeReaderLease } from "$server/database/nativeReaderLease.ts";
const DENO_ROLE = serverConfig.DENO_ROLE;
const lifecycle = new ApplicationLifecycle();
let held = false;
let signalsRegistered = false;
const requestShutdown = () => {
  lifecycle.shutdown().then(() => {
    if (signalsRegistered) {
      Deno.removeSignalListener("SIGINT", requestShutdown);
      if (Deno.build.os !== "windows") {
        Deno.removeSignalListener("SIGTERM", requestShutdown);
      }
      signalsRegistered = false;
    }
  }).catch((error) => {
    console.error("[SHUTDOWN HOLD] Resource drain failed", error);
    // Uncertain resource closure retains one explicit process reference.
    if (!held) {
      held = true;
      setInterval(() => {}, 60_000);
    }
  });
};
if (import.meta.main && !Deno.args.includes("build")) {
  Deno.addSignalListener("SIGINT", requestShutdown);
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", requestShutdown);
  }
  signalsRegistered = true;
}
// Lazy import DB and background services only when not running in pure web mode
let dbManager:
  | typeof import("$server/database/databaseManager.ts").dbManager
  | undefined;
let BackgroundFeeService:
  | typeof import("$server/services/fee/backgroundFeeService.ts").BackgroundFeeService
  | undefined;
if (DENO_ROLE !== "web") {
  await applicationWork.run(async () => {
    const dbModule = await import("$server/database/databaseManager.ts");
    dbManager = dbModule.dbManager;
    lifecycle.ownProducer(() => dbManager!.stopProducers());
    lifecycle.ownResource(() => dbManager!.closeAllClients());
    await import("$server/database/index.ts");
    const feeModule = await import(
      "$server/services/fee/backgroundFeeService.ts"
    );
    BackgroundFeeService = feeModule.BackgroundFeeService;
    lifecycle.ownProducer(() => BackgroundFeeService!.stop());
  });
}

if (import.meta.main && !lifecycle.stopping) {
  if (!Deno.args.includes("build")) {
    // Resolve the network profile and, off Mainnet, prove Bitcoin Core and
    // Counterparty serve the configured chain before serving anything.
    try {
      const { getNetworkProfile, verifyNetworkIdentity } = await import(
        "$server/config/networkProfile.ts"
      );
      const profile = getNetworkProfile();
      await applicationWork.run(() => verifyNetworkIdentity(profile));
      console.log(`[MAIN] Network profile: ${profile.name}`);
    } catch (e) {
      console.error(
        `[MAIN ERROR] Network profile check failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      if (!lifecycle.stopping) Deno.exit(1);
    }
  }
  if (!Deno.args.includes("build") && DENO_ROLE !== "web") {
    try {
      console.log(`[MAIN] Attempting dbManager.initialize() at ${Date.now()}`);
      await applicationWork.run(() => dbManager!.initialize());
      console.log(`[MAIN] dbManager.initialize() completed at ${Date.now()}`);
      if (nativeReaderRequested() && !lifecycle.stopping) {
        const proof = await applicationWork.run(() =>
          verifyNativeReaderProfile(nativeReaderSettings()!)
        );
        const stop = watchNativeReaderLease(proof, requestShutdown);
        lifecycle.ownProducer(stop);
      }

      // Start background fee cache warming service
      if (!lifecycle.stopping) BackgroundFeeService!.start();
      console.log(
        `[MAIN] Background fee service started`,
      );
    } catch (e) {
      if (e instanceof Error) {
        console.error(
          `[MAIN ERROR] Error during dbManager.initialize(): ${e.message}`,
          e.stack,
        );
      } else {
        console.error(
          `[MAIN ERROR] Error during dbManager.initialize(): Unknown error object`,
          e,
        );
      }
      if (nativeReaderRequested() && !lifecycle.stopping) throw e;
    }
  }

  if (Deno.args.includes("build")) {
    console.log(`[MAIN] Entering build block at ${Date.now()}`);
    await build(import.meta.url, "./main.ts", config);
    console.log(`[MAIN] Exiting build block at ${Date.now()}`);
    Deno.exit(0);
  } else {
    console.log(`[MAIN] Entering runtime block at ${Date.now()}`);
    if (!serverConfig.IS_DEVELOPMENT) {}
    // HOSTNAME restricts the listener (e.g. 127.0.0.1); unset keeps Fresh's default.
    const hostname = Deno.env.get("HOSTNAME");
    const handler = lifecycle.stopping
      ? undefined
      : await applicationWork.run(() => createHandler(manifest, config));
    if (!lifecycle.stopping && handler) {
      const server = Deno.serve({
        ...(config.server ?? config),
        ...(hostname ? { hostname } : {}),
      }, (request, info) => {
        if (!applicationWork.accepting) {
          return new Response("Application is draining", { status: 503 });
        }
        return applicationWork.run(() => handler(request, info));
      });
      lifecycle.ownServer(server);
      await server.finished;
    }
    console.log(`[MAIN] Server started at ${Date.now()}`);
  }
}
