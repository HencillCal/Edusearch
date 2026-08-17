import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bell,
  CheckCheck,
  LogOut,
  Menu,
  ScanLine,
  Search,
  ShieldCheck,
  Upload,
  UserCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchAutocomplete } from "@/components/search-autocomplete";

const navLinks = [
  { to: "/subjects", label: "Browse subjects" },
  { to: "/libraries", label: "Libraries" },
  { to: "/upload", label: "Upload" },
  { to: "/scanner", label: "OCR scanner" },
  { to: "/saved", label: "Saved" },
] as const;

export function SiteHeader({ compactSearch = true }: { compactSearch?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const user = auth.data?.user;
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      apiFetch<{
        unread: number;
        notifications: Array<{
          id: string;
          title: string;
          message: string;
          link?: string;
          readAt?: string | null;
          createdAt: string;
        }>;
      }>("/api/notifications"),
    enabled: typeof window !== "undefined" && Boolean(user),
    refetchInterval: 60_000,
    retry: false,
  });

  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      toast.success("Logged out");
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logout failed");
    }
  };

  const openNotification = async (notification: { id: string; link?: string }) => {
    try {
      await apiFetch(`/api/notifications/${encodeURIComponent(notification.id)}`, {
        method: "PATCH",
      });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      // Navigation is still useful if the read update fails.
    }
    if (notification.link) navigate({ to: notification.link as "/" });
  };

  const markAllRead = async () => {
    try {
      await apiFetch("/api/notifications/read-all", { method: "PATCH" });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update notifications");
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-brand text-brand-foreground">
            <Search className="size-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">EduSearch AI</span>
        </Link>

        {compactSearch && (
          <SearchAutocomplete
            value={q}
            onChange={setQ}
            onSubmit={(value) => navigate({ to: "/search", search: { q: value } })}
            wrapperClassName="hidden max-w-xl flex-1 md:block"
          />
        )}

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {link.label}
            </Link>
          ))}
          {user?.role === "admin" && (
            <Link
              to="/admin"
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {user ? (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label="Notifications"
                  >
                    <Bell className="size-4" />
                    {(notifications.data?.unread ?? 0) > 0 && (
                      <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">
                        {Math.min(notifications.data?.unread ?? 0, 99)}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div>
                      <p className="font-display font-semibold">Notifications</p>
                      <p className="text-xs text-muted-foreground">
                        {notifications.data?.unread ?? 0} unread
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={markAllRead}>
                      <CheckCheck className="size-4" /> Mark read
                    </Button>
                  </div>
                  <div className="max-h-96 overflow-y-auto p-2">
                    {(notifications.data?.notifications ?? []).length ? (
                      notifications.data!.notifications.map((notification) => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => openNotification(notification)}
                          className={`w-full rounded-lg px-3 py-3 text-left transition hover:bg-accent ${notification.readAt ? "opacity-70" : "bg-brand-soft/60"}`}
                        >
                          <p className="text-sm font-semibold">{notification.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {notification.message}
                          </p>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        No notifications yet.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <span className="hidden items-center gap-1.5 text-sm font-medium sm:flex">
                {user.role === "admin" ? (
                  <ShieldCheck className="size-4 text-brand" />
                ) : (
                  <UserCircle className="size-4" />
                )}
                {user.name.split(" ")[0]}
              </span>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="size-4" /> <span className="hidden sm:inline">Logout</span>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link to="/login">Login</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/register">Register</Link>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setOpen((value) => !value)}
          >
            <Menu className="size-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background px-4 py-3 lg:hidden">
          <div className="flex flex-col">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
            {user?.role === "admin" && (
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium"
              >
                Admin dashboard
              </Link>
            )}
            {!user && (
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to="/upload">
          <Upload className="size-4" /> Upload document
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link to="/scanner">
          <ScanLine className="size-4" /> OCR scanner
        </Link>
      </Button>
    </div>
  );
}
