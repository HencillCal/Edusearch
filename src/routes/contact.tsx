import { useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Mail, MessageSquare, ShieldAlert } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact EduSearch AI" },
      {
        name: "description",
        content:
          "Contact the EduSearch AI team about documents, copyright requests, corrections or partnerships.",
      },
      { property: "og:title", content: "Contact EduSearch AI" },
      {
        property: "og:description",
        content: "Reach the EduSearch AI team for support, copyright or partnerships.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("Request a missing document");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    try {
      await apiFetch("/api/contact", {
        method: "POST",
        body: JSON.stringify({ email, subject, message }),
      });
      setMessage("");
      toast.success("Your message has been submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit your message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl">Contact us</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Missing a document, spotted an OCR error, or need a takedown? Tell us and we will act
          quickly.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-[1fr_260px]">
          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-soft"
          >
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Your email</span>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Subject</span>
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
              >
                <option>Request a missing document</option>
                <option>Report an OCR or metadata error</option>
                <option>Copyright takedown request</option>
                <option>Partnership</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Message</span>
              <textarea
                rows={5}
                placeholder="Tell us what you need"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                required
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </label>
            <Button type="submit" disabled={sending}>
              {sending && <Loader2 className="size-4 animate-spin" />} Send message
            </Button>
          </form>

          <aside className="space-y-4">
            <InfoCard
              icon={<Mail className="size-4" />}
              title="Email"
              body="support@edusearch.ai"
            />
            <InfoCard
              icon={<ShieldAlert className="size-4" />}
              title="Copyright"
              body="copyright@edusearch.ai"
            />
            <InfoCard
              icon={<MessageSquare className="size-4" />}
              title="Response time"
              body="Within two working days"
            />
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function InfoCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-brand">{icon}</span>
        {title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
