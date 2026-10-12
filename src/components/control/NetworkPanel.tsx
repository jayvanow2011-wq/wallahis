import { useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Wifi, RefreshCcw, Globe, Activity, Search } from "lucide-react";
import { toast } from "sonner";

export function NetworkPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [connections, setConnections] = useState<string>("");
  const [wifiProfiles, setWifiProfiles] = useState<string>("");
  const [publicIp, setPublicIp] = useState<string>("");
  const [pingHost, setPingHost] = useState("");
  const [pingResult, setPingResult] = useState("");
  const [tracertHost, setTracertHost] = useState("");
  const [tracertResult, setTracertResult] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const doAction = async (action: string, label: string, payload: any = {}, setter: (s: string) => void) => {
    setLoading(action);
    try {
      const res = await send(action, payload, 30000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      const r = res.result ?? {};
      setter(r.output || r.connections || r.profiles || r.ip || JSON.stringify(r, null, 2));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Public IP */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Globe className="h-4 w-4 text-primary" /> Public IP</div>
          <button onClick={() => doAction("net.public_ip", "IP", {}, setPublicIp)} disabled={loading === "net.public_ip"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Get
          </button>
        </div>
        {publicIp && <div className="mt-2 font-mono text-lg text-primary">{publicIp}</div>}
      </div>

      {/* Active connections */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4 text-primary" /> Active TCP Connections</div>
          <button onClick={() => doAction("net.connections", "Connections", {}, setConnections)} disabled={loading === "net.connections"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Refresh
          </button>
        </div>
        {connections && <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{connections}</pre>}
      </div>

      {/* WiFi profiles */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Wifi className="h-4 w-4 text-primary" /> WiFi Profiles & Passwords</div>
          <button onClick={() => doAction("net.wifi_profiles", "WiFi", {}, setWifiProfiles)} disabled={loading === "net.wifi_profiles"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Scan
          </button>
        </div>
        {wifiProfiles && <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{wifiProfiles}</pre>}
      </div>

      {/* Ping */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4 text-primary" /> Ping</div>
        <div className="mt-2 flex gap-2">
          <input value={pingHost} onChange={(e) => setPingHost(e.target.value)} placeholder="Host or IP (e.g. 8.8.8.8)"
            className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-sm outline-none" />
          <button onClick={() => doAction("net.ping", "Ping", { host: pingHost }, setPingResult)} disabled={!pingHost || loading === "net.ping"}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Ping</button>
        </div>
        {pingResult && <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{pingResult}</pre>}
      </div>

      {/* Tracert */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4 text-primary" /> Traceroute</div>
        <div className="mt-2 flex gap-2">
          <input value={tracertHost} onChange={(e) => setTracertHost(e.target.value)} placeholder="Host or IP"
            className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-sm outline-none" />
          <button onClick={() => doAction("net.tracert", "Tracert", { host: tracertHost }, setTracertResult)} disabled={!tracertHost || loading === "net.tracert"}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Trace</button>
        </div>
        {tracertResult && <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{tracertResult}</pre>}
      </div>

      {/* DNS Flush */}
      <button onClick={() => doAction("net.dns_flush", "DNS Flush", {}, () => toast.success("DNS cache flushed"))} disabled={loading === "net.dns_flush"}
        className="rounded-md border border-border/60 px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
        🧹 Flush DNS Cache
      </button>
    </div>
  );
}
