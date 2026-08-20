import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocumentCard } from "@/components/document-card";
import { documents } from "@/lib/edusearch-data";
import { apiFetch, type SearchResponse } from "@/lib/api";

export const Route = createFileRoute("/popular")({
  head: () => ({
    meta: [
      { title: "Most downloaded academic documents — EduSearch AI" },
      {
        name: "description",
        content:
          "The most viewed and downloaded past papers, notes and marking schemes on EduSearch AI.",
      },
    ],
  }),
  component: PopularPage,
});

function PopularPage() {
  const query = useQuery({
    queryKey: ["documents", "popular"],
    queryFn: () => apiFetch<SearchResponse>("/api/search?q=&sort=downloads&limit=100"),
    enabled: typeof window !== "undefined",
    initialData: {
      query: "",
      count: documents.length,
      expandedTerms: [],
      results: [...documents].sort((a, b) => b.downloads - a.downloads),
      suggestions: [],
    },
  });
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-display font-bold">Popular documents</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ranked by recorded downloads across the platform.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.results.map((document) => (
            <DocumentCard key={document.id} doc={document} />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
