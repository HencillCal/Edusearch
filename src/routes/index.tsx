import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ScanLine, Sparkles, TrendingUp } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CompactDocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { documents, exampleSearches, popularSearches, subjects } from "@/lib/edusearch-data";
import { apiFetch, type HomeResponse } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { SearchAutocomplete } from "@/components/search-autocomplete";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EduSearch AI — Find Any Academic Document" },
      {
        name: "description",
        content:
          "Search past papers, notes, assignments, marking schemes and academic PDFs from one platform. OCR turns exam photos into clean PDF and DOCX files.",
      },
      { property: "og:title", content: "EduSearch AI — Find Any Academic Document" },
      {
        property: "og:description",
        content: "Search any course, topic, question or academic document in one place.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [q, setQ] = useState("");
  const home = useQuery({
    queryKey: ["home"],
    queryFn: () => apiFetch<HomeResponse>("/api/home"),
    enabled: typeof window !== "undefined",
    initialData: {
      trending: [...documents].sort((a, b) => b.downloads - a.downloads).slice(0, 4),
      recent: [...documents].sort((a, b) => a.addedDaysAgo - b.addedDaysAgo).slice(0, 4),
      subjects,
      popularSearches,
      recommendations: [],
    },
  });
  const {
    trending,
    recent,
    subjects: liveSubjects,
    popularSearches: livePopularSearches,
    recommendations = [],
  } = home.data;

  const go = (value: string) => navigate({ to: "/search", search: { q: value } });

  return (
    <div className="min-h-screen">
      <SiteHeader compactSearch={false} />

      <section className="hero-surface border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-highlight" /> Search first, filters second
          </span>
          <h1 className="mt-6 text-4xl leading-tight sm:text-6xl">Find Any Academic Document</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Search past papers, notes, assignments, marking schemes, practical manuals and academic
            PDFs from one platform — no account needed.
          </p>

          <SearchAutocomplete
            value={q}
            onChange={setQ}
            onSubmit={go}
            wrapperClassName="mt-8"
            buttonLabel="Search"
            inputClassName="h-16 w-full rounded-full border border-border bg-card pl-12 pr-36 text-base shadow-lift outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/20"
          />

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {exampleSearches.map((s) => (
              <button
                key={s}
                onClick={() => go(s)}
                className="rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-brand hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 sm:px-6">
        <Section title="Popular searches">
          <div className="flex flex-wrap gap-2">
            {livePopularSearches.map((p) => (
              <button
                key={p}
                onClick={() => go(p)}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-brand hover:text-brand"
              >
                <TrendingUp className="mr-2 inline size-3.5 text-highlight" />
                {p}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Browse by subject" action={{ to: "/subjects", label: "All subjects" }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveSubjects.slice(0, 9).map((s) => (
              <Link
                key={s.name}
                to="/subjects"
                className="card-lift rounded-xl border border-border bg-card p-5 shadow-soft"
              >
                <p className="font-display text-lg font-semibold">{s.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.count.toLocaleString()} documents
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {s.topics.slice(0, 3).join(" · ")}
                </p>
              </Link>
            ))}
          </div>
        </Section>

        <section className="mt-16 overflow-hidden rounded-2xl border border-border bg-brand p-8 text-brand-foreground shadow-lift sm:p-12">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="text-3xl text-brand-foreground">
                Turn a Photo into a Clean PDF or DOCX
              </h2>
              <p className="mt-3 text-sm opacity-90">
                Upload an image of an exam, note or assignment. EduSearch AI will clean, extract and
                organise it — extracting text and reconstructing headings and numbered questions for
                review.
              </p>
            </div>
            <Button asChild size="lg" variant="secondary">
              <Link to="/scanner">
                <ScanLine className="size-4" /> Upload Image
              </Link>
            </Button>
          </div>
        </section>

        <Section title="Trending documents" action={{ to: "/popular", label: "See all" }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {trending.map((d) => (
              <CompactDocumentCard key={d.id} doc={d} />
            ))}
          </div>
        </Section>

        {auth.data?.user && recommendations.length > 0 && (
          <Section title="Recommended for you" action={{ to: "/saved", label: "Your library" }}>
            <p className="-mt-2 mb-5 text-sm text-muted-foreground">
              Based on your followed topics, searches, downloads and saved documents.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recommendations.slice(0, 8).map((document) => (
                <CompactDocumentCard key={document.id} doc={document} />
              ))}
            </div>
          </Section>
        )}

        <Section title="Recently added" action={{ to: "/recent", label: "See all" }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((d) => (
              <CompactDocumentCard key={d.id} doc={d} />
            ))}
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { to: string; label: string };
}) {
  return (
    <section className="mt-16">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="text-2xl">{title}</h2>
        {action && (
          <Link
            to={action.to}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand"
          >
            {action.label} <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
