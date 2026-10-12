import { useEffect, useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { AppWindow, RefreshCcw, X, Minus, Focus } from "lucide-react";
import { toast } from "sonner";

type WinEntry = { Id: number; ProcessName: string; MainWindowTitle: string };

export function WindowsPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [windows, setWindows] = useState<WinEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await send("window.list", {}, 15000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      const raw = res.result?.windows ?? "[]";
      const parsed: WinEntry[] = typeof raw === "string" ? JSON.parse(raw) : raw;
      setWindows(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const act = async (action: string, pid: number) => {
    setActing(pid);
    try {
      const res = await send(action, { pid }, 10000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`${action.split(".")[1]} done`);
      setTimeout(load, 500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2 backdrop-blur-xl">
        <AppWindow className="h-4 w-4 text-primary ml-2" />
        <span className="text-sm font-medium">Open Windows</span>
        <div className="flex-1" />
        <button onClick={load} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent">
          <RefreshCcw className="h-3 w-3" /> Refresh
        </button>
        <span className="text-xs text-muted-foreground">{windows.length} windows</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">PID</th>
              <th className="px-4 py-2 font-medium">Process</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && windows.map((w) => (
              <tr key={w.Id} className="border-t border-border/40 hover:bg-muted/20">
                <td className="px-4 py-1.5 font-mono text-xs">{w.Id}</td>
                <td className="px-4 py-1.5 text-xs">{w.ProcessName}</td>
                <td className="px-4 py-1.5 text-xs truncate max-w-xs">{w.MainWindowTitle}</td>
                <td className="px-4 py-1.5 text-right space-x-1">
                  <button onClick={() => act("window.focus", w.Id)} disabled={acting === w.Id}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">
                    <Focus className="h-3 w-3" /> Focus
                  </button>
                  <button onClick={() => act("window.minimize", w.Id)} disabled={acting === w.Id}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">
                    <Minus className="h-3 w-3" /> Min
                  </button>
                  <button onClick={() => { if (confirm(`Close "${w.MainWindowTitle}"?`)) act("window.close", w.Id); }} disabled={acting === w.Id}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                    <X className="h-3 w-3" /> Close
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
