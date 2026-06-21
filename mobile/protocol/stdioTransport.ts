// stdioTransport.ts — Node-only Transport for dev/tests.
//
// Spawns the headless engine binary, writes one JSON command per line to its
// stdin, and parses newline-delimited JSON event lines from its stdout.
//
// IMPORTANT: this file imports `node:child_process` and must be kept OUT of the
// React Native / Expo bundle. It is only used by tools/smoke.ts and other
// Node-side tooling.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Command, Event, Transport } from "./protocol.ts";

export interface StdioTransportOptions {
  /** Absolute path to the headless engine binary. */
  binaryPath: string;
  /** Optional extra args for the binary. */
  args?: string[];
}

export class StdioTransport implements Transport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly handlers = new Set<(e: Event) => void>();
  private buffer = "";
  private closed = false;

  constructor(options: StdioTransportOptions) {
    this.child = spawn(options.binaryPath, options.args ?? [], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));

    this.child.on("error", (err) => {
      // Surface spawn failures (e.g. binary not built) as an error event.
      this.dispatch({
        event: "error",
        message: `engine process error: ${err.message}`,
      });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      let parsed: Event;
      try {
        parsed = JSON.parse(line) as Event;
      } catch {
        this.dispatch({
          event: "error",
          message: `failed to parse engine line: ${line}`,
        });
        continue;
      }
      this.dispatch(parsed);
    }
  }

  private dispatch(e: Event): void {
    for (const handler of this.handlers) {
      handler(e);
    }
  }

  send(command: Command): void {
    if (this.closed) {
      throw new Error("StdioTransport is closed");
    }
    this.child.stdin.write(JSON.stringify(command) + "\n");
  }

  onEvent(handler: (e: Event) => void): void {
    this.handlers.add(handler);
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    return new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      // The engine exits on its own after `quit`/`bye`; close stdin to be safe.
      try {
        this.child.stdin.end();
      } catch {
        // ignore
      }
      // Fallback in case the process is already gone.
      if (this.child.exitCode !== null) resolve();
    });
  }
}
