import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocumentCard } from "@/components/document-card";
import { documents } from "@/lib/edusearch-data";
import { apiFetch, type SearchResponse } from "@/lib/api";

export const Route = createFileRoute("/recent")({
  head: () => ({
    meta: [
      { title: "Recently added documents — EduSearch AI" },
      {
        name: "description",
        content:
          "Newly published past papers, notes, assignments and practical manuals on EduSearch AI.",
      },
    ],
  }),
  component: RecentPage,
});

function RecentPage() {
  const query = useQuery({
    queryKey: ["documents", "recent"],
    queryFn: () => apiFetch<SearchResponse>("/api/search?q=&sort=recent&limit=100"),
    enabled: typeof window !== "undefined",
    initialData: {
      query: "",
      count: documents.length,
      expandedTerms: [],
      results: [...documents].sort((a, b) => a.addedDaysAgo - b.addedDaysAgo),
      suggestions: [],
    },
  });
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl">Recently added</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Freshly reviewed and published documents.
        </p>
        <div className="mt-8 space-y-4">
          {query.data.results.map((document) => (
            <DocumentCard key={document.id} doc={document} />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
