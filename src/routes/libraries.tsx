import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  FileText,
  Globe2,
  KeyRound,
  Library,
  Loader2,
  LockKeyhole,
  Plus,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Upload,
  Users,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CompactDocumentCard } from "@/components/document-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [joinCode, setJoinCode] = useState("");
  const [newJoinCode, setNewJoinCode] = useState("");
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

  const mine = useMemo(() => libraries.filter((item) => item.isMember), [libraries]);
  const publicLibraries = useMemo(() => libraries.filter((item) => !item.isMember), [libraries]);

  const refresh = async (id = selectedId) => {
    await queryClient.invalidateQueries({ queryKey: ["libraries"] });
    if (id) await queryClient.invalidateQueries({ queryKey: ["library", id] });
  };

  const createLibrary = async () => {
    if (!name.trim()) return toast.error("Enter a library name");
    setBusy(true);
    try {
      const result = await apiFetch<{ library: ApiLibrary }>("/api/libraries", {
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
      setSelectedId(result.library.id);
      toast.success("Library created");
      await refresh(result.library.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create library");
    } finally {
      setBusy(false);
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return toast.error("Enter a join code");
    setBusy(true);
    try {
      const result = await apiFetch<{ libraryId: string }>("/api/libraries/join", {
        method: "POST",
        body: JSON.stringify({ joinCode: joinCode.trim() }),
      });
      setJoinCode("");
      setSelectedId(result.libraryId);
      toast.success("Library joined");
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
      title: "Generate New Join Code",
      description: "Are you sure? The current code will stop working immediately.",
      confirmLabel: "Generate Code",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const result = await apiFetch<{ joinCode: string }>(
            `/api/libraries/${encodeURIComponent(selectedId)}/join-code`,
            { method: "POST" },
          );
          setNewJoinCode(result.joinCode);
          toast.success("A new join code was generated");
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not rotate join code");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const editLibrary = () => {
    const current = detail.data?.library;
    if (!current) return;
    setPromptModal({
      open: true,
      title: "Edit Library Details",
      description: "Update the institution library name, institution context, and description.",
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
          toast.success("Library details updated");
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
          const result = await apiFetch<{ deleted: boolean; archivedDocuments: number }>(
            `/api/libraries/${encodeURIComponent(current.id)}`,
            { method: "DELETE" },
          );
          setSelectedId("");
          setNewJoinCode("");
          toast.success(
            `Library deleted${result.archivedDocuments ? `; ${result.archivedDocuments} private document(s) archived` : ""}`,
          );
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
      toast.success(
        current.visibility === "private" ? "Library is now public" : "Library is now private",
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update library");
    }
  };

  const addDocument = async () => {
    if (!documentId.trim() || !selectedId) return toast.error("Enter a document ID");
    try {
      await apiFetch(`/api/libraries/${encodeURIComponent(selectedId)}/documents`, {
        method: "POST",
        body: JSON.stringify({ documentId: documentId.trim(), makePrivate }),
      });
      setDocumentId("");
      toast.success("Document added to the library");
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
      toast.success(`Member role changed to ${role}`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update member role");
    }
  };

  const removeMember = (memberId: string) => {
    if (!selectedId) return;
    setConfirmModal({
      open: true,
      title: "Remove Member",
      description: "Are you sure you want to remove this member from the library?",
      destructive: true,
      confirmLabel: "Remove Member",
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
      description: "Are you sure you want to remove this document from the library?",
      destructive: true,
      confirmLabel: "Remove Document",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/libraries/${encodeURIComponent(selectedId)}/documents`, {
            method: "DELETE",
            body: JSON.stringify({ documentId: id }),
          });
          toast.success("Document removed from the library");
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not remove document");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-3xl">
              <Library className="size-7 text-brand" /> Institution libraries
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Create public course libraries or private spaces for a university, college,
              department, class or study group. Private documents remain hidden from non-members.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/upload">
              <Upload className="size-4" /> Upload document
            </Link>
          </Button>
        </div>

        {!auth.isLoading && !auth.data?.user && (
          <div className="mt-6 rounded-xl border border-highlight/50 bg-highlight/10 p-4 text-sm">
            Public libraries can be viewed without an account.{" "}
            <Link to="/login" className="font-semibold text-brand">
              Log in
            </Link>{" "}
            to create or join a private library.
          </div>
        )}

        {auth.data?.user && (
          <section className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <h2 className="flex items-center gap-2 text-xl">
                <Plus className="size-5 text-brand" /> Create a library
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field
                  label="Library name"
                  value={name}
                  onChange={setName}
                  placeholder="Computer Science Department"
                />
                <Field
                  label="Institution"
                  value={institution}
                  onChange={setInstitution}
                  placeholder="Optional institution name"
                />
                <label className="sm:col-span-2 block">
                  <span className="mb-1.5 block text-sm font-medium">Description</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Visibility</span>
                  <select
                    value={visibility}
                    onChange={(event) => setVisibility(event.target.value as "public" | "private")}
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                  >
                    <option value="private">Private — members only</option>
                    <option value="public">Public — anyone can view</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <Button className="w-full" disabled={busy} onClick={createLibrary}>
                    {busy && <Loader2 className="size-4 animate-spin" />} Create library
                  </Button>
                </div>
              </div>
              {newJoinCode && (
                <div className="mt-4 rounded-lg border border-brand/30 bg-brand-soft p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                    Save this join code now
                  </p>
                  <p className="mt-2 break-all font-mono text-lg font-semibold">{newJoinCode}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only a hash is stored. Rotating the code invalidates the previous one.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <h2 className="flex items-center gap-2 text-xl">
                <KeyRound className="size-5 text-brand" /> Join a private library
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask the library owner for its current join code.
              </p>
              <div className="mt-5 flex gap-2">
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="EDU-XXXXXXXX"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-brand"
                />
                <Button disabled={busy} onClick={joinByCode}>
                  Join
                </Button>
              </div>
            </div>
          </section>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[330px_1fr]">
          <aside className="space-y-6">
            <LibraryList
              title="My libraries"
              items={mine}
              selectedId={selectedId}
              onSelect={setSelectedId}
              empty="You have not joined a library yet."
            />
            <LibraryList
              title="Public libraries"
              items={publicLibraries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              empty="No public libraries are available yet."
            />
          </aside>

          <section className="min-h-[420px] rounded-xl border border-border bg-card p-5 shadow-soft">
            {!selectedId ? (
              <div className="grid min-h-[360px] place-items-center text-center">
                <div>
                  <Building2 className="mx-auto size-9 text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Create or join a library to manage its documents.
                  </p>
                </div>
              </div>
            ) : detail.isLoading ? (
              <div className="grid min-h-[360px] place-items-center">
                <Loader2 className="size-7 animate-spin text-brand" />
              </div>
            ) : detail.isError || !detail.data ? (
              <div className="grid min-h-[360px] place-items-center text-center">
                <div>
                  <LockKeyhole className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {detail.error?.message || "This library is unavailable."}
                  </p>
                </div>
              </div>
            ) : (
              <LibraryDetail
                data={detail.data}
                documentId={documentId}
                setDocumentId={setDocumentId}
                makePrivate={makePrivate}
                setMakePrivate={setMakePrivate}
                onAddDocument={addDocument}
                onRemoveDocument={removeDocument}
                onUpdateMember={updateMember}
                onRemoveMember={removeMember}
                onRotateCode={rotateCode}
                onToggleVisibility={toggleVisibility}
                onEdit={editLibrary}
                onDelete={deleteLibrary}
              />
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
      <PromptModal modalState={promptModal} />
      <ConfirmModal modalState={confirmModal} />
    </div>
  );
}

function LibraryList({
  title,
  items,
  selectedId,
  onSelect,
  empty,
}: {
  title: string;
  items: ApiLibrary[];
  selectedId: string;
  onSelect: (id: string) => void;
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div className="mt-3 space-y-2">
        {items.length ? (
          items.map((library) => (
            <button
              key={library.id}
              type="button"
              onClick={() => onSelect(library.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedId === library.id ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand/60"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold">{library.name}</p>
                {library.visibility === "private" ? (
                  <LockKeyhole className="size-4 text-muted-foreground" />
                ) : (
                  <Globe2 className="size-4 text-muted-foreground" />
                )}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {library.institution || "Independent library"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {library.documentCount} documents · {library.memberCount} members
              </p>
            </button>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}

function LibraryDetail({
  data,
  documentId,
  setDocumentId,
  makePrivate,
  setMakePrivate,
  onAddDocument,
  onRemoveDocument,
  onUpdateMember,
  onRemoveMember,
  onRotateCode,
  onToggleVisibility,
  onEdit,
  onDelete,
}: {
  data: LibraryDetailResponse;
  documentId: string;
  setDocumentId: (value: string) => void;
  makePrivate: boolean;
  setMakePrivate: (value: boolean) => void;
  onAddDocument: () => void;
  onRemoveDocument: (id: string) => void;
  onUpdateMember: (id: string, role: "editor" | "viewer") => void;
  onRemoveMember: (id: string) => void;
  onRotateCode: () => void;
  onToggleVisibility: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { library, documents, members, canManage } = data;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl">{library.name}</h2>
            <Badge variant={library.visibility === "private" ? "outline" : "secondary"}>
              {library.visibility}
            </Badge>
            {library.role && <Badge variant="outline">{library.role}</Badge>}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="size-4" /> {library.institution || "Independent academic library"}
          </p>
          {library.description && (
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{library.description}</p>
          )}
        </div>
        <div className="flex gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="size-4" /> {library.documentCount}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-4" /> {library.memberCount}
          </span>
        </div>
      </div>

      {canManage && (
        <div className="mt-5 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-4 text-brand" /> Library controls
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Join-code hint: ••••{library.joinCodeHint || "none"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil className="size-4" /> Edit details
              </Button>
              <Button size="sm" variant="outline" onClick={onRotateCode}>
                <RefreshCw className="size-4" /> New join code
              </Button>
              <Button size="sm" variant="outline" onClick={onToggleVisibility}>
                {library.visibility === "private" ? (
                  <Globe2 className="size-4" />
                ) : (
                  <LockKeyhole className="size-4" />
                )}{" "}
                Make {library.visibility === "private" ? "public" : "private"}
              </Button>
              <Button size="sm" variant="destructive" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              placeholder="Existing document ID"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            />
            <Button onClick={onAddDocument}>
              <Plus className="size-4" /> Add document
            </Button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={makePrivate}
              onChange={(event) => setMakePrivate(event.target.checked)}
            />{" "}
            Restrict this document to library members
          </label>
        </div>
      )}

      <section className="mt-7">
        <div className="flex items-center justify-between">
          <h3 className="text-xl">Documents</h3>
          {canManage && (
            <Button asChild size="sm">
              <Link to="/upload">
                <Upload className="size-4" /> Upload into a library
              </Link>
            </Button>
          )}
        </div>
        {documents.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((document) => (
              <div key={document.id} className="relative">
                <CompactDocumentCard doc={document} />
                {canManage && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => onRemoveDocument(document.id)}
                  >
                    Remove from library
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No documents have been added to this library.
          </p>
        )}
      </section>

      {canManage && members.length > 0 && (
        <section className="mt-8">
          <h3 className="text-xl">Members</h3>
          <div className="mt-3 divide-y divide-border rounded-xl border border-border">
            {members.map((member) => {
              const canManageMembers = library.role === "owner" || library.role === "admin";
              return (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{member.role}</Badge>
                    {canManageMembers && member.role !== "owner" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onUpdateMember(
                              member.id,
                              member.role === "editor" ? "viewer" : "editor",
                            )
                          }
                        >
                          {member.role === "editor" ? "Make viewer" : "Make editor"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onRemoveMember(member.id)}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}
