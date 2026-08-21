import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Copy,
  FileText,
  Globe2,
  KeyRound,
  Library,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, type ApiDocument, type ApiLibrary } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import {
  PromptModal,
  ConfirmModal,
  type PromptModalState,
  type ConfirmModalState,
} from "@/components/ui/prompt-dialog";

export const Route = createFileRoute("/libraries")({
  head: () => ({ meta: [{ title: "Institution libraries — EduSearch AI" }] }),
  component: LibrariesPage,
});

type LibrariesResponse = { libraries: ApiLibrary[] };
type LibraryDetailResponse = {
  library: ApiLibrary;
  documents: ApiDocument[];
  members: Array<{ id: string; name: string; email: string; role: string; joinedAt: string }>;
  canManage: boolean;
};

function LibrariesPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [makePrivate, setMakePrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const list = useQuery({
    queryKey: ["libraries"],
    queryFn: () => apiFetch<LibrariesResponse>("/api/libraries"),
    enabled: typeof window !== "undefined",
    retry: false,
  });
  const libraries = useMemo(() => list.data?.libraries ?? [], [list.data?.libraries]);

  useEffect(() => {
    if (!selectedId && libraries.length) setSelectedId(libraries[0].id);
    if (selectedId && libraries.length && !libraries.some((item) => item.id === selectedId))
      setSelectedId(libraries[0]?.id ?? "");
  }, [libraries, selectedId]);

  const detail = useQuery({
    queryKey: ["library", selectedId],
    queryFn: () =>
      apiFetch<LibraryDetailResponse>(`/api/libraries/${encodeURIComponent(selectedId)}`),
    enabled: typeof window !== "undefined" && Boolean(selectedId),
    retry: false,
  });

  // Fetch join code for owner/manager
  const joinCodeQuery = useQuery({
    queryKey: ["library-join-code", selectedId],
    queryFn: () =>
      apiFetch<{ joinCode: string }>(`/api/libraries/${encodeURIComponent(selectedId)}/join-code`),
    enabled: Boolean(selectedId) && Boolean(detail.data?.canManage),
    retry: false,
  });

  const mine = useMemo(() => libraries.filter((item) => item.isMember), [libraries]);
  const publicLibraries = useMemo(() => libraries.filter((item) => !item.isMember), [libraries]);

  const refresh = async (id = selectedId) => {
    await queryClient.invalidateQueries({ queryKey: ["libraries"] });
    if (id) {
      await queryClient.invalidateQueries({ queryKey: ["library", id] });
      await queryClient.invalidateQueries({ queryKey: ["library-join-code", id] });
    }
  };

  const handleCreateLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Please enter a name for your institution library.");
    setBusy(true);
    try {
      const result = await apiFetch<{ library: ApiLibrary; joinCode?: string }>("/api/libraries", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          institution: institution.trim(),
          description: description.trim(),
          visibility,
        }),
      });
      setName("");
      setInstitution("");
      setDescription("");
      setCreateModalOpen(false);
      setSelectedId(result.library.id);
      toast.success(`Library "${result.library.name}" created successfully!`);
      await refresh(result.library.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create library");
    } finally {
      setBusy(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return toast.error("Please enter the join code.");
    setBusy(true);
    try {
      const result = await apiFetch<{ libraryId: string }>("/api/libraries/join", {
        method: "POST",
        body: JSON.stringify({ joinCode: joinCodeInput.trim() }),
      });
      setJoinCodeInput("");
      setJoinModalOpen(false);
      setSelectedId(result.libraryId);
      toast.success("Joined library successfully!");
      await refresh(result.libraryId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not join library");
    } finally {
      setBusy(false);
    }
  };

  const rotateCode = () => {
    if (!selectedId) return;
    setConfirmModal({
      open: true,
      title: "Rotate Join Code",
      description: "Generating a new join code will invalidate the previous code immediately.",
      confirmLabel: "Generate New Code",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const result = await apiFetch<{ joinCode: string }>(
            `/api/libraries/${encodeURIComponent(selectedId)}/rotate-code`,
            { method: "POST" },
          );
          toast.success("New join code generated: " + result.joinCode);
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not rotate join code");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const copyJoinCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Join code copied to clipboard");
  };

  const editLibrary = () => {
    const current = detail.data?.library;
    if (!current) return;
    setPromptModal({
      open: true,
      title: "Edit Library Details",
      description: "Update library information.",
      fields: [
        { name: "name", label: "Library Name", defaultValue: current.name, required: true },
        { name: "institution", label: "Institution (optional)", defaultValue: current.institution || "" },
        { name: "description", label: "Description (optional)", type: "textarea", defaultValue: current.description || "" },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const nextName = values.name?.trim();
        if (!nextName) return;
        try {
          await apiFetch(`/api/libraries/${encodeURIComponent(current.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: nextName,
              institution: values.institution?.trim() || "",
              description: values.description?.trim() || "",
            }),
          });
          toast.success("Library updated");
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update library");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const deleteLibrary = () => {
    const current = detail.data?.library;
    if (!current) return;
    setConfirmModal({
      open: true,
      title: `Delete Library "${current.name}"?`,
      description: "Member access will be removed and private documents will be archived.",
      destructive: true,
      confirmLabel: "Delete Library",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/libraries/${encodeURIComponent(current.id)}`, { method: "DELETE" });
          setSelectedId("");
          toast.success("Library deleted");
          await refresh("");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete library");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const toggleVisibility = async () => {
    const current = detail.data?.library;
    if (!current) return;
    try {
      await apiFetch(`/api/libraries/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          visibility: current.visibility === "private" ? "public" : "private",
        }),
      });
      toast.success(current.visibility === "private" ? "Library is now public" : "Library is now private");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update library");
    }
  };

  const addDocument = async () => {
    if (!documentId.trim()) return toast.error("Please enter a valid Document ID.");
    if (!selectedId) return toast.error("Please select a library first.");
    try {
      await apiFetch(`/api/libraries/${encodeURIComponent(selectedId)}/documents`, {
        method: "POST",
        body: JSON.stringify({ documentId: documentId.trim(), makePrivate }),
      });
      setDocumentId("");
      toast.success("Document added to library");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add document");
    }
  };

  const updateMember = async (memberId: string, role: "editor" | "viewer") => {
    if (!selectedId) return;
    try {
      await apiFetch(
        `/api/libraries/${encodeURIComponent(selectedId)}/members/${encodeURIComponent(memberId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        },
      );
      toast.success(`Role updated to ${role}`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update member");
    }
  };

  const removeMember = (memberId: string) => {
    if (!selectedId) return;
    setConfirmModal({
      open: true,
      title: "Remove Member",
      description: "Remove this user from the library?",
      destructive: true,
      confirmLabel: "Remove",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(
            `/api/libraries/${encodeURIComponent(selectedId)}/members/${encodeURIComponent(memberId)}`,
            { method: "DELETE" },
          );
          toast.success("Member removed");
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not remove member");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const removeDocument = (id: string) => {
    if (!selectedId) return;
    setConfirmModal({
      open: true,
      title: "Remove Document",
      description: "Remove this document from the library?",
      destructive: true,
      confirmLabel: "Remove",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/libraries/${encodeURIComponent(selectedId)}/documents`, {
            method: "DELETE",
            body: JSON.stringify({ documentId: id }),
          });
          toast.success("Document removed");
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not remove document");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 flex-1 flex flex-col">
        {/* Compact Header with Direct Action Modals */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="flex items-center gap-2 text-2xl sm:text-3xl font-display font-semibold text-foreground">
              <Library className="size-6 text-brand" /> Institution Libraries
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage shared academic spaces, departments, and course materials.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {auth.data?.user && (
              <>
                <Button size="sm" onClick={() => setCreateModalOpen(true)} className="h-9 px-3 text-xs">
                  <Plus className="mr-1.5 size-3.5" /> Create Library
                </Button>
                <Button size="sm" variant="outline" onClick={() => setJoinModalOpen(true)} className="h-9 px-3 text-xs">
                  <KeyRound className="mr-1.5 size-3.5" /> Join Library
                </Button>
              </>
            )}
            <Button asChild variant="ghost" size="sm" className="h-9 px-3 text-xs">
              <Link to="/upload">
                <Upload className="mr-1.5 size-3.5" /> Upload Document
              </Link>
            </Button>
          </div>
        </div>

        {!auth.isLoading && !auth.data?.user && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground flex items-center justify-between">
            <span>Public libraries are accessible to everyone. Log in to create or join private workspaces.</span>
            <Button size="sm" variant="outline" asChild className="h-7 text-xs">
              <Link to="/login">Log in</Link>
            </Button>
          </div>
        )}

        {/* 2-Column Responsive Layout */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr] flex-1">
          {/* Left Sidebar Library Selector */}
          <aside className="space-y-5">
            <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-sm font-semibold text-foreground">My Libraries</h2>
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {mine.length}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {mine.length ? (
                  mine.map((lib) => (
                    <button
                      key={lib.id}
                      type="button"
                      onClick={() => setSelectedId(lib.id)}
                      className={`w-full rounded-lg border p-2.5 text-left transition ${
                        selectedId === lib.id
                          ? "border-brand bg-brand-soft/80 font-medium text-brand"
                          : "border-border bg-surface hover:border-brand/40 text-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-semibold">{lib.name}</span>
                        {lib.visibility === "private" ? (
                          <LockKeyhole className="size-3 text-muted-foreground shrink-0" />
                        ) : (
                          <Globe2 className="size-3 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {lib.institution || "Academic Library"}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {lib.documentCount} docs · {lib.memberCount} members
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    No private libraries joined yet.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-sm font-semibold text-foreground">Public Spaces</h2>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {publicLibraries.length}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {publicLibraries.length ? (
                  publicLibraries.map((lib) => (
                    <button
                      key={lib.id}
                      type="button"
                      onClick={() => setSelectedId(lib.id)}
                      className={`w-full rounded-lg border p-2.5 text-left transition ${
                        selectedId === lib.id
                          ? "border-brand bg-brand-soft/80 font-medium text-brand"
                          : "border-border bg-surface hover:border-brand/40 text-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-semibold">{lib.name}</span>
                        <Globe2 className="size-3 text-muted-foreground shrink-0" />
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {lib.institution || "Academic Library"}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {lib.documentCount} docs
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    No other public libraries available.
                  </p>
                )}
              </div>
            </section>
          </aside>

          {/* Right Main Library Detail & Documents Pane */}
          <section className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-soft">
            {!selectedId ? (
              <div className="grid flex-1 place-items-center text-center py-16">
                <div>
                  <Building2 className="mx-auto size-10 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Select a library on the left or create a new space.
                  </p>
                </div>
              </div>
            ) : detail.isLoading ? (
              <div className="grid flex-1 place-items-center py-16">
                <Loader2 className="size-8 animate-spin text-brand" />
              </div>
            ) : detail.isError || !detail.data ? (
              <div className="grid flex-1 place-items-center text-center py-16">
                <div>
                  <LockKeyhole className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {detail.error?.message || "This library is private or unavailable."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Library Header info */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-display font-semibold text-foreground">
                        {detail.data.library.name}
                      </h2>
                      <Badge variant={detail.data.library.visibility === "private" ? "outline" : "secondary"}>
                        {detail.data.library.visibility}
                      </Badge>
                      {detail.data.library.role && (
                        <Badge variant="outline" className="border-brand/40 text-brand">
                          {detail.data.library.role}
                        </Badge>
                      )}
                    </div>
                    {detail.data.library.institution && (
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="size-3.5" /> {detail.data.library.institution}
                      </p>
                    )}
                    {detail.data.library.description && (
                      <p className="mt-2 text-xs text-muted-foreground max-w-2xl">
                        {detail.data.library.description}
                      </p>
                    )}
                  </div>

                  {/* Owner Permanent Join Code & Controls */}
                  {detail.data.canManage && (
                    <div className="flex flex-col items-end gap-2">
                      {detail.data.library.visibility === "private" && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-soft/60 px-3 py-1.5 text-xs">
                          <span className="text-muted-foreground font-medium">Join code:</span>
                          <code className="font-mono font-bold text-brand">
                            {joinCodeQuery.data?.joinCode || "••••••••"}
                          </code>
                          {joinCodeQuery.data?.joinCode && (
                            <button
                              type="button"
                              onClick={() => copyJoinCode(joinCodeQuery.data.joinCode)}
                              className="p-1 text-muted-foreground hover:text-brand transition"
                              title="Copy join code"
                            >
                              <Copy className="size-3.5" />
                            </button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[11px] text-brand hover:text-brand"
                            onClick={rotateCode}
                          >
                            <RefreshCw className="mr-1 size-3" /> Rotate
                          </Button>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={editLibrary}>
                          <Pencil className="mr-1 size-3" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={toggleVisibility}>
                          {detail.data.library.visibility === "private" ? (
                            <Globe2 className="mr-1 size-3" />
                          ) : (
                            <LockKeyhole className="mr-1 size-3" />
                          )}
                          Make {detail.data.library.visibility === "private" ? "Public" : "Private"}
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={deleteLibrary}>
                          <Trash2 className="mr-1 size-3" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Add Document to Library Input for Managers */}
                {detail.data.canManage && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-surface p-3">
                    <input
                      value={documentId}
                      onChange={(e) => setDocumentId(e.target.value)}
                      placeholder="Add document by ID (e.g. comp201-notes)"
                      className="h-8 flex-1 min-w-[200px] rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-brand"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={makePrivate}
                        onChange={(e) => setMakePrivate(e.target.checked)}
                        className="rounded"
                      />
                      Members only
                    </label>
                    <Button size="sm" onClick={addDocument} className="h-8 px-3 text-xs">
                      <Plus className="mr-1 size-3.5" /> Add Document
                    </Button>
                  </div>
                )}

                {/* Library Documents Grid (3 Columns) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Library Documents ({detail.data.documents.length})
                    </h3>
                  </div>

                  {detail.data.documents.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-8 text-center">
                      <FileText className="mx-auto size-8 text-muted-foreground/40" />
                      <p className="mt-2 text-xs text-muted-foreground">
                        No documents have been added to this library yet.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {detail.data.documents.map((doc) => (
                        <div key={doc.id} className="relative group">
                          <DocumentCard doc={doc} />
                          {detail.data.canManage && (
                            <button
                              type="button"
                              onClick={() => removeDocument(doc.id)}
                              className="absolute top-2 right-10 grid size-7 place-items-center rounded-full bg-background/90 text-destructive opacity-0 group-hover:opacity-100 shadow-sm transition hover:scale-110"
                              title="Remove from library"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Library Members Section */}
                {detail.data.canManage && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Members ({detail.data.members.length})
                    </h3>
                    <div className="divide-y divide-border/60 rounded-xl border border-border bg-surface/50">
                      {detail.data.members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between p-3 text-xs">
                          <div>
                            <span className="font-semibold text-foreground">{m.name}</span>
                            <span className="text-muted-foreground ml-2">({m.email})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={m.role === "owner" ? "default" : "outline"} className="text-[10px]">
                              {m.role}
                            </Badge>
                            {m.role !== "owner" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[11px]"
                                  onClick={() => updateMember(m.id, m.role === "editor" ? "viewer" : "editor")}
                                >
                                  Make {m.role === "editor" ? "Viewer" : "Editor"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[11px] text-destructive hover:text-destructive"
                                  onClick={() => removeMember(m.id)}
                                >
                                  Remove
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />

      {/* Create Library Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateLibrary}>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                <Plus className="size-5 text-brand" /> Create Institution Library
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Set up a private or public academic repository space.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Library Name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Computer Science Department"
                  className="h-9 w-full rounded-md border border-border bg-surface px-3 text-xs outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Institution (Optional)</label>
                <input
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="e.g. University of Nairobi"
                  className="h-9 w-full rounded-md border border-border bg-surface px-3 text-xs outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Brief summary of this library's purpose"
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Visibility</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as "public" | "private")}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs"
                >
                  <option value="private">Private — Join code required</option>
                  <option value="public">Public — Visible to everyone</option>
                </select>
              </div>
            </div>

            <DialogFooter className="mt-4 sm:justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />} Create Library
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Join Library Modal */}
      <Dialog open={joinModalOpen} onOpenChange={setJoinModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleJoinByCode}>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                <KeyRound className="size-5 text-brand" /> Join Private Library
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Enter the join code given to you by the library creator.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Join Code</label>
              <input
                required
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                placeholder="EDU-XXXXXXXX"
                className="h-10 w-full rounded-md border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-brand uppercase tracking-wider"
              />
            </div>

            <DialogFooter className="mt-4 sm:justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setJoinModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !joinCodeInput.trim()}>
                {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />} Join
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PromptModal modalState={promptModal} />
      <ConfirmModal modalState={confirmModal} />
    </div>
  );
}
