import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Bookmark,
  FileClock,
  FolderOpen,
  LockKeyhole,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CompactDocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiDocument } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "Saved documents and collections — EduSearch AI" }] }),
  component: SavedPage,
});

type SavedResponse = {
  documents: ApiDocument[];
  collections: Array<{ id: string; name: string; count: number }>;
};

function SavedPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const query = useQuery({
    queryKey: ["saved"],
    queryFn: () => apiFetch<SavedResponse>("/api/saved"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const uploads = useQuery({
    queryKey: ["my-uploads"],
    queryFn: () => apiFetch<{ documents: ApiDocument[] }>("/api/uploads/mine"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const recommendations = useQuery({
    queryKey: ["recommendations"],
    queryFn: () => apiFetch<{ documents: ApiDocument[] }>("/api/recommendations?limit=8"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const followed = useQuery({
    queryKey: ["followed-topics"],
    queryFn: () => apiFetch<{ topics: Array<{ topicName: string }> }>("/api/followed-topics"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const collectionDetail = useQuery({
    queryKey: ["collection", selectedCollectionId],
    queryFn: () =>
      apiFetch<{
        collection: { id: string; name: string; count: number };
        documents: ApiDocument[];
      }>(`/api/collections/${encodeURIComponent(selectedCollectionId)}`),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user && selectedCollectionId),
    retry: false,
  });

  const createCollection = async () => {
    const name = window.prompt("Collection name")?.trim();
    if (!name) return;
    try {
      await apiFetch("/api/collections", { method: "POST", body: JSON.stringify({ name }) });
      toast.success("Collection created");
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create collection");
    }
  };

  const renameCollection = async (id: string, currentName: string) => {
    const name = window.prompt("Collection name", currentName)?.trim();
    if (!name || name === currentName) return;
    try {
      await apiFetch(`/api/collections/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      toast.success("Collection renamed");
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
      await queryClient.invalidateQueries({ queryKey: ["collection", id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename collection");
    }
  };

  const deleteCollection = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}”? Saved documents will remain in your saved list.`))
      return;
    try {
      await apiFetch(`/api/collections/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (selectedCollectionId === id) setSelectedCollectionId("");
      toast.success("Collection deleted");
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete collection");
    }
  };

  const removeFromCollection = async (documentId: string) => {
    if (!selectedCollectionId) return;
    try {
      await apiFetch(`/api/collections/${encodeURIComponent(selectedCollectionId)}/documents`, {
        method: "DELETE",
        body: JSON.stringify({ documentId }),
      });
      toast.success("Document removed from collection");
      await queryClient.invalidateQueries({ queryKey: ["collection", selectedCollectionId] });
      await queryClient.invalidateQueries({ queryKey: ["saved"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove document");
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl">Saved documents</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Save documents and organise revision material into collections.
        </p>

        {!auth.isLoading && !auth.data?.user ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-10 text-center shadow-soft">
            <LockKeyhole className="mx-auto size-8 text-brand" />
            <p className="mt-4 font-display text-lg font-semibold">
              Log in to view saved documents
            </p>
            <Button asChild className="mt-5">
              <Link to="/login">Log in</Link>
            </Button>
          </div>
        ) : (
          <>
            <section className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl">Collections</h2>
                <Button size="sm" variant="outline" onClick={createCollection}>
                  <Plus className="size-4" /> New collection
                </Button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(query.data?.collections ?? []).map((collection) => (
                  <div
                    key={collection.id}
                    className="card-lift rounded-xl border border-border bg-card p-5 shadow-soft"
                  >
                    <FolderOpen className="size-5 text-brand" />
                    <p className="mt-3 font-display text-base font-semibold">{collection.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {collection.count} documents
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setSelectedCollectionId(collection.id)}>
                        Open
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => renameCollection(collection.id, collection.name)}
                        aria-label={`Rename ${collection.name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={() => deleteCollection(collection.id, collection.name)}
                        aria-label={`Delete ${collection.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {selectedCollectionId && (
              <section className="mt-6 rounded-xl border border-brand/30 bg-card p-5 shadow-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl">
                      {collectionDetail.data?.collection.name || "Collection"}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {collectionDetail.data?.collection.count ?? 0} documents
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setSelectedCollectionId("")}
                    aria-label="Close collection"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {collectionDetail.isLoading ? (
                  <p className="mt-5 text-sm text-muted-foreground">Loading collection…</p>
                ) : collectionDetail.data?.documents.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {collectionDetail.data.documents.map((document) => (
                      <div key={document.id}>
                        <CompactDocumentCard doc={document} />
                        <Button
                          className="mt-2 w-full"
                          size="sm"
                          variant="outline"
                          onClick={() => removeFromCollection(document.id)}
                        >
                          Remove from collection
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                    This collection is empty. Add documents from a document details page.
                  </p>
                )}
              </section>
            )}

            <section className="mt-10">
              <div className="flex items-center justify-between">
                <h2 className="text-xl">Recently saved</h2>
                <Button asChild variant="outline" size="sm">
                  <Link to="/search" search={{ q: "" }}>
                    <Bookmark className="size-4" /> Find more
                  </Link>
                </Button>
              </div>
              {query.data?.documents.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {query.data.documents.map((document) => (
                    <CompactDocumentCard key={document.id} doc={document} />
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No saved documents yet.
                </p>
              )}
            </section>

            <section className="mt-10">
              <div className="flex items-center gap-2">
                <BellRing className="size-5 text-brand" />
                <h2 className="text-xl">Followed topics</h2>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(followed.data?.topics ?? []).length ? (
                  followed.data!.topics.map((topic) => (
                    <Link
                      key={topic.topicName}
                      to="/search"
                      search={{ q: topic.topicName }}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-brand hover:text-brand"
                    >
                      {topic.topicName}
                    </Link>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                    You are not following any topics. Open Browse subjects and use the bell buttons.
                  </p>
                )}
              </div>
            </section>

            {(recommendations.data?.documents.length ?? 0) > 0 && (
              <section className="mt-10">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5 text-brand" />
                  <h2 className="text-xl">Recommended for you</h2>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {recommendations.data!.documents.map((document) => (
                    <CompactDocumentCard key={document.id} doc={document} />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-10">
              <div className="flex items-center gap-2">
                <FileClock className="size-5 text-brand" />
                <h2 className="text-xl">My document contributions</h2>
              </div>
              <div className="mt-4 space-y-3">
                {uploads.data?.documents.length ? (
                  uploads.data.documents.map((document) => (
                    <article
                      key={document.id}
                      className="rounded-xl border border-border bg-card p-4 shadow-soft"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          {document.status === "published" ? (
                            <Link
                              to="/document/$id"
                              params={{ id: document.id }}
                              className="font-display font-semibold hover:text-brand"
                            >
                              {document.title}
                            </Link>
                          ) : (
                            <p className="font-display font-semibold">{document.title}</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {document.subject} · {document.docType} · {document.fileType}
                          </p>
                        </div>
                        <Badge
                          variant={
                            document.status === "published"
                              ? "secondary"
                              : document.status === "rejected"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {document.status?.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      {document.rejectionReason && (
                        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          Reason: {document.rejectionReason}
                        </p>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    You have not submitted documents yet.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
