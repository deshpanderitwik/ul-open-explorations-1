// nativeTransport.ts — on-device Transport stub.
//
// =====================================================================
//  THIS IS WHERE THE RUST ENGINE BINDS TO THE APP ON DEVICE.
// =====================================================================
//
// The headless DAW engine compiles to a native library that runs in-process on
// the phone (no subprocess, no socket). It will be exposed to JS through an Expo
// native module with a single synchronous entry point:
//
//     handle(jsonLine: string): string[]
//
// i.e. you pass it one NDJSON command line and it returns zero-or-more NDJSON
// event lines — exactly the same byte shapes as the stdio transport, just
// crossing the JS<->Rust boundary instead of a pipe.
//
// Two viable bindings, both producing that `handle` function:
//   1. Expo Modules API  — a Swift/Kotlin module wrapping the Rust staticlib,
//      registered as `EngineModule` and reachable via expo-modules-core's
//      `requireNativeModule("Engine")`.
//   2. UniFFI            — generate Swift/Kotlin bindings straight from the Rust
//      crate's UDL, then a thin Expo module forwards `handle` to them.
//
// Until that module is built and linked (it requires a custom dev client via an
// EAS build — it cannot run in stock Expo Go), this stub either (a) routes to an
// optional in-memory mock for UI development in the simulator, or (b) throws a
// clear, actionable error.

import type { Command, Event, Transport } from "./protocol.ts";

/**
 * The native module contract. The real implementation is provided by the linked
 * Expo/UniFFI module; here it is optional so the JS bundle builds without it.
 */
export interface NativeEngineModule {
  /** Feed one command line, get back zero or more event lines. */
  handle(jsonLine: string): string[];
}

/**
 * Pluggable mock for simulator/UI development before the Rust module is linked.
 * Implement the same `handle` contract to drive the UI without native code.
 */
export type EngineMock = NativeEngineModule;

export interface NativeTransportOptions {
  /**
   * If provided, commands are routed to this mock instead of the native module.
   * Use for UI work in Expo Go / before an EAS build exists.
   */
  mock?: EngineMock;
}

/**
 * Attempt to load the linked native module. Kept as a function (not a top-level
 * import) so the bundle does not hard-fail when the module is absent.
 */
function tryLoadNativeModule(): NativeEngineModule | null {
  try {
    // Lazily required so bundlers don't choke when the module isn't installed.
    // Replace "Engine" with the real native module name once it is registered.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require("expo-modules-core") as {
      requireNativeModule: (name: string) => NativeEngineModule;
    };
    return requireNativeModule("Engine");
  } catch {
    return null;
  }
}

export class NativeTransport implements Transport {
  private readonly engine: NativeEngineModule;
  private readonly handlers = new Set<(e: Event) => void>();
  private closed = false;

  constructor(options: NativeTransportOptions = {}) {
    const engine = options.mock ?? tryLoadNativeModule();
    if (!engine) {
      throw new Error(
        "native engine module not yet linked — run an EAS build (custom dev " +
          "client) so the Rust engine is bundled, or pass a `mock` to " +
          "NativeTransport for simulator/UI development.",
      );
    }
    this.engine = engine;
  }

  send(command: Command): void {
    if (this.closed) {
      throw new Error("NativeTransport is closed");
    }
    const line = JSON.stringify(command);
    const eventLines = this.engine.handle(line);
    for (const eventLine of eventLines) {
      const trimmed = eventLine.trim();
      if (trimmed.length === 0) continue;
      let parsed: Event;
      try {
        parsed = JSON.parse(trimmed) as Event;
      } catch {
        parsed = {
          event: "error",
          message: `failed to parse native engine line: ${trimmed}`,
        };
      }
      for (const handler of this.handlers) handler(parsed);
    }
  }

  onEvent(handler: (e: Event) => void): void {
    this.handlers.add(handler);
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
  }
}
