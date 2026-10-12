import { useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Database, RefreshCcw, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function RegistryPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [startupEntries, setStartupEntries] = useState<string>("");
  const [queryKey, setQueryKey] = useState("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
  const [queryResult, setQueryResult] = useState("");
  const [writeName, setWriteName] = useState("");
  const [writeValue, setWriteValue] = useState("");
  const [writeKind, setWriteKind] = useState("String");
  const [delName, setDelName] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const doAction = async (action: string, payload: any = {}) => {
    setLoading(action);
    try {
      const res = await send(action, payload, 15000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      return res.result;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      return null;
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Startup entries */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4 text-primary" /> Startup Registry Entries</div>
          <button onClick={async () => { const r = await doAction("reg.startup_list"); if (r) setStartupEntries(r.entries || JSON.stringify(r, null, 2)); }}
            disabled={loading === "reg.startup_list"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Load
          </button>
        </div>
        {startupEntries && <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{startupEntries}</pre>}
      </div>

      {/* Query key */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="text-sm font-medium mb-2">Read Registry Key</div>
        <div className="flex gap-2">
          <input value={queryKey} onChange={(e) => setQueryKey(e.target.value)}
            className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 font-mono text-xs outline-none" />
          <button onClick={async () => { const r = await doAction("reg.read", { key: queryKey }); if (r) setQueryResult(r.data || JSON.stringify(r, null, 2)); }}
            disabled={loading === "reg.read"}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Read</button>
        </div>
        {queryResult && <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{queryResult}</pre>}
      </div>

      {/* Write value */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4 text-primary" /> Write Registry Value</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input value={queryKey} onChange={(e) => setQueryKey(e.target.value)} placeholder="Key path"
            className="sm:col-span-2 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 font-mono text-xs outline-none" />
          <input value={writeName} onChange={(e) => setWriteName(e.target.value)} placeholder="Name"
            className="rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
          <input value={writeValue} onChange={(e) => setWriteValue(e.target.value)} placeholder="Value"
            className="rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
          <select value={writeKind} onChange={(e) => setWriteKind(e.target.value)}
            className="rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none">
            <option value="String">String</option>
            <option value="DWord">DWord</option>
            <option value="QWord">QWord</option>
            <option value="ExpandString">ExpandString</option>
          </select>
          <button onClick={async () => { const r = await doAction("reg.write", { key: queryKey, name: writeName, value: writeValue, kind: writeKind }); if (r) toast.success("Written"); }}
            disabled={!writeName || loading === "reg.write"}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Write</button>
        </div>
      </div>

      {/* Delete value */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><Trash2 className="h-4 w-4 text-red-400" /> Delete Registry Value</div>
        <div className="mt-2 flex gap-2">
          <input value={delName} onChange={(e) => setDelName(e.target.value)} placeholder="Value name to delete"
            className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 text-xs outline-none" />
          <button onClick={async () => { if (!confirm(`Delete reg value "${delName}"?`)) return; const r = await doAction("reg.delete", { key: queryKey, name: delName }); if (r) toast.success("Deleted"); }}
            disabled={!delName || loading === "reg.delete"}
            className="rounded-md border border-red-500/40 bg-red-500/5 px-4 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">Delete</button>
        </div>
      </div>
    </div>
  );
}
