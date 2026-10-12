import { useCallback, useEffect, useRef, useState } from "react";
import { useRelaySocket } from "@/lib/relay";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Mic, MicOff, Volume2, Play, Square, Send, Loader2, Headphones, Radio } from "lucide-react";
import { toast } from "sonner";

/**
 * Remote microphone listen + speak (push audio to remote speaker) + TTS.
 *
 * Wire protocol (relay `cmd` envelope):
 *   { action: "mic.listen.start", input_device? }   -> agent starts capturing mic
 *   { action: "mic.listen.stop" }                    -> agent stops
 *   { action: "mic.devices" }                        -> agent replies with input/output devices (HTTP cmd)
 *   { action: "mic.output.set", output_device }      -> pick remote output
 *   { action: "audio.tts", text, voice? }            -> agent speaks text on remote
 *   { action: "audio.play", pcm_b64, sample_rate }   -> agent plays raw PCM
 *
 * Incoming from agent (relay message):
 *   { type: "mic-chunk", payload: { pcm_b64, sample_rate, channels } }
 */
export function MicPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const { connected, send: relaySend, onMessage } = useRelaySocket(deviceId);

  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<{ inputs: { id: string; name: string }[]; outputs: { id: string; name: string }[] }>({ inputs: [], outputs: [] });
  const [inputDevice, setInputDevice] = useState<string>("default");
  const [outputDevice, setOutputDevice] = useState<string>("default");

  // Local TTS voices (browser speech-synthesis) OR remote TTS
  const [ttsText, setTtsText] = useState("");
  const [ttsMode, setTtsMode] = useState<"remote" | "local">("remote");
  const [ttsVoice, setTtsVoice] = useState<string>("");
  const [localVoices, setLocalVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [sending, setSending] = useState(false);

  // Local playback of remote mic audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const ensureCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      nextStartRef.current = audioCtxRef.current.currentTime + 0.1;
    }
    return audioCtxRef.current!;
  }, []);

  // Load available local TTS voices
  useEffect(() => {
    const load = () => setLocalVoices(window.speechSynthesis?.getVoices?.() ?? []);
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);

  // Query remote devices
  const refreshDevices = useCallback(async () => {
    try {
      const r = await send("mic.devices", {}, 8000);
      const res = r.result ?? {};
      setDevices({
        inputs: Array.isArray(res.inputs) ? res.inputs : [],
        outputs: Array.isArray(res.outputs) ? res.outputs : [],
      });
    } catch {
      /* agent may not yet support — silent */
    }
  }, [send]);
  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  // Receive remote mic chunks and play them locally
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type !== "mic-chunk" && msg.type !== "mic-frame") return;
      const b64 = msg.payload?.pcm_b64;
      const sr = Number(msg.payload?.sample_rate ?? 16000);
      const ch = Math.max(1, Number(msg.payload?.channels ?? 1));
      if (!b64) return;
      try {
        const ctx = ensureCtx();
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // Treat as 16-bit little-endian PCM
        const frames = Math.floor(bytes.byteLength / 2 / ch);
        const buf = ctx.createBuffer(ch, frames, sr);
        const view = new DataView(bytes.buffer);
        for (let c = 0; c < ch; c++) {
          const data = buf.getChannelData(c);
          for (let i = 0; i < frames; i++) {
            const s = view.getInt16((i * ch + c) * 2, true);
            data[i] = s / 32768;
          }
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        if (!analyserRef.current) {
          analyserRef.current = ctx.createAnalyser();
          analyserRef.current.fftSize = 256;
          analyserRef.current.connect(ctx.destination);
        }
        src.connect(analyserRef.current);
        const startAt = Math.max(nextStartRef.current, ctx.currentTime + 0.02);
        src.start(startAt);
        nextStartRef.current = startAt + buf.duration;
        // Update level meter
        const arr = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / arr.length) * 3));
      } catch (e) {
        console.warn("[mic] play error", e);
      }
    });
  }, [onMessage, ensureCtx]);

  const startListen = async () => {
    ensureCtx();
    if (audioCtxRef.current?.state === "suspended") await audioCtxRef.current.resume();
    setListening(true);
    relaySend({ type: "cmd", payload: { action: "mic.listen.start", input_device: inputDevice } });
    send("mic.listen.start", { input_device: inputDevice }, 8000).catch(() => {});
  };
  const stopListen = () => {
    setListening(false);
    setLevel(0);
    relaySend({ type: "cmd", payload: { action: "mic.listen.stop" } });
    send("mic.listen.stop", {}, 5000).catch(() => {});
  };

  const applyOutput = async () => {
    try {
      await send("mic.output.set", { output_device: outputDevice }, 5000);
      toast.success("Output device applied on remote");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to set output");
    }
  };

  const speak = async () => {
    if (!ttsText.trim()) return;
    if (ttsMode === "local") {
      const utt = new SpeechSynthesisUtterance(ttsText);
      const v = localVoices.find((v) => v.voiceURI === ttsVoice);
      if (v) utt.voice = v;
      window.speechSynthesis.speak(utt);
      return;
    }
    setSending(true);
    try {
      const r = await send("audio.tts", { text: ttsText, voice: ttsVoice, output_device: outputDevice }, 30_000);
      if (r.status === "error") throw new Error(r.error ?? "TTS failed");
      toast.success("Spoken on remote");
      setTtsText("");
    } catch (e: any) {
      toast.error(e?.message ?? "TTS failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Listen */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Headphones className="h-4 w-4 text-primary" /> Listen to remote microphone
          </div>
          <span className={`text-[10px] ${connected ? "text-emerald-400" : "text-muted-foreground"}`}>
            Relay {connected ? "ON" : "OFF"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Streams the remote machine's mic audio to your browser in real time.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <select
            value={inputDevice}
            onChange={(e) => setInputDevice(e.target.value)}
            className="rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-sm outline-none"
          >
            <option value="default">Default input device</option>
            {devices.inputs.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {!listening ? (
            <button
              onClick={startListen}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Play className="h-4 w-4" /> Start listening
            </button>
          ) : (
            <button
              onClick={stopListen}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          )}
        </div>

        {listening && (
          <div className="mt-3 flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/40">
              <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">{Math.round(level * 100)}%</span>
          </div>
        )}
      </div>

      {/* Output device */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Volume2 className="h-4 w-4 text-primary" /> Remote output device
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <select
            value={outputDevice}
            onChange={(e) => setOutputDevice(e.target.value)}
            className="rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-sm outline-none"
          >
            <option value="default">Default output device</option>
            {devices.outputs.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button onClick={refreshDevices} className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-accent">
            Refresh
          </button>
          <button onClick={applyOutput} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            Apply
          </button>
        </div>
      </div>

      {/* Speak / TTS */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mic className="h-4 w-4 text-primary" /> Text-to-Speech
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Speak text out loud on the remote machine, or preview locally in your browser.
        </p>

        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <label className={`flex-1 cursor-pointer rounded-md border px-3 py-1.5 text-center text-xs ${ttsMode === "remote" ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60"}`}>
              <input type="radio" className="hidden" checked={ttsMode === "remote"} onChange={() => setTtsMode("remote")} />
              🖥 Speak on remote
            </label>
            <label className={`flex-1 cursor-pointer rounded-md border px-3 py-1.5 text-center text-xs ${ttsMode === "local" ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60"}`}>
              <input type="radio" className="hidden" checked={ttsMode === "local"} onChange={() => setTtsMode("local")} />
              🎧 Preview locally
            </label>
          </div>

          {ttsMode === "local" && (
            <select
              value={ttsVoice}
              onChange={(e) => setTtsVoice(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-sm outline-none"
            >
              <option value="">Default voice</option>
              {localVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          )}

          <textarea
            value={ttsText}
            onChange={(e) => setTtsText(e.target.value)}
            rows={3}
            placeholder="Type what you want to say…"
            className="w-full resize-none rounded-md border border-border/60 bg-input/60 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            disabled={!ttsText.trim() || sending}
            onClick={speak}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Speaking…" : ttsMode === "local" ? "Preview locally" : "Speak on remote"}
          </button>
        </div>
      </div>
    </div>
  );
}
