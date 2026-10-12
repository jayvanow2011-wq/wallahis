import { useEffect, useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { RefreshCcw, X, Trees, Play } from "lucide-react";
import { toast } from "sonner";

type Proc = { pid: number; name: string; memory_mb: number };

export function ProcessesPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [startCmd, setStartCmd] = useState("");
  const [startArgs, setStartArgs] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await send("proc.list", {}, 15000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setProcs((res.result?.processes ?? []) as Proc[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kill = async (p: Proc, tree = false) => {
    if (!confirm(`${tree ? "Tree-kill" : "Kill"} ${p.name} (PID ${p.pid})?`)) return;
    try {
      const res = await send(tree ? "proc.tree_kill" : "proc.kill", { pid: p.pid });
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`Killed PID ${p.pid}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const startProc = async () => {
    if (!startCmd.trim()) return;
    try {
      const res = await send("proc.start", { command: startCmd, args: startArgs });
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`Started ${startCmd} (PID ${res.result?.pid})`);
      setStartCmd(""); setStartArgs("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const filtered = procs.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-3">
      {/* Start process */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-3 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-xs font-medium mb-2"><Play className="h-3.5 w-3.5 text-primary" /> Start new process</div>
        <div className="flex gap-2">
          <input value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder="Command (e.g. notepad.exe)"
            className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
          <input value={startArgs} onChange={(e) => setStartArgs(e.target.value)} placeholder="Args"
            className="w-40 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
          <button onClick={startProc} disabled={!startCmd.trim()}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Launch</button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2 backdrop-blur-xl">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none"
        />
        <button
          onClick={load}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent"
        >
          <RefreshCcw className="h-3 w-3" /> Refresh
        </button>
        <span className="text-xs text-muted-foreground">{filtered.length} / {procs.length}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">PID</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Memory</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((p) => (
                <tr key={p.pid} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-mono text-xs">{p.pid}</td>
                  <td className="px-4 py-1.5">{p.name}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">
                    {p.memory_mb ? `${p.memory_mb.toFixed(1)} MB` : "—"}
                  </td>
                  <td className="px-4 py-1.5 text-right space-x-1">
                    <button
                      onClick={() => kill(p)}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      <X className="h-3 w-3" /> Kill
                    </button>
                    <button
                      onClick={() => kill(p, true)}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10"
                      title="Kill process and all children"
                    >
                      <Trees className="h-3 w-3" /> Tree
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
