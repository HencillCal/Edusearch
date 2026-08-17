import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { apiFetch, type AuthUser } from "@/lib/api";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Create an account — EduSearch AI" }] }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await apiFetch<{ user: AuthUser }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      queryClient.setQueryData(["auth", "me"], { user: result.user });
      toast.success("Account created");
      navigate({ to: result.user.role === "admin" ? "/admin" : "/upload" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <h1 className="text-3xl">Create your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Save documents, build collections, upload files and follow topics.
        </p>
        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-xl border border-border bg-card p-6 shadow-soft"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Full name</span>
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Jane Wanjiru"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Email</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Password</span>
            <input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />} Create account
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link to="/login" className="font-medium text-brand">
              Log in
            </Link>
          </p>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
