import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Bookmark,
  FileClock,
  FileText,
  FolderOpen,
  LockKeyhole,
  Pencil,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocumentCard, CompactDocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiDocument, type OcrJob } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  PromptModal,
  ConfirmModal,
  type PromptModalState,
  type ConfirmModalState,
} from "@/components/ui/prompt-dialog";

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "My Library — EduSearch AI" }] }),
  component: MyLibraryPage,
});

type SavedResponse = {
  documents: ApiDocument[];
  collections: Array<{ id: string; name: string; count: number }>;
};

function MyLibraryPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"uploads" | "saved" | "collections">("uploads");
  const [uploadFilter, setUploadFilter] = useState<"all" | "documents" | "ocr">("all");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const savedQuery = useQuery({
    queryKey: ["saved"],
    queryFn: () => apiFetch<SavedResponse>("/api/saved"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const uploadsQuery = useQuery({
    queryKey: ["my-uploads"],
    queryFn: () => apiFetch<{ documents: ApiDocument[] }>("/api/uploads/mine"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const ocrJobsQuery = useQuery({
    queryKey: ["ocr-jobs", "mine"],
    queryFn: () => apiFetch<{ jobs: OcrJob[] }>("/api/ocr/jobs"),
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

  const createCollection = () => {
    setPromptModal({
      open: true,
      title: "Create Collection",
      fields: [
        {
          name: "name",
          label: "Collection Name",
          placeholder: "e.g. End of Semester Revision",
          required: true,
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const name = values.name?.trim();
        if (!name) return;
        try {
          await apiFetch("/api/collections", { method: "POST", body: JSON.stringify({ name }) });
          toast.success("Collection created");
          await queryClient.invalidateQueries({ queryKey: ["saved"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not create collection");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const renameCollection = (id: string, currentName: string) => {
    setPromptModal({
      open: true,
      title: "Rename Collection",
      fields: [
        { name: "name", label: "Collection Name", defaultValue: currentName, required: true },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const name = values.name?.trim();
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
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const deleteCollection = (id: string, name: string) => {
    setConfirmModal({
      open: true,
      title: `Delete Collection "${name}"?`,
      description: "Saved documents will remain in your main saved list.",
      destructive: true,
      confirmLabel: "Delete Collection",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/collections/${encodeURIComponent(id)}`, { method: "DELETE" });
          if (selectedCollectionId === id) setSelectedCollectionId("");
          toast.success("Collection deleted");
          await queryClient.invalidateQueries({ queryKey: ["saved"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete collection");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
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

  const userDocuments = uploadsQuery.data?.documents ?? [];
  const userOcrJobs = ocrJobsQuery.data?.jobs ?? [];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">My Library</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Manage your uploaded documents, saved bookmarks, and custom study collections.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link to="/upload">
                <Upload className="mr-1.5 size-4" /> Upload
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/scanner">
                <ScanLine className="mr-1.5 size-4" /> OCR Scanner
              </Link>
            </Button>
          </div>
        </div>

        {!auth.isLoading && !auth.data?.user ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-10 text-center shadow-soft">
            <LockKeyhole className="mx-auto size-8 text-brand" />
            <p className="mt-4 font-display text-lg font-semibold">Log in to view your library</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Save documents, create collections, and track your upload submissions.
            </p>
            <Button asChild className="mt-5">
              <Link to="/login">Log in</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="mt-8 flex gap-2 border-b border-border pb-3">
              <button
                type="button"
                onClick={() => setActiveTab("uploads")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "uploads"
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "bg-surface text-muted-foreground hover:bg-muted"
                }`}
              >
                My uploads ({userDocuments.length + userOcrJobs.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("saved")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "saved"
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "bg-surface text-muted-foreground hover:bg-muted"
                }`}
              >
                Saved ({savedQuery.data?.documents.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("collections")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "collections"
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "bg-surface text-muted-foreground hover:bg-muted"
                }`}
              >
                Collections ({savedQuery.data?.collections.length ?? 0})
              </button>
            </div>

            {/* TAB 1: MY UPLOADS */}
            {activeTab === "uploads" && (
              <section className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-1.5">
                    {(["all", "documents", "ocr"] as const).map((filter) => (
                      <Button
                        key={filter}
                        size="sm"
                        variant={uploadFilter === filter ? "default" : "outline"}
                        onClick={() => setUploadFilter(filter)}
                        className="h-8 text-xs capitalize"
                      >
                        {filter === "all"
                          ? "All uploads"
                          : filter === "documents"
                            ? "Documents"
                            : "OCR Scans"}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* OCR Jobs if relevant */}
                {(uploadFilter === "all" || uploadFilter === "ocr") && userOcrJobs.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      OCR Scan Projects
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {userOcrJobs.map((job) => (
                        <div
                          key={job.id}
                          className="rounded-xl border border-border bg-card p-4 shadow-soft"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-display font-semibold truncate">
                                {job.metadata?.title ? String(job.metadata.title) : `OCR Job #${job.id.slice(0, 8)}`}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {job.pageCount} {job.pageCount === 1 ? "page" : "pages"} · {job.profile}
                              </p>
                            </div>
                            <Badge
                              variant={
                                job.status === "ready"
                                  ? "secondary"
                                  : job.status === "failed"
                                    ? "destructive"
                                    : "outline"
                              }
                            >
                              {job.status === "ready"
                                ? "OCR Ready"
                                : job.status === "processing"
                                  ? "Processing"
                                  : job.status}
                            </Badge>
                          </div>
                          <Button asChild size="sm" className="mt-3 w-full" variant="outline">
                            <Link to="/scanner" search={{ job: job.id }}>
                              <ScanLine className="mr-1.5 size-3.5" /> Continue editing
                            </Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Document uploads */}
                {(uploadFilter === "all" || uploadFilter === "documents") && (
                  <div className="mt-6">
                    {uploadFilter === "all" && userOcrJobs.length > 0 && (
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Submitted & Published Documents
                      </h3>
                    )}
                    {userDocuments.length ? (
                      <div className="space-y-3">
                        {userDocuments.map((doc) => (
                          <article
                            key={doc.id}
                            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-soft transition hover:border-brand/40"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-display text-base font-semibold">
                                  {doc.title}
                                </span>
                                <Badge
                                  variant={
                                    doc.status === "published"
                                      ? "secondary"
                                      : doc.status === "awaiting_review"
                                        ? "outline"
                                        : doc.status === "rejected"
                                          ? "destructive"
                                          : "outline"
                                  }
                                >
                                  {doc.status === "awaiting_review"
                                    ? "Awaiting review"
                                    : doc.status === "changes_requested"
                                      ? "Changes requested"
                                      : doc.status?.replaceAll("_", " ")}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {doc.subject} · {doc.docType} · {doc.fileType} · {doc.pages} pages
                              </p>
                              {doc.rejectionReason && (
                                <p className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                                  Feedback: {doc.rejectionReason}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {doc.status === "published" ? (
                                <Button asChild size="sm">
                                  <Link to="/document/$id" params={{ id: doc.id }}>
                                    <FileText className="mr-1.5 size-3.5" /> View document
                                  </Link>
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  In moderation queue
                                </Badge>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                        <FileClock className="mx-auto size-7 text-muted-foreground/60" />
                        <p className="mt-2 font-medium">No document contributions yet</p>
                        <Button asChild size="sm" className="mt-3">
                          <Link to="/upload">Upload your first document</Link>
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* TAB 2: SAVED BOOKMARKS */}
            {activeTab === "saved" && (
              <section className="mt-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Saved documents</h2>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/search" search={{ q: "" }}>
                      <Bookmark className="mr-1.5 size-4" /> Browse more
                    </Link>
                  </Button>
                </div>
                {savedQuery.data?.documents.length ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {savedQuery.data.documents.map((document) => (
                      <DocumentCard key={document.id} doc={document} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    <Bookmark className="mx-auto size-7 text-muted-foreground/60" />
                    <p className="mt-2 font-medium">No saved documents yet</p>
                    <p className="text-xs text-muted-foreground">
                      Click the bookmark icon on any document card to save it for later.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* TAB 3: COLLECTIONS */}
            {activeTab === "collections" && (
              <section className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Study Collections</h2>
                    <p className="text-xs text-muted-foreground">
                      Organize past papers, revision notes, and study modules into folders.
                    </p>
                  </div>
                  <Button size="sm" onClick={createCollection}>
                    <Plus className="mr-1.5 size-4" /> New collection
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(savedQuery.data?.collections ?? []).map((collection) => (
                    <div
                      key={collection.id}
                      className="card-lift rounded-xl border border-border bg-card p-5 shadow-soft"
                    >
                      <FolderOpen className="size-5 text-brand" />
                      <p className="mt-3 font-display text-base font-semibold">{collection.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {collection.count} {collection.count === 1 ? "document" : "documents"}
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

                {selectedCollectionId && (
                  <div className="mt-6 rounded-xl border border-brand/30 bg-card p-5 shadow-soft">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {collectionDetail.data?.collection.name || "Collection"}
                        </h3>
                        <p className="text-xs text-muted-foreground">
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
                      <p className="mt-4 text-sm text-muted-foreground">Loading collection…</p>
                    ) : collectionDetail.data?.documents.length ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {collectionDetail.data.documents.map((document) => (
                          <div key={document.id}>
                            <DocumentCard doc={document} />
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
                        This collection is empty. Add documents from any document details page.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Followed Topics */}
            <section className="mt-12 border-t border-border pt-8">
              <div className="flex items-center gap-2">
                <BellRing className="size-5 text-brand" />
                <h2 className="text-xl font-semibold">Followed topics</h2>
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
                    You are not following any topics. Open Browse subjects and click the bell icons.
                  </p>
                )}
              </div>
            </section>

            {/* Recommendations */}
            {(recommendations.data?.documents.length ?? 0) > 0 && (
              <section className="mt-10">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5 text-brand" />
                  <h2 className="text-xl font-semibold">Recommended for you</h2>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {recommendations.data!.documents.map((document) => (
                    <CompactDocumentCard key={document.id} doc={document} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
      <PromptModal modalState={promptModal} />
      <ConfirmModal modalState={confirmModal} />
    </div>
  );
}

