import { useState } from "react";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Globe, RefreshCcw, BookOpen, History, Users } from "lucide-react";
import { toast } from "sonner";

export function BrowserPanel({ deviceId }: { deviceId: string }) {
  const { send } = useDeviceCommands(deviceId);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [historyData, setHistoryData] = useState("");
  const [bookmarksData, setBookmarksData] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const loadProfiles = async () => {
    setLoading("profiles");
    try {
      const res = await send("browser.profiles", {}, 15000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      const raw = res.result?.profiles ?? "[]";
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      setProfiles(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const loadHistory = async (profilePath: string) => {
    setLoading("history");
    try {
      const res = await send("browser.history", { profile_path: profilePath, limit: 100 }, 20000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setHistoryData(res.result?.history || res.result?.note || JSON.stringify(res.result, null, 2));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const loadBookmarks = async (profilePath: string) => {
    setLoading("bookmarks");
    try {
      const res = await send("browser.bookmarks", { profile_path: profilePath }, 15000);
      if (res.status === "error") throw new Error(res.error ?? "failed");
      setBookmarksData(res.result?.bookmarks || JSON.stringify(res.result, null, 2));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Profiles */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4 text-primary" /> Browser Profiles</div>
          <button onClick={loadProfiles} disabled={loading === "profiles"}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCcw className="h-3 w-3" /> Scan
          </button>
        </div>
        {profiles.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {profiles.map((p, i) => (
              <button key={i} onClick={() => setSelectedProfile(p.path)}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs text-left transition ${selectedProfile === p.path ? "border-primary bg-primary/10" : "border-border/40 hover:bg-muted/20"}`}>
                <Globe className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium">{p.browser}</span>
                <span className="text-muted-foreground">— {p.profile}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedProfile && (
        <>
          {/* History */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><History className="h-4 w-4 text-primary" /> History</div>
              <button onClick={() => loadHistory(selectedProfile)} disabled={loading === "history"}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
                <RefreshCcw className="h-3 w-3" /> Load
              </button>
            </div>
            {historyData && <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{historyData}</pre>}
          </div>

          {/* Bookmarks */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><BookOpen className="h-4 w-4 text-primary" /> Bookmarks</div>
              <button onClick={() => loadBookmarks(selectedProfile)} disabled={loading === "bookmarks"}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
                <RefreshCcw className="h-3 w-3" /> Load
              </button>
            </div>
            {bookmarksData && <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{bookmarksData}</pre>}
          </div>
        </>
      )}
    </div>
  );
}
