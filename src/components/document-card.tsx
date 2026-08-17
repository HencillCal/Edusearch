import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Download, Eye, FileText, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { DocDoc } from "@/lib/edusearch-data";
import type { ApiDocument } from "@/lib/api";
import { apiFetch, downloadUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
      if (navigator.share) await navigator.share({ title: doc.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Document link copied");
      }
    } catch {
      // The native share sheet may be cancelled by the user.
    }
  };

  return (
    <article className="card-lift rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <FileText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to="/document/$id"
            params={{ id: doc.id }}
            search={viewerSearch}
            className="font-display text-lg font-semibold leading-snug hover:text-brand"
          >
            {doc.title}
          </Link>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{doc.docType}</Badge>
            <Badge variant="outline">{doc.subject}</Badge>
            <Badge variant="outline">{doc.year}</Badge>
            <Badge variant="outline">{doc.fileType}</Badge>
            <Badge variant="outline">{doc.pages} pages</Badge>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">{doc.description}</p>

          {showSnippet && doc.snippet && (
            <div className="mt-3 rounded-lg border-l-2 border-highlight bg-surface px-3 py-2">
              {apiDoc.matchPage && (
                <p className="mb-1 text-xs font-semibold text-brand">
                  Matched on page {apiDoc.matchPage}
                  {apiDoc.matchHeading ? ` · ${apiDoc.matchHeading}` : ""}
                </p>
              )}
              <p className="text-sm italic text-foreground/80">{doc.snippet}</p>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Topics: {doc.topics.join(", ")} · {doc.downloads.toLocaleString()} downloads · Preview
            available
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/document/$id" params={{ id: doc.id }} search={viewerSearch}>
                <Eye className="size-4" />{" "}
                {apiDoc.matchPage ? `Open page ${apiDoc.matchPage}` : "View document"}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={downloadUrl(doc.id)}>
                <Download className="size-4" /> Download {doc.fileType}
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleSave}>
              {apiDoc.isSaved ? (
                <BookmarkCheck className="size-4" />
              ) : (
                <Bookmark className="size-4" />
              )}
              {apiDoc.isSaved ? "Saved" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" onClick={share}>
              <Share2 className="size-4" /> Share
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CompactDocumentCard({ doc }: { doc: DocDoc | ApiDocument }) {
  return (
    <Link
      to="/document/$id"
      params={{ id: doc.id }}
      className="card-lift block rounded-xl border border-border bg-card p-4 shadow-soft"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5" /> {doc.fileType} · {doc.pages} pages
      </div>
      <p className="mt-2 font-display text-base font-semibold leading-snug">{doc.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {doc.subject} · {doc.year} · {doc.downloads.toLocaleString()} downloads
      </p>
    </Link>
  );
}
