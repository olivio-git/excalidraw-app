import { useAuth } from "@/core/auth/hooks/use-auth";
import { useTabStore } from "@/core/tabs/store/tab-store";

export default function HomePage() {
  const { user } = useAuth();
  const tabs = useTabStore((s) => s.tabs);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome{user ? `, ${user.name}` : ""}</h1>
        <p className="text-muted-foreground mt-1">
          This is the home dashboard of your Base Project shell.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold text-sm text-muted-foreground">Open Tabs</h3>
          <p className="text-2xl font-bold mt-1">{tabs.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold text-sm text-muted-foreground">Pinned Tabs</h3>
          <p className="text-2xl font-bold mt-1">{tabs.filter((t) => t.isPinned).length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold text-sm text-muted-foreground">User Role</h3>
          <p className="text-2xl font-bold mt-1">{user?.roles[0] || "N/A"}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Features</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>- Chrome-like tab bar with drag & drop reordering</li>
          <li>- Tab pinning with context menu</li>
          <li>- React.Activity keep-alive for tab state preservation</li>
          <li>- Dark/Light/System theme with persistence</li>
          <li>- Collapsible sidebar with header groups</li>
          <li>- Route-based tab management with singleton support</li>
          <li>- Plugin system foundation</li>
          <li>- Tauri v2 with persistent storage</li>
        </ul>
      </div>
    </div>
  );
}
