import { useEffect, useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { ChevronRight, RefreshCcw, Home, FileText, Folder, Trash2, Download, FolderPlus, Edit, Archive, ArchiveRestore, Cloud } from "lucide-react";
import { toast } from "sonner";

type Entry = { name: string; is_dir: boolean; size: number; modified: string };

export function FilesPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [path, setPath] = useState<string>("C:\\");
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);

  const load = async (p: string) => {
    setLoading(true);
    try {
      const res = await send("fs.list", { path: p }, 15000);
      if (res.status === "error") throw new Error(res.error ?? "list failed");
      setItems((res.result?.entries ?? []) as Entry[]);
      setPath(res.result?.path ?? p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (entry: Entry) => {
    if (entry.is_dir) {
      const sep = path.endsWith("\\") || path.endsWith("/") ? "" : "\\";
      load(path + sep + entry.name);
    } else {
      readFile(entry);
    }
  };

  const readFile = async (entry: Entry) => {
    try {
      const sep = path.endsWith("\\") || path.endsWith("/") ? "" : "\\";
      const full = path + sep + entry.name;
      const res = await send("fs.read", { path: full }, 20000);
      if (res.status === "error") throw new Error(res.error ?? "read failed");
      setPreview({ name: entry.name, content: res.result?.content ?? "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Read failed");
    }
  };

  const remove = async (entry: Entry) => {
    if (!confirm(`Delete ${entry.name}?`)) return;
    const sep = path.endsWith("\\") || path.endsWith("/") ? "" : "\\";
    try {
      const res = await send("fs.delete", { path: path + sep + entry.name });
      if (res.status === "error") throw new Error(res.error ?? "delete failed");
      toast.success("Deleted");
      load(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const up = () => {
    const norm = path.replace(/[\\/]+$/, "");
    const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    if (idx <= 2) load(norm.slice(0, idx + 1) || "C:\\");
    else load(norm.slice(0, idx));
  };

  const sep = () => (path.endsWith("\\") || path.endsWith("/") ? "" : "\\");

  const mkdir = async () => {
    const name = prompt("New folder name:");
    if (!name) return;
    try {
      const res = await send("fs.mkdir", { path: path + sep() + name });
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success("Folder created"); load(path);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const rename = async (entry: Entry) => {
    const newName = prompt("Rename to:", entry.name);
    if (!newName || newName === entry.name) return;
    try {
      const res = await send("fs.rename", { from: path + sep() + entry.name, to: path + sep() + newName });
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success("Renamed"); load(path);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const zip = async (entry: Entry) => {
    try {
      const res = await send("fs.zip", { path: path + sep() + entry.name });
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`Zipped to ${res.result?.dest}`); load(path);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const unzip = async (entry: Entry) => {
    try {
      const res = await send("fs.unzip", { path: path + sep() + entry.name });
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success(`Extracted to ${res.result?.dest}`); load(path);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const downloadToBrowser = async (entry: Entry) => {
    try {
      const res = await send("fs.upload", { path: path + sep() + entry.name }, 60000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      const b64 = res.result?.data_b64;
      if (!b64) throw new Error("no data");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement("a");
      a.href = url; a.download = entry.name; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${entry.name}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const downloadFromUrl = async () => {
    const url = prompt("Download URL:");
    if (!url) return;
    const name = prompt("Save as (filename):", url.split("/").pop() || "download");
    if (!name) return;
    try {
      const res = await send("fs.download", { url, dest: path + sep() + name }, 120000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      toast.success("Downloaded to remote"); load(path);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2 backdrop-blur-xl">
        <button onClick={() => load("C:\\")} className="rounded-md border border-border/60 p-1.5 hover:bg-accent">
          <Home className="h-3.5 w-3.5" />
        </button>
        <button onClick={up} className="rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent">
          Up
        </button>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(path)}
          className="flex-1 rounded-md border border-border/60 bg-input/60 px-3 py-1.5 font-mono text-xs outline-none"
        />
        <button
          onClick={() => load(path)}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent"
        >
          <RefreshCcw className="h-3 w-3" /> Refresh
        </button>
        <button onClick={mkdir} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent">
          <FolderPlus className="h-3 w-3" /> New Folder
        </button>
        <button onClick={downloadFromUrl} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent">
          <Cloud className="h-3 w-3" /> Download URL
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Modified</th>
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
              items.map((e) => (
                <tr key={e.name} className="border-t border-border/40 hover:bg-muted/20">
                  <td
                    className="cursor-pointer px-4 py-2"
                    onClick={() => open(e)}
                  >
                    <div className="flex items-center gap-2">
                      {e.is_dir ? (
                        <Folder className="h-4 w-4 text-sky-400" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span>{e.name}</span>
                      {e.is_dir && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {e.is_dir ? "—" : formatBytes(e.size)}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {e.modified ? new Date(e.modified).toLocaleString() : ""}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!e.is_dir && (
                      <>
                        <button
                          onClick={() => readFile(e)}
                          className="mr-1 rounded-md border border-border/60 p-1 hover:bg-accent"
                          title="Preview"
                        >
                          <FileText className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => downloadToBrowser(e)}
                          className="mr-1 rounded-md border border-border/60 p-1 hover:bg-accent"
                          title="Download to your computer"
                        >
                          <Download className="h-3 w-3" />
                        </button>
                        {e.name.toLowerCase().endsWith(".zip") && (
                          <button
                            onClick={() => unzip(e)}
                            className="mr-1 rounded-md border border-border/60 p-1 hover:bg-accent"
                            title="Extract"
                          >
                            <ArchiveRestore className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => zip(e)}
                      className="mr-1 rounded-md border border-border/60 p-1 hover:bg-accent"
                      title="Zip"
                    >
                      <Archive className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => rename(e)}
                      className="mr-1 rounded-md border border-border/60 p-1 hover:bg-accent"
                      title="Rename"
                    >
                      <Edit className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => remove(e)}
                      className="rounded-md border border-border/60 p-1 text-red-400 hover:bg-red-500/10"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border/60 px-4 py-2 text-sm font-medium">{preview.name}</div>
            <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs">{preview.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
