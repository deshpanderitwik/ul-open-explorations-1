// protocol.ts — pure TypeScript client for the headless DAW engine.
//
// This file intentionally has NO react-native / node imports so it can run under
// `node --experimental-strip-types` and be shared across every transport
// (native Rust module, WASM, stdio). It matches spec/protocol.md exactly.

// ----------------------------------------------------------------------------
// Commands (client -> engine)
// ----------------------------------------------------------------------------
// Every command has a string-literal `cmd` discriminant and an optional client
// chosen integer `id` that the engine echoes back on the acknowledging event.

export interface LoadCommand {
  cmd: "load";
  id?: number;
}

export interface AddVoiceCommand {
  cmd: "add_voice";
  freq: number; // f32
  id?: number;
}

export interface ClearVoicesCommand {
  cmd: "clear_voices";
  id?: number;
}

export interface SetTempoCommand {
  cmd: "set_tempo";
  bpm: number; // f32
  id?: number;
}

export interface TransportCommand {
  cmd: "transport";
  action: "play" | "stop" | "seek";
  pos?: number; // samples; used by "seek"
  id?: number;
}

export interface RenderCommand {
  cmd: "render";
  blocks: number; // u32
  id?: number;
}

export interface GetStateCommand {
  cmd: "get_state";
  id?: number;
}

export interface QuitCommand {
  cmd: "quit";
  id?: number;
}

export type Command =
  | LoadCommand
  | AddVoiceCommand
  | ClearVoicesCommand
  | SetTempoCommand
  | TransportCommand
  | RenderCommand
  | GetStateCommand
  | QuitCommand;

// ----------------------------------------------------------------------------
// Events (engine -> client)
// ----------------------------------------------------------------------------

export interface ReadyEvent {
  event: "ready";
  version: string;
}

export interface OkEvent {
  event: "ok";
  id?: number;
}

export interface ErrorEvent {
  event: "error";
  message: string;
  id?: number;
}

export interface MeterEvent {
  event: "meter";
  rms: number;
  peak: number;
  voices: number;
  id?: number;
}

export interface StateEvent {
  event: "state";
  sample_rate: number;
  block_size: number;
  tempo_bpm: number;
  playing: boolean;
  position_samples: number;
  voices: number;
  id?: number;
}

export interface ByeEvent {
  event: "bye";
  id?: number;
}

export type Event =
  | ReadyEvent
  | OkEvent
  | ErrorEvent
  | MeterEvent
  | StateEvent
  | ByeEvent;

// ----------------------------------------------------------------------------
// Transport — the only thing that knows how bytes actually move.
// ----------------------------------------------------------------------------
// The client is transport-agnostic: stdio (dev/test), native Rust module on
// device, or WASM all implement this same surface.

export interface Transport {
  send(command: Command): void;
  onEvent(handler: (e: Event) => void): void;
  close(): Promise<void> | void;
}

// ----------------------------------------------------------------------------
// DawClient — ergonomic async wrapper over any Transport.
// ----------------------------------------------------------------------------
// Each method auto-assigns an `id`, sends the command, and resolves when the
// correlated acknowledging event arrives. Unsolicited events (e.g. `meter` from
// background renders, `ready`) are fanned out to subscribers registered via
// `subscribe()`.

type Pending = {
  resolve: (e: Event) => void;
  reject: (err: Error) => void;
};

export class DawClient {
  private readonly transport: Transport;
  private nextId = 1;
  private lastSentId: number | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly subscribers = new Set<(e: Event) => void>();

  constructor(transport: Transport) {
    this.transport = transport;
    this.transport.onEvent((e) => this.handleEvent(e));
  }

  /** Subscribe to every event (e.g. for live meters). Returns an unsubscribe fn. */
  subscribe(handler: (e: Event) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  private handleEvent(e: Event): void {
    // Always fan out to subscribers first.
    for (const sub of this.subscribers) {
      sub(e);
    }
    // `bye` is the terminal acknowledgement of `quit` but carries no id, so
    // correlate it to the most recent pending request.
    if (e.event === "bye" && typeof e.id !== "number") {
      const lastId = this.lastSentId;
      if (lastId !== null && this.pending.has(lastId)) {
        const waiter = this.pending.get(lastId)!;
        this.pending.delete(lastId);
        waiter.resolve(e);
        return;
      }
    }
    // Then resolve any correlated pending request.
    const id = e.id;
    if (typeof id === "number") {
      const waiter = this.pending.get(id);
      if (waiter) {
        this.pending.delete(id);
        if (e.event === "error") {
          waiter.reject(new Error(e.message));
        } else {
          waiter.resolve(e);
        }
      }
    }
  }

  /** Send a command with a fresh id and resolve on the correlated event. */
  private request(command: Omit<Command, "id">): Promise<Event> {
    const id = this.nextId++;
    this.lastSentId = id;
    const withId = { ...command, id } as Command;
    return new Promise<Event>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(withId);
    });
  }

  async load(): Promise<OkEvent> {
    return (await this.request({ cmd: "load" })) as OkEvent;
  }

  async addVoice(freq: number): Promise<OkEvent> {
    return (await this.request({ cmd: "add_voice", freq })) as OkEvent;
  }

  async clearVoices(): Promise<OkEvent> {
    return (await this.request({ cmd: "clear_voices" })) as OkEvent;
  }

  async setTempo(bpm: number): Promise<OkEvent> {
    return (await this.request({ cmd: "set_tempo", bpm })) as OkEvent;
  }

  async play(): Promise<OkEvent> {
    return (await this.request({ cmd: "transport", action: "play" })) as OkEvent;
  }

  async stop(): Promise<OkEvent> {
    return (await this.request({ cmd: "transport", action: "stop" })) as OkEvent;
  }

  async seek(pos: number): Promise<OkEvent> {
    return (await this.request({
      cmd: "transport",
      action: "seek",
      pos,
    })) as OkEvent;
  }

  async render(blocks: number): Promise<MeterEvent> {
    return (await this.request({ cmd: "render", blocks })) as MeterEvent;
  }

  async getState(): Promise<StateEvent> {
    return (await this.request({ cmd: "get_state" })) as StateEvent;
  }

  async quit(): Promise<ByeEvent> {
    return (await this.request({ cmd: "quit" })) as ByeEvent;
  }
}
