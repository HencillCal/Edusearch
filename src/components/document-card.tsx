import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Download,
  Eye,
  FileText,
  FolderPlus,
  Loader2,
  Plus,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import type { DocDoc } from "@/lib/edusearch-data";
import type { ApiDocument } from "@/lib/api";
import { apiFetch, downloadUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";

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

export function SaveToCollectionModal({
  documentId,
  documentTitle,
  open,
  onOpenChange,
}: {
  documentId: string;
  documentTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [newCollectionName, setNewCollectionName] = useState("");
  const [creating, setCreating] = useState(false);

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: () =>
      apiFetch<{ collections: Array<{ id: string; name: string; count: number }> }>(
        "/api/collections",
      ),
    enabled: Boolean(auth.data?.user) && open,
  });

  const memberCollectionsQuery = useQuery({
    queryKey: ["document-collections", documentId],
    queryFn: async () => {
      // Find which collections contain this document
      const result = await apiFetch<{ collections: Array<{ id: string; name: string; count: number }> }>(
        "/api/collections",
      );
      const containing: Record<string, boolean> = {};
      await Promise.all(
        result.collections.map(async (c) => {
          try {
            const detail = await apiFetch<{ collection: { id: string }; documents: Array<{ id: string }> }>(
              `/api/collections/${encodeURIComponent(c.id)}`,
            );
            if (detail.documents.some((d) => d.id === documentId)) {
              containing[c.id] = true;
            }
          } catch {}
        }),
      );
      return containing;
    },
    enabled: Boolean(auth.data?.user) && open,
  });

  const toggleCollection = async (collectionId: string, isCurrentlyIn: boolean) => {
    try {
      if (isCurrentlyIn) {
        await apiFetch(`/api/collections/${encodeURIComponent(collectionId)}/documents`, {
          method: "DELETE",
          body: JSON.stringify({ documentId }),
        });
        toast.success("Removed from collection");
      } else {
        await apiFetch(`/api/collections/${encodeURIComponent(collectionId)}/documents`, {
          method: "POST",
          body: JSON.stringify({ documentId }),
        });
        toast.success("Saved to collection");
      }
      await queryClient.invalidateQueries({ queryKey: ["document-collections", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update collection");
    }
  };

  const createCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ collection: { id: string; name: string } }>("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name: newCollectionName.trim() }),
      });
      // Add document to the new collection immediately
      await apiFetch(`/api/collections/${encodeURIComponent(res.collection.id)}/documents`, {
        method: "POST",
        body: JSON.stringify({ documentId }),
      });
      toast.success(`Created "${res.collection.name}" and added document`);
      setNewCollectionName("");
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      await queryClient.invalidateQueries({ queryKey: ["document-collections", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create collection");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Save to Collections</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground line-clamp-1">
            {cleanDocumentTitle(documentTitle)}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
            {collectionsQuery.isLoading && (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading collections...
              </div>
            )}
            {collectionsQuery.data?.collections.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No collections created yet. Create your first folder below!
              </p>
            )}
            {collectionsQuery.data?.collections.map((collection) => {
              const isIn = Boolean(memberCollectionsQuery.data?.[collection.id]);
              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => toggleCollection(collection.id, isIn)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    isIn
                      ? "border-brand bg-brand-soft/60 text-brand font-medium"
                      : "border-border bg-surface hover:border-brand/40 text-foreground"
                  }`}
                >
                  <span className="truncate pr-2">📁 {collection.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{collection.count ?? 0} docs</span>
                    <span
                      className={`grid size-5 place-items-center rounded border ${
                        isIn ? "border-brand bg-brand text-brand-foreground" : "border-border bg-background"
                      }`}
                    >
                      {isIn && <Check className="size-3.5" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <form onSubmit={createCollection} className="flex items-center gap-2 border-t border-border pt-3">
            <input
              type="text"
              placeholder="New collection name (e.g. AI Exam Prep)"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-xs outline-none focus:border-brand"
            />
            <Button type="submit" size="sm" disabled={!newCollectionName.trim() || creating} className="h-9 px-3 text-xs">
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="mr-1 size-3.5" />} Add
            </Button>
          </form>
        </div>

        <DialogFooter className="mt-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const auth = useAuth();
  const apiDoc = doc as ApiDocument;
  const viewerSearch = apiDoc.matchPage ? { page: apiDoc.matchPage, q: apiDoc.matchQuery } : {};
  const displayTitle = cleanDocumentTitle(doc.title);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const toggleSave = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!auth.data?.user) {
      toast.error("Log in to save documents to your library");
      return;
    }
    setSaveModalOpen(true);
  };

  const share = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = new URL(`/document/${doc.id}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: displayTitle, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Document link copied");
      }
    } catch {}
  };

  const thumbnailUrl = apiDoc.thumbnailUrl || `/api/documents/${doc.id}/thumbnail`;

  return (
    <>
      <article className="card-lift group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card shadow-soft transition hover:border-brand/40 hover:shadow-md">
        {/* Cover Preview Image */}
        <Link
          to="/document/$id"
          params={{ id: doc.id }}
          search={viewerSearch}
          className="relative aspect-[3/4] w-full overflow-hidden bg-muted/20 border-b border-border/40"
        >
          {!imgError ? (
            <img
              src={thumbnailUrl}
              alt={doc.title}
              loading="lazy"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center bg-gradient-to-b from-muted/30 to-muted/10">
              <FileText className="size-10 text-brand/60 mb-2" />
              <span className="font-display font-semibold text-xs line-clamp-2 px-2 text-foreground/80">
                {displayTitle}
              </span>
              <span className="mt-1 text-[11px] text-muted-foreground">
                {doc.docType} · {doc.pages} pages
              </span>
            </div>
          )}

          {/* Quick Floating Badge */}
          <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
            <span className="rounded bg-background/90 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm">
              {doc.docType || "Notes"}
            </span>
          </div>

          <div className="absolute top-2.5 right-2.5">
            <button
              type="button"
              onClick={toggleSave}
              title={apiDoc.isSaved ? "Saved in Library" : "Save to Library / Collection"}
              className="grid size-7 place-items-center rounded-full bg-background/90 backdrop-blur-sm text-foreground shadow-sm transition hover:scale-110 hover:text-brand"
            >
              {apiDoc.isSaved ? (
                <BookmarkCheck className="size-4 text-brand fill-brand/20" />
              ) : (
                <Bookmark className="size-4" />
              )}
            </button>
          </div>
        </Link>

        {/* Card Body */}
        <div className="flex flex-1 flex-col justify-between p-3.5">
          <div>
            <Link
              to="/document/$id"
              params={{ id: doc.id }}
              search={viewerSearch}
              title={doc.title}
              className="line-clamp-2 font-display text-sm font-semibold leading-snug text-foreground hover:text-brand transition"
            >
              {displayTitle}
            </Link>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal border-border/80">
                {doc.subject}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {doc.year ? `${doc.year} · ` : ""}
                {doc.pages} {doc.pages === 1 ? "page" : "pages"}
              </span>
              {doc.institution && doc.institution !== "Unknown" && (
                <span className="truncate max-w-[120px] text-[10px] text-muted-foreground/80">
                  · {doc.institution}
                </span>
              )}
            </div>

            {/* Exact Content Search Snippet only when explicitly needed */}
            {showSnippet && doc.snippet && (
              <div className="mt-2 rounded border-l-2 border-brand bg-surface px-2 py-1 text-[11px]">
                {apiDoc.matchPage && (
                  <span className="font-semibold text-brand">Page {apiDoc.matchPage}: </span>
                )}
                <span className="line-clamp-2 italic text-foreground/80">{doc.snippet}</span>
              </div>
            )}
          </div>

          {/* Quick Actions Footer */}
          <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2">
            <div className="flex gap-1.5">
              <Button asChild size="sm" variant="default" className="h-7 px-2.5 text-xs font-medium">
                <Link to="/document/$id" params={{ id: doc.id }} search={viewerSearch}>
                  <Eye className="mr-1 size-3.5" /> View
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs font-normal">
                <a href={downloadUrl(doc.id, doc.fileType === "DOCX")}>
                  <Download className="mr-1 size-3.5" /> PDF
                </a>
              </Button>
            </div>

            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-md text-muted-foreground hover:text-foreground"
                onClick={share}
                title="Share link"
              >
                <Share2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </article>

      <SaveToCollectionModal
        documentId={doc.id}
        documentTitle={doc.title}
        open={saveModalOpen}
        onOpenChange={setSaveModalOpen}
      />
    </>
  );
}

export function CompactDocumentCard({ doc }: { doc: DocDoc | ApiDocument }) {
  const displayTitle = cleanDocumentTitle(doc.title);
  const apiDoc = doc as ApiDocument;
  const thumbnailUrl = apiDoc.thumbnailUrl || `/api/documents/${doc.id}/thumbnail`;
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      to="/document/$id"
      params={{ id: doc.id }}
      className="card-lift flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 shadow-soft transition hover:border-brand/40"
    >
      <div className="relative aspect-[3/4] w-12 shrink-0 overflow-hidden rounded bg-muted/20 border border-border/50">
        {!imgError ? (
          <img
            src={thumbnailUrl}
            alt={doc.title}
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <FileText className="size-5 text-brand/60" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-display text-xs font-semibold leading-snug">
          {displayTitle}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
          {doc.docType} · {doc.subject} · {doc.pages}p
        </p>
      </div>
    </Link>
  );
}
