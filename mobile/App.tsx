// App.tsx — minimal groovebox UI skeleton.
//
// Drives the headless DAW engine entirely through DawClient over the on-device
// NativeTransport. Transport / tempo / pads issue protocol commands; a polling
// loop pulls live meters and transport position via render + get_state.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { DawClient } from "./protocol/protocol.ts";
import { NativeTransport } from "./protocol/nativeTransport.ts";

// Four pads, each adds a sine voice at a fixed pitch.
const PAD_PITCHES = [220, 277, 330, 440];

// Poll cadence for meters + state.
const POLL_MS = 250;
const RENDER_BLOCKS = 4;

export default function App(): React.JSX.Element {
  // Build the client once. On device this binds to the native Rust engine;
  // before an EAS build exists you can pass a `mock` to NativeTransport.
  const client = useMemo(() => {
    const transport = new NativeTransport();
    return new DawClient(transport);
  }, []);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(120);
  const [meter, setMeter] = useState({ rms: 0, peak: 0, voices: 0 });
  const [position, setPosition] = useState(0);

  const startedRef = useRef(false);

  // Initialize the engine project once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await client.load();
        await client.setTempo(tempo);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.warn("engine init failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Poll meters + transport position while ready.
  useEffect(() => {
    if (!ready) return;
    const handle = setInterval(async () => {
      try {
        const m = await client.render(RENDER_BLOCKS);
        setMeter({ rms: m.rms, peak: m.peak, voices: m.voices });
        const s = await client.getState();
        setPosition(s.position_samples);
        setPlaying(s.playing);
      } catch {
        // transient; ignore
      }
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [ready, client]);

  const onPlayStop = async () => {
    if (playing) {
      await client.stop();
      setPlaying(false);
    } else {
      await client.play();
      setPlaying(true);
    }
    startedRef.current = true;
  };

  const onTempo = async (delta: number) => {
    const next = Math.max(40, Math.min(240, tempo + delta));
    setTempo(next);
    await client.setTempo(next);
  };

  const onPad = async (freq: number) => {
    await client.addVoice(freq);
  };

  const onClear = async () => {
    await client.clearVoices();
  };

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>DAW Groovebox</Text>

      <View style={styles.transportRow}>
        <TouchableOpacity style={styles.transportBtn} onPress={onPlayStop}>
          <Text style={styles.transportBtnText}>
            {playing ? "Stop" : "Play"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tempoRow}>
        <TouchableOpacity style={styles.stepBtn} onPress={() => onTempo(-4)}>
          <Text style={styles.stepBtnText}>-</Text>
        </TouchableOpacity>
        <Text style={styles.tempoText}>{tempo} BPM</Text>
        <TouchableOpacity style={styles.stepBtn} onPress={() => onTempo(4)}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.padRow}>
        {PAD_PITCHES.map((freq) => (
          <TouchableOpacity
            key={freq}
            style={styles.pad}
            onPress={() => onPad(freq)}
          >
            <Text style={styles.padText}>{freq}</Text>
            <Text style={styles.padSub}>Hz</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
        <Text style={styles.clearBtnText}>Clear voices</Text>
      </TouchableOpacity>

      <View style={styles.readout}>
        <Text style={styles.readoutText}>rms: {meter.rms.toFixed(4)}</Text>
        <Text style={styles.readoutText}>peak: {meter.peak.toFixed(4)}</Text>
        <Text style={styles.readoutText}>voices: {meter.voices}</Text>
        <Text style={styles.readoutText}>pos: {position} samples</Text>
        <Text style={styles.readoutText}>
          engine: {ready ? "ready" : "connecting..."}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#101014",
    padding: 24,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 24,
  },
  transportRow: {
    marginBottom: 24,
  },
  transportBtn: {
    backgroundColor: "#2e7d32",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  transportBtnText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
  },
  tempoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  stepBtn: {
    backgroundColor: "#333",
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "700",
  },
  tempoText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "600",
    marginHorizontal: 24,
    minWidth: 110,
    textAlign: "center",
  },
  padRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  pad: {
    flex: 1,
    aspectRatio: 1,
    marginHorizontal: 4,
    backgroundColor: "#3949ab",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  padText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  padSub: {
    color: "#cdd",
    fontSize: 12,
  },
  clearBtn: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  clearBtnText: {
    color: "#bbb",
    fontSize: 14,
  },
  readout: {
    backgroundColor: "#1a1a20",
    borderRadius: 12,
    padding: 16,
  },
  readoutText: {
    color: "#9fe",
    fontFamily: "Courier",
    fontSize: 16,
    marginBottom: 4,
  },
});
