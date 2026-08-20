import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Download, Eye, FileText, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { DocDoc } from "@/lib/edusearch-data";
import type { ApiDocument } from "@/lib/api";
import { apiFetch, downloadUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function cleanDocumentTitle(title: string): string {
  if (!title) return "Untitled Document";
  return (
    title
      .replace(/^Copy\s+of\s+/i, "")
      .replace(/^\d+[\.\-_]\s*/, "")
      .replace(/\s*@[A-Za-z0-9_]+/g, "")
      .replace(/\.(pdf|docx?|zip|png|jpe?g)$/i, "")
      .trim() || title
  );
}

export function DocumentCard({
  doc,
  showSnippet = false,
}: {
  doc: DocDoc | ApiDocument;
  showSnippet?: boolean;
}) {
  const queryClient = useQueryClient();
  const apiDoc = doc as ApiDocument;
  const viewerSearch = apiDoc.matchPage ? { page: apiDoc.matchPage, q: apiDoc.matchQuery } : {};
  const displayTitle = cleanDocumentTitle(doc.title);

  const toggleSave = async () => {
    try {
      await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}/save`, {
        method: apiDoc.isSaved ? "DELETE" : "POST",
      });
      toast.success(apiDoc.isSaved ? "Removed from saved documents" : "Document saved");
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save document");
    }
  };

  const share = async () => {
    const url = new URL(`/document/${doc.id}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: displayTitle, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Document link copied");
      }
    } catch {
      // User cancelled native share
    }
  };

  return (
    <article className="card-lift flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-soft transition hover:border-brand/40">
      <div>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              to="/document/$id"
              params={{ id: doc.id }}
              search={viewerSearch}
              title={doc.title}
              className="line-clamp-2 font-display text-base font-semibold leading-snug hover:text-brand"
            >
              {displayTitle}
            </Link>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-medium">
                {doc.docType || "Notes"}
              </Badge>
              <Badge variant="outline" className="px-2 py-0.5 text-[11px]">
                {doc.subject}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {doc.year ? `${doc.year} · ` : ""}
                {doc.pages} {doc.pages === 1 ? "page" : "pages"}
              </span>
            </div>
          </div>
        </div>

        {showSnippet && doc.snippet && (
          <div className="mt-2.5 rounded border-l-2 border-highlight bg-surface px-2.5 py-1 text-xs">
            {apiDoc.matchPage && (
              <span className="font-semibold text-brand">Page {apiDoc.matchPage}: </span>
            )}
            <span className="line-clamp-2 italic text-foreground/80">{doc.snippet}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5">
        <div className="flex gap-1.5">
          <Button asChild size="sm" variant="default" className="h-7 px-2.5 text-xs">
            <Link to="/document/$id" params={{ id: doc.id }} search={viewerSearch}>
              <Eye className="mr-1 size-3.5" /> View
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs">
            <a href={downloadUrl(doc.id)}>
              <Download className="mr-1 size-3.5" /> {doc.fileType}
            </a>
          </Button>
        </div>

        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-md"
            onClick={toggleSave}
            title={apiDoc.isSaved ? "Saved" : "Save document"}
          >
            {apiDoc.isSaved ? (
              <BookmarkCheck className="size-3.5 text-brand" />
            ) : (
              <Bookmark className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-md"
            onClick={share}
            title="Share"
          >
            <Share2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function CompactDocumentCard({ doc }: { doc: DocDoc | ApiDocument }) {
  const displayTitle = cleanDocumentTitle(doc.title);
  return (
    <Link
      to="/document/$id"
      params={{ id: doc.id }}
      className="card-lift block rounded-xl border border-border bg-card p-3.5 shadow-soft transition hover:border-brand/40"
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="size-3 text-brand" />
        <span>
          {doc.fileType} · {doc.pages} pages
        </span>
        <span className="ml-auto font-medium text-foreground">{doc.docType}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 font-display text-sm font-semibold leading-snug">
        {displayTitle}
      </p>
      <p className="mt-1 text-xs text-muted-foreground truncate">
        {doc.subject}
        {doc.year ? ` · ${doc.year}` : ""}
      </p>
    </Link>
  );
}
