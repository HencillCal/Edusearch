import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { documentTypes, searchDocuments, subjects, suggestionSeeds } from "@/lib/edusearch-data";
import { apiFetch, type SearchResponse } from "@/lib/api";
import { SearchAutocomplete } from "@/components/search-autocomplete";

type SearchParams = { q?: string };

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Search academic documents — EduSearch AI" },
      {
        name: "description",
        content:
          "Search results across past papers, notes, marking schemes and practical manuals with optional filters.",
      },
      { property: "og:title", content: "Search academic documents — EduSearch AI" },
      {
        property: "og:description",
        content: "Full-text, synonym and fuzzy search across the EduSearch AI library.",
      },
    ],
  }),
  component: SearchPage,
});

const years = [2026, 2025, 2024, 2023];
const fileTypes = ["PDF", "DOCX", "Image"];

function SearchPage() {
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate();
  const [input, setInput] = useState(q);
  const [type, setType] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [sort, setSort] = useState<"relevance" | "recent" | "downloads">("relevance");

  useEffect(() => setInput(q), [q]);

  const params = new URLSearchParams({ q, sort });
  if (type) params.set("docType", type);
  if (year) params.set("year", String(year));
  if (fileType) params.set("fileType", fileType);

  const initialResults = searchDocuments(q)
    .filter((document) => !type || document.docType === type)
    .filter((document) => !year || document.year === year)
    .filter((document) => !fileType || document.fileType === fileType);

  const searchQuery = useQuery({
    queryKey: ["search", q, type, year, fileType, sort],
    queryFn: () => apiFetch<SearchResponse>(`/api/search?${params.toString()}`),
    enabled: typeof window !== "undefined",
    placeholderData: (previous) => previous,
    initialData: {
      query: q,
      count: initialResults.length,
      expandedTerms: [],
      correction: null,
      semantic: { enabled: false, used: false },
      results: initialResults,
      suggestions: suggestionSeeds,
    },
  });
  const results = searchQuery.data.results;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SearchAutocomplete
          value={input}
          onChange={setInput}
          onSubmit={(value) => navigate({ to: "/search", search: { q: value } })}
          wrapperClassName="mb-6 md:hidden"
          placeholder="Search course, topic or question"
          inputClassName="h-12 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-brand"
        />

        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="lg:w-64 lg:shrink-0">
            <p className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="size-4" /> Filters
            </p>
            <FilterGroup
              title="Document type"
              options={documentTypes}
              value={type}
              onChange={(value) => setType(value as string | null)}
            />
            <FilterGroup
              title="Year"
              options={years}
              value={year}
              onChange={(value) => setYear(value as number | null)}
            />
            <FilterGroup
              title="File type"
              options={fileTypes}
              value={fileType}
              onChange={(value) => setFileType(value as string | null)}
            />
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Subject
              </p>
              <div className="flex flex-wrap gap-1.5">
                {subjects.slice(0, 6).map((subject) => (
                  <Link key={subject.name} to="/search" search={{ q: subject.name }}>
                    <Badge variant="outline" className="cursor-pointer hover:border-brand">
                      {subject.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl">{q ? <>Results for “{q}”</> : "All documents"}</h1>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  {searchQuery.isFetching && <Loader2 className="size-3.5 animate-spin" />}
                  {results.length} document{results.length === 1 ? "" : "s"} · full-text, synonym
                  and fuzzy matches
                </p>
                {searchQuery.data.expandedTerms.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Related terms: {searchQuery.data.expandedTerms.slice(0, 6).join(", ")}
                  </p>
                )}
                {searchQuery.data.correction && (
                  <p className="mt-1 text-xs text-brand">
                    Showing corrected matches for “{searchQuery.data.correction}”.
                  </p>
                )}
                {searchQuery.data.semantic?.used && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Semantic matches were added from the configured embedding model.
                  </p>
                )}
              </div>
              <div className="flex gap-1.5">
                {(["relevance", "recent", "downloads"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={sort === value ? "default" : "outline"}
                    onClick={() => setSort(value)}
                  >
                    {value === "downloads"
                      ? "Most downloaded"
                      : value === "recent"
                        ? "Recent"
                        : "Relevance"}
                  </Button>
                ))}
              </div>
            </div>

            {searchQuery.isError ? (
              <div className="rounded-xl border border-destructive/40 bg-card p-8 text-center text-sm text-destructive">
                {searchQuery.error.message}
              </div>
            ) : results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
                <p className="font-display text-lg font-semibold">
                  No documents matched that search
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  This missing-document search has been logged for administrators. Try one of these
                  instead:
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {(searchQuery.data.suggestions.length
                    ? searchQuery.data.suggestions
                    : suggestionSeeds
                  ).map((suggestion) => (
                    <Link key={suggestion} to="/search" search={{ q: suggestion }}>
                      <Badge variant="secondary" className="cursor-pointer">
                        {suggestion}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
                {results.map((document) => (
                  <DocumentCard key={document.id} doc={document} showSnippet />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function FilterGroup<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: T[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={String(option)}
            onClick={() => onChange(value === option ? null : option)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              value === option
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-card text-muted-foreground hover:border-brand"
            }`}
          >
            {String(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
