import { useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { HardDrive, RefreshCcw, Monitor, Package } from "lucide-react";
import { toast } from "sonner";

export function SysinfoPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [info, setInfo] = useState<any>(null);
  const [apps, setApps] = useState<string>("");
  const [monitors, setMonitors] = useState<string>("");
  const [envVars, setEnvVars] = useState<any[]>([]);
  const [envFilter, setEnvFilter] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const loadInfo = async () => {
    setLoading("info");
    try {
      const res = await send("sysinfo.full", {}, 20000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      const raw = res.result?.info ?? "{}";
      setInfo(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const loadApps = async () => {
    setLoading("apps");
    try {
      const res = await send("sysinfo.installed_apps", {}, 20000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setApps(res.result?.apps || JSON.stringify(res.result, null, 2));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const loadMonitors = async () => {
    setLoading("monitors");
    try {
      const res = await send("screen.monitors", {}, 10000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setMonitors(res.result?.monitors || JSON.stringify(res.result, null, 2));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const loadEnv = async () => {
    setLoading("env");
    try {
      const res = await send("env.list", {}, 10000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setEnvVars(res.result?.vars || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const filteredEnv = envVars.filter((v: any) => (v.key || "").toLowerCase().includes(envFilter.toLowerCase()));

  return (
    <div className="space-y-4">
      {/* Full sysinfo */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><HardDrive className="h-4 w-4 text-primary" /> System Information</div>
          <button onClick={loadInfo} disabled={loading === "info"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Load
          </button>
        </div>
        {info && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
            <InfoRow label="OS" value={info.os_name} />
            <InfoRow label="Version" value={`${info.os_version} (${info.os_build})`} />
            <InfoRow label="CPU" value={info.cpu_name} />
            <InfoRow label="Cores / Threads" value={`${info.cpu_cores} / ${info.cpu_threads}`} />
            <InfoRow label="RAM" value={`${info.ram_total_gb} GB`} />
            <InfoRow label="GPU" value={info.gpu_name} />
            <InfoRow label="GPU VRAM" value={info.gpu_ram_mb ? `${info.gpu_ram_mb} MB` : "—"} />
            <InfoRow label="Battery" value={info.battery_percent != null ? `${info.battery_percent}%${info.battery_charging ? " ⚡" : ""}` : "No battery"} />
            <InfoRow label="Uptime" value={`${info.uptime_hours}h`} />
            <InfoRow label="User" value={`${info.domain}\\${info.username}`} />
            <InfoRow label="Hostname" value={info.hostname} />
            {info.disks && (
              <div className="sm:col-span-2 space-y-1.5">
                <div className="text-muted-foreground font-medium uppercase tracking-wide">Disks</div>
                {(Array.isArray(info.disks) ? info.disks : [info.disks]).map((d: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-mono w-8">{d.drive}</span>
                    <div className="flex-1 h-2 rounded-full bg-border/40 overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${((d.total_gb - d.free_gb) / d.total_gb * 100).toFixed(0)}%` }} />
                    </div>
                    <span className="text-muted-foreground">{d.free_gb}GB free / {d.total_gb}GB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Monitors */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Monitor className="h-4 w-4 text-primary" /> Monitors</div>
          <button onClick={loadMonitors} disabled={loading === "monitors"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Load
          </button>
        </div>
        {monitors && <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{monitors}</pre>}
      </div>

      {/* Installed apps */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Package className="h-4 w-4 text-primary" /> Installed Apps</div>
          <button onClick={loadApps} disabled={loading === "apps"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Load
          </button>
        </div>
        {apps && <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{apps}</pre>}
      </div>

      {/* Environment variables */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Environment Variables</div>
          <button onClick={loadEnv} disabled={loading === "env"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Load
          </button>
        </div>
        {envVars.length > 0 && (
          <>
            <input value={envFilter} onChange={(e) => setEnvFilter(e.target.value)} placeholder="Filter…"
              className="mt-2 w-full rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
            <div className="mt-2 max-h-60 overflow-auto space-y-0.5">
              {filteredEnv.map((v: any, i: number) => (
                <div key={i} className="flex gap-2 text-xs py-0.5">
                  <span className="font-mono text-primary min-w-[140px] truncate">{v.key}</span>
                  <span className="text-muted-foreground truncate">{v.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate ml-2 text-right">{value ?? "—"}</span>
    </div>
  );
}
