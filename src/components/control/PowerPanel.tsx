import { useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Power, Moon, LogOut, RotateCcw, Zap, Video } from "lucide-react";
import { toast } from "sonner";

export function PowerPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [busy, setBusy] = useState<string | null>(null);
  const [recordDuration, setRecordDuration] = useState("10");
  const [hostsContent, setHostsContent] = useState("");
  const [hostsEntry, setHostsEntry] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const run = async (action: string, label: string, payload: any = {}) => {
    if (!confirm(`Run "${label}" on the remote machine?`)) return;
    setBusy(action);
    try {
      const res = await send(action, payload, 30000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`${label} dispatched`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const readHosts = async () => {
    setLoading("hosts.read");
    try {
      const res = await send("hosts.read", {}, 10000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setHostsContent(res.result?.content || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const writeHostsEntry = async () => {
    if (!hostsEntry.trim()) return;
    setLoading("hosts.write");
    try {
      const res = await send("hosts.write", { entry: hostsEntry }, 10000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success("Hosts entry added");
      setHostsEntry("");
      readHosts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const Btn = ({ icon: Icon, label, action, danger, payload }: any) => (
    <button disabled={busy === action} onClick={() => run(action, label, payload)}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-50 ${danger ? "border-red-500/40 bg-red-500/5 hover:bg-red-500/10" : "border-border/60 bg-card/60 hover:bg-accent"}`}>
      <Icon className={`h-5 w-5 ${danger ? "text-red-400" : "text-primary"}`} />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{action}</div>
      </div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Btn icon={Power} label="Shutdown" action="system.shutdown" danger />
        <Btn icon={RotateCcw} label="Restart" action="system.restart" danger />
        <Btn icon={Moon} label="Sleep" action="power.sleep" />
        <Btn icon={Zap} label="Hibernate" action="power.hibernate" />
        <Btn icon={LogOut} label="Log Off" action="power.logoff" danger />
        <Btn icon={Power} label="Lock Workstation" action="system.lock" />
      </div>

      {/* Screen Record */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><Video className="h-4 w-4 text-primary" /> Screen Record</div>
        <p className="mt-1 text-xs text-muted-foreground">Records screen via ffmpeg for a specified duration (seconds).</p>
        <div className="mt-2 flex gap-2">
          <input value={recordDuration} onChange={(e) => setRecordDuration(e.target.value)} placeholder="Duration (s)"
            className="w-24 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-sm outline-none" />
          <button onClick={() => run("screen.record.start", "Screen Record", { duration: parseInt(recordDuration) || 10 })}
            disabled={busy === "screen.record.start"}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Record
          </button>
        </div>
      </div>

      {/* Hosts file */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Hosts File</div>
          <button onClick={readHosts} disabled={loading === "hosts.read"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            Read
          </button>
        </div>
        {hostsContent && <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{hostsContent}</pre>}
        <div className="mt-2 flex gap-2">
          <input value={hostsEntry} onChange={(e) => setHostsEntry(e.target.value)} placeholder="127.0.0.1 example.com"
            className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
          <button onClick={writeHostsEntry} disabled={!hostsEntry.trim() || loading === "hosts.write"}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Add</button>
        </div>
      </div>
    </div>
  );
}
