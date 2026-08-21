import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Flag,
  FolderPlus,
  Info,
  Layers,
  Loader2,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  Search,
  Share2,
  Star,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CompactDocumentCard, SaveToCollectionModal, cleanDocumentTitle } from "@/components/document-card";
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

function HighlightedSnippet({ value }: { value: string }) {
  if (!value) return null;
  const parts = value.split(/(<mark>.*?<\/mark>)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
          return (
            <mark key={index} className="rounded bg-brand/20 px-1 py-0.5 font-medium text-brand">
              {part.slice(6, -7)}
            </mark>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function DocumentViewer() {
  const { id } = Route.useParams();
  const viewerSearch = Route.useSearch();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [page, setPage] = useState<number>(viewerSearch.page ?? 1);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [showPagesSidebar, setShowPagesSidebar] = useState(false);
  const [showDetailsSidebar, setShowDetailsSidebar] = useState(true);
  const [showSearchDrawer, setShowSearchDrawer] = useState(Boolean(viewerSearch.q));
  const [insideSearch, setInsideSearch] = useState(viewerSearch.q ?? "");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
  const [pdfLoaded, setPdfLoaded] = useState(false);

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
      <div className="min-h-screen flex flex-col bg-background">
        <SiteHeader />
        <main className="grid flex-1 place-items-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-brand" />
            <p className="text-sm">Loading document...</p>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (detail.isError) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-4 py-20 text-center flex-1">
          <h1 className="text-3xl font-display">Document unavailable</h1>
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
  const displayTitle = cleanDocumentTitle(doc.title);

  const zoomParam = zoom === "fit" ? "page-width" : `${zoom}`;
  const previewUrl = `${downloadUrl(doc.id, true)}#page=${safePage}&view=${zoomParam}`;

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: displayTitle, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Document link copied");
      }
    } catch {}
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
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 flex-1 flex flex-col">
        {/* Document Title Header */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-display font-semibold text-foreground truncate">
              {displayTitle}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-medium">
                {doc.docType}
              </Badge>
              <Badge variant="outline" className="px-2 py-0.5 text-[11px]">
                {doc.subject}
              </Badge>
              <span>{doc.year ? `${doc.year} · ` : ""}{doc.pages} pages</span>
              {doc.institution && doc.institution !== "Unknown" && (
                <span>· {doc.institution}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" className="h-8 px-3 text-xs" asChild>
              <a href={downloadUrl(doc.id, doc.fileType === "DOCX")}>
                <Download className="mr-1.5 size-3.5" /> Download {doc.fileType}
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={() => setSaveModalOpen(true)}
            >
              {doc.isSaved ? (
                <BookmarkCheck className="mr-1.5 size-3.5 text-brand fill-brand/20" />
              ) : (
                <Bookmark className="mr-1.5 size-3.5" />
              )}
              {doc.isSaved ? "Saved" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={share} title="Share">
              <Share2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Main Viewer & Collapsible Sidebars Grid */}
        <div className="relative flex flex-1 flex-col lg:flex-row gap-4 min-h-[680px]">
          {/* Main PDF Viewer Pane */}
          <div className="relative flex flex-1 flex-col min-w-0 rounded-xl border border-border bg-card shadow-soft overflow-hidden">
            {/* Viewer Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-surface/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5">
                {/* Toggle Thumbnail Sidebar */}
                <Button
                  variant={showPagesSidebar ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs font-normal"
                  onClick={() => setShowPagesSidebar((v) => !v)}
                  title="Toggle page thumbnails"
                >
                  <Layers className="mr-1 size-3.5" /> Pages
                </Button>

                {/* Page Navigation */}
                <div className="flex items-center gap-1 border-l border-border/60 pl-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={safePage <= 1}
                    onClick={() => setPage((v) => Math.max(1, v - 1))}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">
                    {safePage} / {doc.pages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={safePage >= doc.pages}
                    onClick={() => setPage((v) => Math.min(doc.pages, v + 1))}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Center/Right Toolbar Actions */}
              <div className="flex items-center gap-1.5">
                {/* Search Document inside button */}
                <Button
                  variant={showSearchDrawer ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs font-normal"
                  onClick={() => setShowSearchDrawer((v) => !v)}
                >
                  <Search className="mr-1 size-3.5" /> Search
                </Button>

                {/* Fit Width / Zoom */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs font-normal"
                  onClick={() => setZoom((z) => (z === "fit" ? 100 : z === 100 ? 125 : z === 125 ? 150 : "fit"))}
                  title="Zoom level"
                >
                  <ZoomIn className="mr-1 size-3.5" /> {zoom === "fit" ? "Fit width" : `${zoom}%`}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => iframeRef.current?.requestFullscreen()}
                  title="Full screen"
                >
                  <Maximize2 className="size-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => window.open(downloadUrl(doc.id, true), "_blank", "noopener,noreferrer")}
                  title="Print"
                >
                  <Printer className="size-3.5" />
                </Button>

                {/* Toggle Details Sidebar */}
                <Button
                  variant={showDetailsSidebar ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs font-normal hidden lg:flex"
                  onClick={() => setShowDetailsSidebar((v) => !v)}
                  title="Toggle details sidebar"
                >
                  <Info className="mr-1 size-3.5" /> Details
                </Button>
              </div>
            </div>

            {/* Viewer Workspace with optional Thumbnail Rail and Search Overlay */}
            <div className="relative flex flex-1 min-h-[580px] overflow-hidden bg-muted/20">
              {/* Optional Thin Thumbnail Rail (112px) */}
              {showPagesSidebar && (
                <aside className="w-28 shrink-0 border-r border-border bg-card/60 p-2 overflow-y-auto space-y-2 overscroll-contain">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase px-1 pb-1">
                    Pages ({doc.pages})
                  </div>
                  {Array.from({ length: doc.pages }).map((_, idx) => {
                    const pageNum = idx + 1;
                    const isCurrent = pageNum === safePage;
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setPage(pageNum)}
                        className={`flex flex-col items-center w-full rounded border p-1 transition ${
                          isCurrent
                            ? "border-brand bg-brand-soft/80 text-brand ring-1 ring-brand"
                            : "border-border/60 bg-surface hover:border-brand/40 text-muted-foreground"
                        }`}
                      >
                        <div className="aspect-[3/4] w-full rounded bg-muted/30 grid place-items-center border border-border/30">
                          <FileText className="size-4 opacity-40" />
                        </div>
                        <span className="mt-1 text-[10px] font-medium">{pageNum}</span>
                      </button>
                    );
                  })}
                </aside>
              )}

              {/* Main Reading Canvas / Iframe */}
              <div className="relative flex-1 min-w-0 overflow-x-hidden overflow-y-auto flex items-center justify-center p-2 sm:p-4 bg-muted/10">
                {!pdfLoaded && (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-background/50 backdrop-blur-xs">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-6 animate-spin text-brand" />
                      <span className="text-xs text-muted-foreground font-medium">Loading page 1...</span>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  key={previewUrl}
                  title={`${doc.title} preview`}
                  src={previewUrl}
                  onLoad={() => setPdfLoaded(true)}
                  className="h-full w-full min-h-[580px] rounded-lg border border-border bg-white shadow-inner"
                  style={{ minWidth: 0, maxWidth: "100%" }}
                />
              </div>

              {/* Search Inside Document Slide-Over Panel */}
              {showSearchDrawer && (
                <div className="absolute top-0 right-0 z-20 h-full w-80 max-w-[90vw] border-l border-border bg-card shadow-lg flex flex-col">
                  <div className="flex items-center justify-between border-b border-border p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Search className="size-3.5 text-brand" /> Search in Document
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-md"
                      onClick={() => setShowSearchDrawer(false)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>

                  <div className="p-3 border-b border-border/60">
                    <input
                      value={insideSearch}
                      onChange={(e) => setInsideSearch(e.target.value)}
                      placeholder="Type a word or phrase..."
                      className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-xs outline-none focus:border-brand"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {insideSearch.trim().length < 2 && (
                      <p className="text-center py-6 text-xs text-muted-foreground">
                        Type at least 2 letters to find matches across all pages.
                      </p>
                    )}
                    {insideMatches.isFetching && (
                      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                        <Loader2 className="mr-2 size-3.5 animate-spin" /> Searching indexed pages...
                      </div>
                    )}
                    {!insideMatches.isFetching && insideSearch.trim().length >= 2 && insideMatches.data?.matches.length === 0 && (
                      <p className="text-center py-6 text-xs text-muted-foreground">
                        No matches found in this document.
                      </p>
                    )}
                    {insideMatches.data?.matches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => setPage(match.page)}
                        className="w-full text-left rounded-lg border border-border bg-surface p-2.5 transition hover:border-brand hover:bg-brand-soft/30"
                      >
                        <div className="flex items-center justify-between text-[11px] font-semibold text-brand mb-1">
                          <span>Page {match.page}</span>
                          {match.heading && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                              {match.heading}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed line-clamp-3 text-foreground/90">
                          <HighlightedSnippet value={match.highlightedSnippet} />
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Metadata & Community Sidebar */}
          {showDetailsSidebar && (
            <aside className="w-full lg:w-72 lg:shrink-0 space-y-4">
              {/* Meaningful Metadata Card (hides Unknown/Unspecified noise) */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Document Details
                </h3>

                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="font-medium text-foreground">{doc.docType}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <dt className="text-muted-foreground">Subject</dt>
                    <dd className="font-medium text-foreground truncate max-w-[140px]">{doc.subject}</dd>
                  </div>
                  {doc.topics && doc.topics.length > 0 && (
                    <div className="py-1 border-b border-border/40">
                      <dt className="text-muted-foreground mb-1">Topics</dt>
                      <dd className="flex flex-wrap gap-1">
                        {doc.topics.slice(0, 3).map((topic) => (
                          <Badge key={topic} variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {topic}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <dt className="text-muted-foreground">Pages</dt>
                    <dd className="font-medium text-foreground">{doc.pages}</dd>
                  </div>
                  {doc.year && (
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <dt className="text-muted-foreground">Year</dt>
                      <dd className="font-medium text-foreground">{doc.year}</dd>
                    </div>
                  )}
                  {doc.size && (
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <dt className="text-muted-foreground">File size</dt>
                      <dd className="font-medium text-foreground">{doc.size}</dd>
                    </div>
                  )}
                  {doc.institution && doc.institution !== "Unknown" && (
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <dt className="text-muted-foreground">Institution</dt>
                      <dd className="font-medium text-foreground truncate max-w-[140px]">{doc.institution}</dd>
                    </div>
                  )}
                  {doc.author && doc.author !== "Unknown" && (
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <dt className="text-muted-foreground">Author</dt>
                      <dd className="font-medium text-foreground truncate max-w-[140px]">{doc.author}</dd>
                    </div>
                  )}
                  <div className="flex justify-between py-1">
                    <dt className="text-muted-foreground">Views / Downloads</dt>
                    <dd className="font-medium text-foreground">{doc.views ?? 0} / {doc.downloads ?? 0}</dd>
                  </div>
                </dl>
              </div>

              {/* Compact Community Rating & Actions Card */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-muted-foreground">Community Rating</span>
                  <span className="text-xs font-medium text-foreground">
                    {Number(doc.rating || 0).toFixed(1)} / 5 ({doc.ratingCount ?? 0})
                  </span>
                </div>

                <div className="flex items-center justify-center gap-1.5 py-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => rate(star)}
                      className="p-1 transition hover:scale-110"
                      title={`Rate ${star} stars`}
                    >
                      <Star
                        className={`size-4 ${
                          (doc.userRating ?? Math.round(doc.rating || 0)) >= star
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/40 hover:text-amber-400"
                        }`}
                      />
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-xs">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={report}>
                    <Flag className="mr-1 size-3 text-muted-foreground" /> Report
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" asChild>
                    <Link to="/policies">Copyright policy</Link>
                  </Button>
                </div>
              </div>

              {/* Recommendations Section */}
              {related && related.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                    Related Documents
                  </h3>
                  <div className="space-y-2">
                    {related.slice(0, 3).map((relDoc) => (
                      <CompactDocumentCard key={relDoc.id} doc={relDoc} />
                    ))}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </main>

      <SiteFooter />

      <SaveToCollectionModal
        documentId={doc.id}
        documentTitle={doc.title}
        open={saveModalOpen}
        onOpenChange={setSaveModalOpen}
      />

      {promptModal && (
        <PromptModal modalState={promptModal} />
      )}
    </div>
  );
}
