// smoke.ts — end-to-end validation of the protocol client against the real
// headless engine. Run from the repo root:
//
//     node --experimental-strip-types mobile/tools/smoke.ts
//
// Prints "SMOKE PASS" on success; throws on any assertion failure.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { DawClient } from "../protocol/protocol.ts";
import { StdioTransport } from "../protocol/stdioTransport.ts";

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(`SMOKE FAIL: ${message}`);
  }
}

async function main(): Promise<void> {
  // Resolve the engine binary relative to this file: mobile/tools -> repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  const binaryPath = resolve(here, "../../engine/target/release/headless");
  assert(
    existsSync(binaryPath),
    `engine binary not found at ${binaryPath} (build it first)`,
  );

  const transport = new StdioTransport({ binaryPath });
  const client = new DawClient(transport);

  try {
    await client.load();
    await client.addVoice(220);
    await client.addVoice(330);
    await client.addVoice(440);
    await client.setTempo(128);
    await client.play();

    const m = await client.render(4);
    assert(m.voices === 3, `expected 3 voices, got ${m.voices}`);
    assert(m.peak > 0.05, `expected peak > 0.05, got ${m.peak}`);

    const s = await client.getState();
    assert(s.playing === true, `expected playing=true, got ${s.playing}`);
    assert(
      s.position_samples === 1024,
      `expected position_samples=1024 (4 blocks x 256), got ${s.position_samples}`,
    );
    assert(s.voices === 3, `expected state voices=3, got ${s.voices}`);

    await client.quit();
  } finally {
    await transport.close();
  }

  console.log("SMOKE PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
