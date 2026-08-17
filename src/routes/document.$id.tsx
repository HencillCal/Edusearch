import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  FolderPlus,
  Loader2,
  Maximize2,
  Printer,
  Search,
  Share2,
  Scale,
  Star,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CompactDocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PromptModal, type PromptModalState } from "@/components/ui/prompt-dialog";
import { documents, getDocument } from "@/lib/edusearch-data";
import { apiFetch, downloadUrl, type ApiDocument, type DocumentSearchResponse } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

type ViewerSearch = { page?: number; q?: string };

export const Route = createFileRoute("/document/$id")({
  validateSearch: (search: Record<string, unknown>): ViewerSearch => ({
    page: Number.isFinite(Number(search.page)) ? Math.max(1, Number(search.page)) : undefined,
    q: typeof search.q === "string" ? search.q.slice(0, 300) : undefined,
  }),
  head: () => ({ meta: [{ title: "Academic document — EduSearch AI" }] }),
  component: DocumentViewer,
});

type DetailResponse = { document: ApiDocument; related: ApiDocument[] };

function DocumentViewer() {
  const { id } = Route.useParams();
  const viewerSearch = Route.useSearch();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<number>(viewerSearch.page ?? 1);
  const [zoom, setZoom] = useState<number>(100);
  const [insideSearch, setInsideSearch] = useState(viewerSearch.q ?? "");
  const [collectionId, setCollectionId] = useState("");
  const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
  const fallback = getDocument(id);
  const detail = useQuery({
    queryKey: ["document", id],
    queryFn: () => apiFetch<DetailResponse>(`/api/documents/${encodeURIComponent(id)}`),
    enabled: typeof window !== "undefined",
    initialData: fallback
      ? {
          document: fallback as ApiDocument,
          related: documents.filter((document) => document.id !== id).slice(0, 4) as ApiDocument[],
        }
      : undefined,
    retry: false,
  });
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () =>
      apiFetch<{ collections: Array<{ id: string; name: string; count: number }> }>(
        "/api/collections",
      ),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const insideMatches = useQuery({
    queryKey: ["document-search", id, insideSearch.trim()],
    queryFn: () =>
      apiFetch<DocumentSearchResponse>(
        `/api/documents/${encodeURIComponent(id)}/search?q=${encodeURIComponent(insideSearch.trim())}`,
      ),
    enabled: typeof window !== "undefined" && insideSearch.trim().length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  if (detail.isLoading || !detail.data) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="grid min-h-[60vh] place-items-center">
          <Loader2 className="size-8 animate-spin text-brand" />
        </main>
        <SiteFooter />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <h1 className="text-3xl">Document unavailable</h1>
          <p className="mt-3 text-sm text-muted-foreground">{detail.error.message}</p>
          <Button asChild className="mt-6">
            <Link to="/search" search={{ q: "" }}>
              Search documents
            </Link>
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const doc = detail.data.document;
  const related = detail.data.related;
  const safePage = Math.min(Math.max(1, page), Math.max(1, doc.pages));
  const preview = `${downloadUrl(doc.id, true)}#page=${safePage}&zoom=${zoom}`;

  const toggleSave = async () => {
    if (!auth.data?.user) return toast.error("Log in to save documents");
    try {
      if (doc.isSaved) {
        await apiFetch(`/api/saved/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
        toast.success("Document removed from saved list");
      } else {
        await apiFetch(`/api/saved/${encodeURIComponent(doc.id)}`, { method: "POST" });
        toast.success("Document saved");
      }
      await queryClient.invalidateQueries({ queryKey: ["document", id] });
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save document");
    }
  };

  const addToCollection = async () => {
    if (!collectionId) return toast.error("Choose a collection");
    try {
      await apiFetch(`/api/collections/${encodeURIComponent(collectionId)}/documents`, {
        method: "POST",
        body: JSON.stringify({ documentId: doc.id }),
      });
      toast.success("Document added to collection");
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add document to collection");
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: doc.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Document link copied");
      }
    } catch {
      // Native share may be cancelled.
    }
  };

  const rate = async (rating: number) => {
    if (!auth.data?.user) return toast.error("Log in to rate documents");
    try {
      await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}/rating`, {
        method: "POST",
        body: JSON.stringify({ rating }),
      });
      toast.success(`Rated ${rating} out of 5`);
      await queryClient.invalidateQueries({ queryKey: ["document", id] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save rating");
    }
  };

  const report = () => {
    setPromptModal({
      open: true,
      title: "Report Document",
      fields: [
        {
          name: "reason",
          label: "Report Reason",
          type: "select",
          options: [
            "poor_quality",
            "copyright",
            "wrong_document",
            "missing_pages",
            "incorrect_ocr",
            "personal_information",
            "malware",
            "other",
          ],
          defaultValue: "poor_quality",
        },
        {
          name: "details",
          label: "Additional Details (optional)",
          type: "textarea",
          placeholder: "Describe the issue with this document...",
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const reason = values.reason || "poor_quality";
        const details = values.details?.trim() || "";
        try {
          await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}/report`, {
            method: "POST",
            body: JSON.stringify({ reason, details }),
          });
          toast.success("Report submitted for review");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not submit report");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl">{doc.title}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{doc.docType}</Badge>
              <Badge variant="outline">{doc.subject}</Badge>
              <Badge variant="outline">{doc.level}</Badge>
              <Badge variant="outline">{doc.year}</Badge>
              <Badge variant="outline">{doc.language}</Badge>
              {doc.libraryName && (
                <Badge variant="outline">
                  {doc.visibility === "library" ? "Members only" : "Library"}: {doc.libraryName}
                </Badge>
              )}
              {doc.rightsStatus === "claimed" && (
                <Badge variant="outline">Rights review pending</Badge>
              )}
              {auth.data?.user?.role === "admin" &&
                doc.rightsStatus &&
                doc.rightsStatus !== "clear" && (
                  <Badge variant="destructive">Rights: {doc.rightsStatus}</Badge>
                )}
            </div>

            <div className="mt-6 rounded-xl border border-border bg-card shadow-soft">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {safePage} of {doc.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(doc.pages, value + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom((value) => (value >= 175 ? 75 : value + 25))}
                  >
                    <ZoomIn className="size-4" /> {zoom}%
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => iframeRef.current?.requestFullscreen()}
                  >
                    <Maximize2 className="size-4" /> Full screen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => document.getElementById("inside-search")?.focus()}
                  >
                    <Search className="size-4" /> Search inside
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      window.open(downloadUrl(doc.id, true), "_blank", "noopener,noreferrer")
                    }
                  >
                    <Printer className="size-4" /> Print
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-[110px_1fr]">
                <div className="hidden gap-2 sm:grid">
                  {Array.from({ length: Math.min(doc.pages, 8) }).map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setPage(index + 1)}
                      className={`grid h-28 place-items-center rounded-md border text-xs ${safePage === index + 1 ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-muted-foreground"}`}
                    >
                      Page {index + 1}
                    </button>
                  ))}
                </div>
                <iframe
                  ref={iframeRef}
                  key={preview}
                  title={`${doc.title} preview`}
                  src={preview}
                  className="h-[72vh] min-h-[620px] w-full rounded-lg border border-border bg-white"
                />
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-card p-5 shadow-soft">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold">
                  Search extracted document text
                </span>
                <input
                  id="inside-search"
                  value={insideSearch}
                  onChange={(event) => setInsideSearch(event.target.value)}
                  placeholder="Enter an exact question or phrase"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                />
              </label>
              {insideSearch.trim().length >= 2 && (
                <div className="mt-3 space-y-2">
                  {insideMatches.isFetching && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Searching indexed document pages…
                    </p>
                  )}
                  {insideMatches.isError && (
                    <p className="text-sm text-destructive">{insideMatches.error.message}</p>
                  )}
                  {!insideMatches.isFetching && insideMatches.data?.matches.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No indexed match found in this document.
                    </p>
                  )}
                  {insideMatches.data?.matches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => {
                        setPage(match.page);
                        document
                          .querySelector('iframe[title$=" preview"]')
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="block w-full rounded-lg border border-border bg-surface px-3 py-3 text-left transition hover:border-brand hover:bg-brand-soft/40"
                    >
                      <span className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-brand">
                        Page {match.page}
                        {match.heading && (
                          <span className="text-muted-foreground">· {match.heading}</span>
                        )}
                        {match.exact && <Badge variant="secondary">Exact phrase</Badge>}
                      </span>
                      <span className="text-sm leading-relaxed">
                        <HighlightedSnippet value={match.highlightedSnippet} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="lg:w-80 lg:shrink-0">
            <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <div className="space-y-2">
                <Button asChild className="w-full">
                  <a href={downloadUrl(doc.id)}>
                    <Download className="size-4" /> Download {doc.fileType}
                  </a>
                </Button>
                {doc.fileType === "DOCX" && (
                  <Button asChild variant="outline" className="w-full">
                    <a href={downloadUrl(doc.id, true)}>
                      <Download className="size-4" /> Download PDF preview
                    </a>
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={toggleSave}>
                    {doc.isSaved ? (
                      <BookmarkCheck className="size-4" />
                    ) : (
                      <Bookmark className="size-4" />
                    )}{" "}
                    {doc.isSaved ? "Saved" : "Save"}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={share}>
                    <Share2 className="size-4" /> Share
                  </Button>
                </div>
                {auth.data?.user && (
                  <div className="rounded-lg border border-border bg-surface p-3">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Add to collection
                    </label>
                    <div className="mt-2 flex gap-2">
                      <select
                        value={collectionId}
                        onChange={(event) => setCollectionId(event.target.value)}
                        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                      >
                        <option value="">Choose collection</option>
                        {(collections.data?.collections ?? []).map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={addToCollection}
                        aria-label="Add to collection"
                      >
                        <FolderPlus className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">
                        Community rating
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {Number(doc.rating || 0).toFixed(1)} from {doc.ratingCount ?? 0} ratings
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={report}>
                        <Flag className="size-4" /> Report
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/policies" search={{ document: doc.id }}>
                          <Scale className="size-4" /> Copyright
                        </Link>
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1" aria-label="Rate this document">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        type="button"
                        onClick={() => rate(rating)}
                        className="rounded p-1 transition hover:bg-highlight/20"
                        aria-label={`Rate ${rating} out of 5`}
                      >
                        <Star
                          className={`size-5 ${rating <= Number(doc.userRating || 0) ? "fill-highlight text-highlight" : "text-muted-foreground"}`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <dl className="mt-6 space-y-2 text-sm">
                <Meta label="Document type" value={doc.docType} />
                <Meta label="Course / subject" value={doc.subject} />
                <Meta label="Topics" value={doc.topics.join(", ")} />
                <Meta label="Level" value={doc.level} />
                <Meta label="Year" value={String(doc.year)} />
                <Meta label="Pages" value={String(doc.pages)} />
                <Meta label="File size" value={doc.size} />
                <Meta label="Institution" value={doc.institution ?? "Unknown"} />
                {doc.libraryName && (
                  <Meta
                    label="Library access"
                    value={`${doc.libraryName}${doc.visibility === "library" ? " · members only" : ""}`}
                  />
                )}
                <Meta label="Author" value={doc.author ?? "Unknown"} />
                {doc.sourceAttribution && (
                  <Meta label="Source / licence" value={doc.sourceAttribution} />
                )}
                {doc.rightsBasis && doc.rightsBasis !== "unspecified" && (
                  <Meta label="Sharing basis" value={doc.rightsBasis.replaceAll("_", " ")} />
                )}
                <Meta label="Views" value={(doc.views ?? 0).toLocaleString()} />
                <Meta label="Downloads" value={doc.downloads.toLocaleString()} />
              </dl>
            </div>

            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold">Because you viewed this</p>
              <div className="space-y-3">
                {detail.data.related.map((document) => (
                  <CompactDocumentCard key={document.id} doc={document} />
                ))}
              </div>
            </div>
            <Link
              to="/search"
              search={{ q: doc.subject }}
              className="mt-4 inline-block text-sm font-medium text-brand"
            >
              More {doc.subject} documents →
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
      <PromptModal modalState={promptModal} />
    </div>
  );
}

function HighlightedSnippet({ value }: { value: string }) {
  const parts = value.split(/(<mark>|<\/mark>)/g);
  let highlighted = false;
  return parts.map((part, index) => {
    if (part === "<mark>") {
      highlighted = true;
      return null;
    }
    if (part === "</mark>") {
      highlighted = false;
      return null;
    }
    return highlighted ? (
      <mark key={index} className="rounded bg-highlight/35 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    );
  });
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
