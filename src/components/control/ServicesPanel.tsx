import { useEffect, useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Server, RefreshCcw, Play, Square, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type ServiceEntry = { Name: string; DisplayName: string; Status: string | number };

function parseStatus(s: string | number): string {
  if (typeof s === "number") {
    return s === 4 ? "Running" : s === 1 ? "Stopped" : `${s}`;
  }
  return String(s);
}

export function ServicesPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await send("services.list", {}, 20000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      const raw = res.result?.services ?? "[]";
      const parsed: ServiceEntry[] = typeof raw === "string" ? JSON.parse(raw) : raw;
      setServices(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const act = async (action: string, name: string) => {
    setActing(name);
    try {
      const res = await send(action, { name }, 20000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`${action.split(".")[1]} ${name}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  const filtered = services.filter((s) =>
    (s.DisplayName || s.Name || "").toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2 backdrop-blur-xl">
        <Server className="h-4 w-4 text-primary ml-2" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter services…"
          className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
        <button onClick={load} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent">
          <RefreshCcw className="h-3 w-3" /> Refresh
        </button>
        <span className="text-xs text-muted-foreground">{filtered.length} / {services.length}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Display Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && filtered.map((s) => {
              const status = parseStatus(s.Status);
              const running = status.toLowerCase().includes("running") || status === "4";
              return (
                <tr key={s.Name} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-mono text-xs">{s.Name}</td>
                  <td className="px-4 py-1.5 text-xs">{s.DisplayName}</td>
                  <td className="px-4 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${running ? "bg-emerald-500/20 text-emerald-300" : "bg-muted/40 text-muted-foreground"}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right space-x-1">
                    {!running && (
                      <button onClick={() => act("services.start", s.Name)} disabled={acting === s.Name}
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">
                        <Play className="h-3 w-3" /> Start
                      </button>
                    )}
                    {running && (
                      <button onClick={() => act("services.stop", s.Name)} disabled={acting === s.Name}
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    )}
                    <button onClick={() => act("services.restart", s.Name)} disabled={acting === s.Name}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">
                      <RotateCcw className="h-3 w-3" /> Restart
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
