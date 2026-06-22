# Deploying to your iPhone as the DAW evolves

The goal: every time the swarm merges a new rung into the engine, the latest DAW
reaches your iPhone with as little manual work as possible. This documents the
Expo / React Native path you chose, what's automated, and the one unavoidable
caveat about native code.

## The shape of it

```
  swarm merges a rung into engine/  (native Rust)
            │
            ▼
  GitHub Actions (Linux)  ── protocol-smoke: build engine + run TS client test
            │  (green)
            ▼
  eas build  ─────────────▶  EAS macOS cloud builder
            │                   • cross-compiles the Rust engine for iOS
            │                   • builds + signs the Expo app
            ▼
  TestFlight  ────────────▶  your iPhone gets an "Update" notification
```

You own a Mac + Apple Developer account, but note: **the macOS build runs on
EAS's cloud, not your Mac.** So the pipeline is hands-off — you don't have to
open Xcode for each rung.

## The one caveat to internalize (native vs OTA)

Over-the-air updates (Expo's **EAS Update**) push only **JavaScript and assets**
— the UI. They **cannot** push **native code**. Our engine is native (Rust
compiled into the binary), so **evolving the engine requires a new build**, not an
OTA. Concretely:

| Change | How it reaches the phone | Speed |
|---|---|---|
| UI tweak (React Native / JS) | `eas update` → OTA | seconds, no rebuild |
| **Engine rung** (Rust) | `eas build` → TestFlight | minutes, new build (automated) |

So the pipeline above (build → TestFlight on every engine merge) is the realistic
"seamless" answer: fully automated for you; the *tester* taps "Update" and waits a
few minutes per build. If you later want **instant** engine updates too, see
"Instant engine OTA" at the bottom.

## One-time setup (you, with your Apple/Expo accounts)

1. **Expo account + token.** Create an account at expo.dev, generate a personal
   access token, and add it to the GitHub repo as the secret `EXPO_TOKEN`
   (Settings → Secrets and variables → Actions). The `ios-release` job uses it.
2. **Bundle identifier.** Set a real one in `mobile/app.json` (replace
   `com.example.dawgroovebox`) and register the App ID in your Apple Developer
   account (EAS can do this for you on first build).
3. **iOS signing credentials.** Run once, interactively, from `mobile/`:
   `eas credentials` — let EAS generate and store the distribution certificate and
   provisioning profile. (EAS keeps them; CI then builds non-interactively.)
4. **App Store Connect API key (for auto-submit to TestFlight).** Create an API
   key in App Store Connect, then fill the placeholders in `mobile/eas.json`
   under `submit.production` (issuer id, key id, the `.p8` path or an EAS secret),
   and create the app record in App Store Connect once.
5. **Internal testing group.** In TestFlight, add yourself to an internal testing
   group so new builds are available to your device immediately (internal testing
   skips Beta App Review).

After that, every merge to `main` that touches `engine/` or `mobile/` builds and
ships to TestFlight automatically.

## Day-to-day loops

- **Fastest inner loop (engine logic):** `python evaluator/regression.py` and the
  protocol smoke test (`cd mobile && npm run smoke`) — both run locally/in CI with
  no device, against the real engine.
- **UI iteration on device:** `cd mobile && npx expo start --dev-client`, open the
  dev build on your iPhone; JS changes hot-reload instantly; `eas update` pushes
  JS OTA to testers.
- **Engine on device:** automatic via the pipeline on merge; or manually
  `eas build --platform ios --profile preview --auto-submit`.

## Binding the Rust engine into the app (the native module)

The app talks to the engine through the same JSON protocol, via a transport
(`mobile/protocol/`). On device the transport calls a **native module** that
embeds the Rust engine:

- The engine is compiled for iOS (`aarch64-apple-ios`) as a static library.
- A thin binding exposes the protocol surface to JS — the clean route is
  **UniFFI** (generates the Swift bindings from the Rust interface) wrapped in an
  **Expo native module**; the Swift side also owns the real-time audio callback
  (AVAudioEngine) that calls the engine's `render`.
- The cross-compile is wired into an **EAS build hook** (e.g. an
  `eas-build-pre-install` step that runs `rustup target add aarch64-apple-ios`
  and a config plugin that builds + links the lib), so it happens on the macOS
  cloud builder automatically.

This native module is the piece that still requires a real build per change —
which is exactly why engine rungs go through `eas build`, not OTA.

## Instant engine OTA (optional, later)

If per-rung rebuilds feel too slow, compile the *engine* to **WebAssembly** and
have a stable native shell load it at runtime. The WASM blob is an **asset**, so
`eas update` CAN push a new engine over the air — instant engine hot-swaps. The
trade-off is running the DSP as WASM inside the app (more wiring, a bit slower
than embedded native Rust). It reuses our exact protocol, so it's an add-on, not
a rewrite. Decide this once rebuild cadence becomes the bottleneck.
