import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileClock,
  FileText,
  Flag,
  History,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  ScanLine,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch, type ApiDocument, type OcrJob } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import {
  PromptModal,
  ConfirmModal,
  type PromptModalState,
  type ConfirmModalState,
} from "@/components/ui/prompt-dialog";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin dashboard — EduSearch AI" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPage,
});

type Dashboard = {
  metrics: {
    totalDocuments: number;
    publishedDocuments: number;
    totalSearches: number;
    searchableChunks: number;
    totalDownloads: number;
    totalViews: number;
    pendingUploads: number;
    ocrJobs: number;
    ocrAwaitingCorrection: number;
    duplicateWarnings: number;
    newContactMessages: number;
    openReports: number;
    openCopyrightRequests: number;
    restrictedDocuments: number;
    totalLibraries: number;
    privateLibraries: number;
    totalUsers: number;
    totalAdmins: number;
  };
  topSubjects: Array<{ subject: string; count: number }>;
  missingSearches: Array<{ query: string; searches: number; last_searched: string }>;
  contactMessages: Array<{
    id: string;
    email: string;
    subject: string;
    message: string;
    status: string;
    created_at: string;
  }>;
};

type ReportItem = {
  id: string;
  documentId: string;
  documentTitle: string;
  reason: string;
  details: string;
  status: string;
  reporterName?: string;
  reporterEmail?: string;
  createdAt: string;
};

type CopyrightRequestItem = {
  id: string;
  documentId: string;
  documentTitle: string;
  documentRightsStatus: string;
  claimantName: string;
  claimantEmail: string;
  claimantOrganization: string;
  relationship: string;
  requestedAction: string;
  statement: string;
  evidenceFilename?: string;
  status: string;
  resolutionAction: string;
  resolutionNote?: string;
  createdAt: string;
};

type AuditItem = {
  id: number;
  action: string;
  entityType: string;
  entityId?: string;
  userName?: string;
  userEmail?: string;
  createdAt: string;
  details: Record<string, unknown>;
};

type TaxonomyResponse = {
  subjects: Array<{
    id: number;
    name: string;
    description: string;
    topicCount: number;
    documentCount: number;
  }>;
  topics: Array<{
    id: number;
    subjectId: number | null;
    subjectName: string | null;
    name: string;
    description: string;
    synonyms: string[];
    related: string[];
  }>;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  documentCount: number;
  ownedLibraryCount: number;
  lastSessionAt?: string;
};

function AdminPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [subjectName, setSubjectName] = useState("");
  const [topicName, setTopicName] = useState("");
  const [topicSubjectId, setTopicSubjectId] = useState("");
  const [reindexing, setReindexing] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [creatingUser, setCreatingUser] = useState(false);
  const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const dashboard = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => apiFetch<Dashboard>("/api/admin/dashboard"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const pending = useQuery({
    queryKey: ["admin", "documents", "awaiting_review"],
    queryFn: () =>
      apiFetch<{ documents: ApiDocument[] }>("/api/admin/documents?status=awaiting_review"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const ocrReview = useQuery({
    queryKey: ["admin", "ocr-jobs", "awaiting_correction"],
    queryFn: () =>
      apiFetch<{ jobs: Array<OcrJob & { userName: string; userEmail: string | null }> }>(
        "/api/admin/ocr-jobs?status=awaiting_correction",
      ),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const reports = useQuery({
    queryKey: ["admin", "reports", "open"],
    queryFn: () => apiFetch<{ reports: ReportItem[] }>("/api/admin/reports?status=open"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const copyrightRequests = useQuery({
    queryKey: ["admin", "copyright-requests", "active"],
    queryFn: () =>
      apiFetch<{ requests: CopyrightRequestItem[] }>("/api/admin/copyright-requests?status=active"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const audit = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiFetch<{ logs: AuditItem[] }>("/api/admin/audit?limit=20"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const taxonomy = useQuery({
    queryKey: ["admin", "taxonomy"],
    queryFn: () => apiFetch<TaxonomyResponse>("/api/admin/taxonomy"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });
  const allDocuments = useQuery({
    queryKey: ["admin", "documents", "all"],
    queryFn: () => apiFetch<{ documents: ApiDocument[] }>("/api/admin/documents?status=all"),
    enabled: typeof window !== "undefined" && auth.data?.user?.role === "admin",
    retry: false,
  });

  const submitModeration = async (
    documentId: string,
    action: "approve" | "reject" | "request_changes",
    reason?: string,
  ) => {
    try {
      await apiFetch(`/api/admin/documents/${encodeURIComponent(documentId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action, reason }),
      });
      toast.success(action === "approve" ? "Document published" : "Moderation decision saved");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Moderation failed");
    }
  };

  const moderate = (documentId: string, action: "approve" | "reject" | "request_changes") => {
    if (action === "approve") {
      submitModeration(documentId, action);
      return;
    }
    setPromptModal({
      open: true,
      title: action === "reject" ? "Reason for Rejection" : "Changes Requested",
      fields: [
        {
          name: "reason",
          label: action === "reject" ? "Reason for rejection" : "What should the contributor change?",
          type: "textarea",
          required: true,
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        if (!values.reason?.trim()) return;
        await submitModeration(documentId, action, values.reason.trim());
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const resolveReport = (reportId: string, status: "resolved" | "dismissed") => {
    setPromptModal({
      open: true,
      title: status === "resolved" ? "Resolve Report" : "Dismiss Report",
      fields: [
        {
          name: "resolutionNote",
          label:
            status === "resolved"
              ? "How was this report resolved?"
              : "Why should this report be dismissed?",
          type: "textarea",
          required: true,
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const resolutionNote = values.resolutionNote?.trim();
        if (!resolutionNote) return;
        try {
          await apiFetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
            method: "PATCH",
            body: JSON.stringify({ status, resolutionNote }),
          });
          toast.success(`Report ${status}`);
          await queryClient.invalidateQueries({ queryKey: ["admin"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update report");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const updateCopyright = (
    requestId: string,
    action:
      | "review"
      | "restrict"
      | "contact_uploader"
      | "restore"
      | "remove"
      | "keep_restricted"
      | "dismiss",
  ) => {
    const needsNote = !["review", "contact_uploader"].includes(action);
    setPromptModal({
      open: true,
      title: `Copyright Action: ${action.replaceAll("_", " ")}`,
      fields: [
        {
          name: "note",
          label:
            action === "contact_uploader"
              ? "What rights information should the uploader provide?"
              : "Review / decision note",
          type: "textarea",
          required: needsNote,
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const note = values.note?.trim() ?? "";
        if (needsNote && !note) return;
        try {
          await apiFetch(`/api/admin/copyright-requests/${encodeURIComponent(requestId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action, note }),
          });
          toast.success(`Copyright request updated: ${action.replaceAll("_", " ")}`);
          await queryClient.invalidateQueries({ queryKey: ["admin"] });
          await queryClient.invalidateQueries({ queryKey: ["home"] });
          await queryClient.invalidateQueries({ queryKey: ["search"] });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not update the copyright request",
          );
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const reindexSearch = async () => {
    setReindexing(true);
    try {
      const result = await apiFetch<{ documents: number; chunks: number }>(
        "/api/admin/search/reindex",
        { method: "POST" },
      );
      toast.success(
        `Reindexed ${result.documents} documents into ${result.chunks} searchable sections`,
      );
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rebuild the search index");
    } finally {
      setReindexing(false);
    }
  };

  const addSubject = async () => {
    const name = subjectName.trim();
    if (!name) return;
    try {
      await apiFetch("/api/admin/subjects", { method: "POST", body: JSON.stringify({ name }) });
      setSubjectName("");
      toast.success("Subject created");
      await queryClient.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create subject");
    }
  };

  const addTopic = async () => {
    const name = topicName.trim();
    if (!name) return;
    try {
      await apiFetch("/api/admin/topics", {
        method: "POST",
        body: JSON.stringify({ name, subjectId: topicSubjectId || null }),
      });
      setTopicName("");
      toast.success("Topic created");
      await queryClient.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create topic");
    }
  };

  const createUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim() || newUserPassword.length < 8)
      return toast.error("Enter a name, valid email and password of at least 8 characters");
    setCreatingUser(true);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("user");
      toast.success("Account created");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create account");
    } finally {
      setCreatingUser(false);
    }
  };

  const editUser = (user: AdminUser) => {
    setPromptModal({
      open: true,
      title: `Edit User: ${user.name}`,
      fields: [
        { name: "name", label: "Full Name", defaultValue: user.name, required: true },
        { name: "email", label: "Email Address", defaultValue: user.email, required: true },
        {
          name: "role",
          label: "Role",
          type: "select",
          options: ["user", "admin"],
          defaultValue: user.role,
        },
        { name: "password", label: "New Password (leave blank to keep current)", type: "password" },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const name = values.name?.trim();
        const email = values.email?.trim();
        const roleInput = values.role?.trim().toLowerCase();
        const password = values.password || "";
        if (!name || !email) return;
        if (roleInput !== "admin" && roleInput !== "user")
          return toast.error("Role must be admin or user");
        if (password && password.length < 8)
          return toast.error("Password must contain at least 8 characters");
        try {
          await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ name, email, role: roleInput, ...(password ? { password } : {}) }),
          });
          toast.success("Account updated");
          await queryClient.invalidateQueries({ queryKey: ["admin"] });
          await queryClient.invalidateQueries({ queryKey: ["auth"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update account");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const deleteUser = (user: AdminUser) => {
    setConfirmModal({
      open: true,
      title: `Delete ${user.name}?`,
      description: `Delete ${user.name} (${user.email})? Their owned libraries will transfer to you.`,
      destructive: true,
      confirmLabel: "Delete Account",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
          toast.success("Account deleted");
          await queryClient.invalidateQueries({ queryKey: ["admin"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete account");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const editDocument = (document: ApiDocument) => {
    setPromptModal({
      open: true,
      title: "Edit Document",
      fields: [
        { name: "title", label: "Document Title", defaultValue: document.title, required: true },
        { name: "subject", label: "Subject", defaultValue: document.subject, required: true },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          defaultValue: document.description || "",
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const title = values.title?.trim();
        const subject = values.subject?.trim();
        const description = values.description?.trim();
        if (!title || !subject) return;
        try {
          await apiFetch(`/api/admin/documents/${encodeURIComponent(document.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "update", title, subject, description }),
          });
          toast.success("Document updated");
          await queryClient.invalidateQueries({ queryKey: ["admin"] });
          await queryClient.invalidateQueries({ queryKey: ["home"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update document");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const deleteDocument = (document: ApiDocument) => {
    setConfirmModal({
      open: true,
      title: `Permanently Delete "${document.title}"?`,
      description: "This removes its saved references, reports, ratings and stored file.",
      destructive: true,
      confirmLabel: "Permanently Delete",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/admin/documents/${encodeURIComponent(document.id)}`, {
            method: "DELETE",
          });
          toast.success("Document deleted");
          await queryClient.invalidateQueries({ queryKey: ["admin"] });
          await queryClient.invalidateQueries({ queryKey: ["home"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete document");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const updateMessage = async (id: string, status: "in_progress" | "resolved" | "spam") => {
    try {
      await apiFetch(`/api/admin/contact-messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      toast.success(`Message marked ${status.replaceAll("_", " ")}`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update message");
    }
  };

  const editSubject = (subject: TaxonomyResponse["subjects"][number]) => {
    setPromptModal({
      open: true,
      title: "Edit Subject",
      fields: [
        { name: "name", label: "Subject Name", defaultValue: subject.name, required: true },
        {
          name: "description",
          label: "Subject Description",
          type: "textarea",
          defaultValue: subject.description || "",
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const name = values.name?.trim();
        if (!name) return;
        const description = values.description?.trim() || "";
        try {
          await apiFetch(`/api/admin/subjects/${subject.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name, description, renameDocuments: name !== subject.name }),
          });
          toast.success("Subject updated");
          await queryClient.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
          await queryClient.invalidateQueries({ queryKey: ["subjects"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update subject");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const deleteSubject = (subject: TaxonomyResponse["subjects"][number]) => {
    setConfirmModal({
      open: true,
      title: `Delete Subject "${subject.name}"?`,
      description: "This is blocked while documents still use it.",
      destructive: true,
      confirmLabel: "Delete Subject",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/admin/subjects/${subject.id}`, { method: "DELETE" });
          toast.success("Subject deleted");
          await queryClient.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete subject");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const editTopic = (topic: TaxonomyResponse["topics"][number]) => {
    setPromptModal({
      open: true,
      title: "Edit Topic",
      fields: [
        { name: "name", label: "Topic Name", defaultValue: topic.name, required: true },
        {
          name: "synonyms",
          label: "Synonyms (separated by commas)",
          defaultValue: topic.synonyms.join(", "),
        },
      ],
      onConfirm: async (values) => {
        setPromptModal(null);
        const name = values.name?.trim();
        if (!name) return;
        const synonyms = values.synonyms || "";
        try {
          await apiFetch(`/api/admin/topics/${topic.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name,
              subjectId: topic.subjectId,
              synonyms: synonyms
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            }),
          });
          toast.success("Topic updated");
          await queryClient.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update topic");
        }
      },
      onCancel: () => setPromptModal(null),
    });
  };

  const deleteTopic = (topic: TaxonomyResponse["topics"][number]) => {
    setConfirmModal({
      open: true,
      title: `Delete Topic "${topic.name}"?`,
      destructive: true,
      confirmLabel: "Delete Topic",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/admin/topics/${topic.id}`, { method: "DELETE" });
          toast.success("Topic deleted");
          await queryClient.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete topic");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const [activeTab, setActiveTab] = useState<
    "dashboard" | "review_queue" | "ocr_review" | "documents" | "taxonomy" | "users" | "compliance"
  >("dashboard");

  if (!auth.isLoading && auth.data?.user?.role !== "admin") {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-20 text-center">
          <ShieldCheck className="mx-auto size-10 text-brand" />
          <h1 className="mt-4 text-3xl">Administrator access required</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The first registered account becomes the local administrator unless
            FIRST_USER_ADMIN=false.
          </p>
          <Button asChild className="mt-6">
            <Link to="/login">Log in</Link>
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const metrics = dashboard.data?.metrics;
  const pendingCount = pending.data?.documents.length ?? 0;
  const ocrPendingCount = ocrReview.data?.jobs.length ?? 0;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-7 text-brand" />
            <div>
              <h1 className="text-3xl font-display font-bold">Admin Console</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Document moderation, review queue, taxonomy, and platform administration.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={reindexSearch} disabled={reindexing}>
            <RefreshCw className={`size-4 ${reindexing ? "animate-spin" : ""}`} />{" "}
            {reindexing ? "Reindexing…" : "Rebuild search index"}
          </Button>
        </div>

        {/* Admin Navigation Tabs */}
        <div className="mt-8 flex flex-wrap gap-2 border-b border-border pb-3">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "dashboard"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("review_queue")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "review_queue"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            <span>Review Queue</span>
            {pendingCount > 0 && (
              <span className="grid min-w-4 place-items-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ocr_review")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "ocr_review"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            <span>OCR Review</span>
            {ocrPendingCount > 0 && (
              <span className="grid min-w-4 place-items-center rounded-full bg-muted px-1.5 text-[10px] font-bold">
                {ocrPendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("documents")}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "documents"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            All Documents ({allDocuments.data?.documents.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("taxonomy")}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "taxonomy"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            Taxonomy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("users")}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "users"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            Users ({users.data?.users.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("compliance")}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === "compliance"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            Reports & Copyright
          </button>
        </div>

        {/* REVIEW QUEUE TAB */}
        {activeTab === "review_queue" && (
          <section className="mt-6 rounded-xl border border-border bg-card p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Moderation Review Queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Documents submitted by contributors awaiting editorial approval before publication.
                </p>
              </div>
              <Badge variant={pendingCount > 0 ? "default" : "secondary"}>
                {pendingCount} {pendingCount === 1 ? "document" : "documents"} awaiting review
              </Badge>
            </div>

            <div className="mt-6 space-y-4">
              {pending.data?.documents.length ? (
                pending.data.documents.map((document) => (
                  <article
                    key={document.id}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-surface p-5 transition hover:border-brand/40 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-base font-semibold">
                          {document.title}
                        </span>
                        <Badge variant="outline">{document.docType}</Badge>
                        <Badge variant="secondary">{document.subject}</Badge>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {document.fileType} · {document.pages} pages
                        {document.uploadedBy ? ` · Uploaded by ${document.uploadedBy}` : ""}
                        {document.createdAt ? ` · Submitted ${new Date(document.createdAt).toLocaleString()}` : ""}
                      </p>
                      {document.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {document.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/document/$id" params={{ id: document.id }}>
                          <Eye className="mr-1.5 size-3.5" /> Preview
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => moderate(document.id, "approve")}
                        className="bg-brand text-brand-foreground"
                      >
                        <CheckCircle2 className="mr-1.5 size-3.5" /> Approve & Publish
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => moderate(document.id, "request_changes")}
                      >
                        <AlertTriangle className="mr-1.5 size-3.5" /> Request changes
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => moderate(document.id, "reject")}
                      >
                        <XCircle className="mr-1.5 size-3.5" /> Reject
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto size-8 text-brand" />
                  <p className="mt-3 font-display text-base font-semibold text-foreground">
                    All caught up!
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No documents currently require editorial review.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            icon={<FileText className="size-5" />}
            label="Documents"
            value={metrics?.totalDocuments ?? 0}
            detail={`${metrics?.publishedDocuments ?? 0} published`}
          />
          <Metric
            icon={<Search className="size-5" />}
            label="Searches"
            value={metrics?.totalSearches ?? 0}
            detail={`${metrics?.searchableChunks ?? 0} indexed sections`}
          />
          <Metric
            icon={<Download className="size-5" />}
            label="Downloads"
            value={metrics?.totalDownloads ?? 0}
          />
          <Metric
            icon={<Eye className="size-5" />}
            label="Views"
            value={metrics?.totalViews ?? 0}
          />
          <Metric
            icon={<FileClock className="size-5" />}
            label="Pending"
            value={metrics?.pendingUploads ?? 0}
            detail={`${metrics?.ocrAwaitingCorrection ?? 0} OCR corrections`}
          />
          <Metric
            icon={<MessageSquare className="size-5" />}
            label="Messages"
            value={metrics?.newContactMessages ?? 0}
            detail="new enquiries"
          />
          <Metric
            icon={<Flag className="size-5" />}
            label="Reports"
            value={metrics?.openReports ?? 0}
            detail="need review"
          />
          <Metric
            icon={<Scale className="size-5" />}
            label="Rights requests"
            value={metrics?.openCopyrightRequests ?? 0}
            detail={`${metrics?.restrictedDocuments ?? 0} restricted`}
          />
          <Metric
            icon={<Building2 className="size-5" />}
            label="Libraries"
            value={metrics?.totalLibraries ?? 0}
            detail={`${metrics?.privateLibraries ?? 0} private`}
          />
          <Metric
            icon={<Users className="size-5" />}
            label="Users"
            value={metrics?.totalUsers ?? 0}
            detail={`${metrics?.totalAdmins ?? 0} administrators`}
          />
        </section>

        <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl">
                <UserCog className="size-5 text-brand" /> User and administrator management
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Create accounts, promote or remove administrators, reset credentials and safely
                transfer owned libraries.
              </p>
            </div>
            <Badge variant="secondary">{users.data?.users.length ?? 0} accounts</Badge>
          </div>
          <div className="mt-5 grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-5">
            <input
              value={newUserName}
              onChange={(event) => setNewUserName(event.target.value)}
              placeholder="Full name"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            />
            <input
              value={newUserEmail}
              onChange={(event) => setNewUserEmail(event.target.value)}
              type="email"
              placeholder="Email"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            />
            <input
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
              type="password"
              placeholder="Temporary password"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            />
            <select
              value={newUserRole}
              onChange={(event) => setNewUserRole(event.target.value as "admin" | "user")}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </select>
            <Button onClick={createUser} disabled={creatingUser}>
              <UserPlus className="size-4" /> {creatingUser ? "Creating…" : "Create account"}
            </Button>
          </div>
          <div className="mt-4 max-h-[430px] divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {(users.data?.users ?? []).map((user) => (
              <article
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-4 bg-surface px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{user.name}</p>
                    <Badge variant={user.role === "admin" ? "secondary" : "outline"}>
                      {user.role}
                    </Badge>
                    {user.id === auth.data?.user?.id && <Badge variant="outline">you</Badge>}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {user.email} · {user.documentCount} documents · {user.ownedLibraryCount} owned
                    libraries
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => editUser(user)}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={user.id === auth.data?.user?.id}
                    onClick={() => deleteUser(user)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl">
                <FileText className="size-5 text-brand" /> Complete document control
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Edit metadata, publish, archive or permanently delete any document.
              </p>
            </div>
            <Badge variant="secondary">{allDocuments.data?.documents.length ?? 0} documents</Badge>
          </div>
          <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
            {(allDocuments.data?.documents ?? []).map((document) => (
              <article key={document.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display font-semibold">{document.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {document.subject} · {document.docType} · {document.fileType} · ID{" "}
                      {document.id}
                    </p>
                  </div>
                  <Badge variant={document.status === "published" ? "secondary" : "outline"}>
                    {document.status?.replaceAll("_", " ")}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => editDocument(document)}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                  {document.status !== "published" && (
                    <Button size="sm" onClick={() => moderate(document.id, "approve")}>
                      <CheckCircle2 className="size-4" /> Publish
                    </Button>
                  )}
                  {document.status !== "archived" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        apiFetch(`/api/admin/documents/${encodeURIComponent(document.id)}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            action: "archive",
                            reason: "Archived by administrator",
                          }),
                        })
                          .then(() => queryClient.invalidateQueries({ queryKey: ["admin"] }))
                          .then(() => toast.success("Document archived"))
                          .catch((error) =>
                            toast.error(
                              error instanceof Error ? error.message : "Could not archive document",
                            ),
                          )
                      }
                    >
                      <Archive className="size-4" /> Archive
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => deleteDocument(document)}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="text-xl">Documents awaiting review</h2>
              <Badge variant="secondary">{pending.data?.documents.length ?? 0}</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {pending.data?.documents.length ? (
                pending.data.documents.map((document) => (
                  <article
                    key={document.id}
                    className="rounded-lg border border-border bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-display font-semibold">{document.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {document.subject} · {document.docType} · {document.fileType} ·{" "}
                          {document.pages} pages
                        </p>
                      </div>
                      <Badge variant="outline">{document.status}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{document.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => moderate(document.id, "approve")}>
                        <CheckCircle2 className="size-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => moderate(document.id, "request_changes")}
                      >
                        <AlertTriangle className="size-4" /> Request changes
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => moderate(document.id, "reject")}
                      >
                        <XCircle className="size-4" /> Reject
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No documents are awaiting review.
                </p>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <h2 className="flex items-center gap-2 text-lg">
                <Database className="size-5 text-brand" /> Most searched subjects
              </h2>
              <div className="mt-4 space-y-2">
                {dashboard.data?.topSubjects.map((item) => (
                  <div
                    key={item.subject}
                    className="flex justify-between border-b border-border/60 pb-2 text-sm"
                  >
                    <span>{item.subject}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <h2 className="text-lg">Missing-document searches</h2>
              <p className="mt-1 text-xs text-muted-foreground">Search demand with zero results.</p>
              <div className="mt-4 space-y-2">
                {dashboard.data?.missingSearches.map((item) => (
                  <div key={item.query} className="rounded-md bg-surface p-3 text-sm">
                    <p className="font-medium">{item.query}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.searches} searches</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <h2 className="text-lg">Latest messages</h2>
              <div className="mt-4 space-y-3">
                {dashboard.data?.contactMessages.length ? (
                  dashboard.data.contactMessages.map((message) => (
                    <article key={message.id} className="rounded-md bg-surface p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{message.subject}</p>
                        <Badge variant="outline">{message.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{message.email}</p>
                      <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                        {message.message}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateMessage(message.id, "in_progress")}
                        >
                          In progress
                        </Button>
                        <Button size="sm" onClick={() => updateMessage(message.id, "resolved")}>
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateMessage(message.id, "spam")}
                        >
                          Spam
                        </Button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No contact messages.</p>
                )}
              </div>
            </section>
            <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <h2 className="flex items-center gap-2 text-lg">
                <History className="size-5 text-brand" /> Recent audit activity
              </h2>
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                {(audit.data?.logs ?? []).length ? (
                  audit.data!.logs.map((item) => (
                    <article key={item.id} className="rounded-md bg-surface p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{item.action.replaceAll(".", " ")}</p>
                        <span className="text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {item.userName || item.userEmail || "System"} · {item.entityType}
                        {item.entityId ? ` · ${item.entityId}` : ""}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No audit activity yet.</p>
                )}
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl">
                <ScanLine className="size-5 text-brand" /> OCR jobs awaiting correction
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the structured reconstruction editor to verify uncertain blocks before
                publication.
              </p>
            </div>
            <Badge variant="secondary">{ocrReview.data?.jobs.length ?? 0}</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ocrReview.data?.jobs.length ? (
              ocrReview.data.jobs.map((item) => (
                <article key={item.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display font-semibold">{item.originalFilename}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {item.userEmail || item.userName}
                      </p>
                    </div>
                    <Badge variant="destructive">
                      {item.structure.stats.lowConfidenceBlocks} uncertain
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.structure.stats.pages} pages</span>
                    <span>·</span>
                    <span>{item.structure.stats.questions} questions</span>
                    <span>·</span>
                    <span>revision {item.revision}</span>
                    <Badge variant={item.rightsDeclared ? "secondary" : "outline"}>
                      {item.rightsDeclared ? "rights declared" : "rights missing"}
                    </Badge>
                  </div>
                  <Button asChild size="sm" className="mt-4">
                    <Link to="/scanner" search={{ job: item.id }}>
                      Review OCR
                    </Link>
                  </Button>
                </article>
              ))
            ) : (
              <p className="col-span-full rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No OCR jobs are awaiting correction.
              </p>
            )}
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl">
                <Scale className="size-5 text-brand" /> Copyright and takedown queue
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Review claims, inspect private evidence, temporarily restrict access, contact
                uploaders, restore documents or remove confirmed infringements.
              </p>
            </div>
            <Badge variant="secondary">{copyrightRequests.data?.requests.length ?? 0}</Badge>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {copyrightRequests.data?.requests.length ? (
              copyrightRequests.data.requests.map((item) => (
                <article key={item.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to="/document/$id"
                        params={{ id: item.documentId }}
                        className="font-display font-semibold hover:text-brand"
                      >
                        {item.documentTitle}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.claimantName} · {item.claimantEmail}
                        {item.claimantOrganization ? ` · ${item.claimantOrganization}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Badge variant="outline">{item.status}</Badge>
                      <Badge
                        variant={
                          item.documentRightsStatus === "restricted" ? "destructive" : "secondary"
                        }
                      >
                        {item.documentRightsStatus}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{item.relationship.replaceAll("_", " ")}</span>
                    <span>·</span>
                    <span>asks to {item.requestedAction.replaceAll("_", " ")}</span>
                    <span>·</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {item.statement}
                  </p>
                  {item.evidenceFilename && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() =>
                        window.open(
                          `/api/admin/copyright-requests/${encodeURIComponent(item.id)}/evidence`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <ExternalLink className="size-4" /> View {item.evidenceFilename}
                    </Button>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateCopyright(item.id, "review")}
                    >
                      Review
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateCopyright(item.id, "contact_uploader")}
                    >
                      Contact uploader
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateCopyright(item.id, "restrict")}
                    >
                      Restrict
                    </Button>
                    {item.documentRightsStatus === "restricted" && (
                      <Button size="sm" onClick={() => updateCopyright(item.id, "restore")}>
                        Restore
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => updateCopyright(item.id, "remove")}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateCopyright(item.id, "dismiss")}
                    >
                      Dismiss
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="col-span-full rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No active copyright requests.
              </p>
            )}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl">
                <Flag className="size-5 text-brand" /> Open document reports
              </h2>
              <Badge variant="secondary">{reports.data?.reports.length ?? 0}</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {reports.data?.reports.length ? (
                reports.data.reports.map((report) => (
                  <article
                    key={report.id}
                    className="rounded-lg border border-border bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          to="/document/$id"
                          params={{ id: report.documentId }}
                          className="font-display font-semibold hover:text-brand"
                        >
                          {report.documentTitle}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {report.reporterEmail || "Anonymous report"}
                        </p>
                      </div>
                      <Badge variant="outline">{report.reason.replaceAll("_", " ")}</Badge>
                    </div>
                    {report.details && (
                      <p className="mt-3 text-sm text-muted-foreground">{report.details}</p>
                    )}
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" onClick={() => resolveReport(report.id, "resolved")}>
                        <CheckCircle2 className="size-4" /> Resolve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveReport(report.id, "dismissed")}
                      >
                        <XCircle className="size-4" /> Dismiss
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No open document reports.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="flex items-center gap-2 text-xl">
              <Tags className="size-5 text-brand" /> Subject and topic library
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Create internal metadata without forcing users through category navigation.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-3">
                <label className="text-xs font-semibold text-muted-foreground">New subject</label>
                <div className="mt-2 flex gap-2">
                  <input
                    value={subjectName}
                    onChange={(event) => setSubjectName(event.target.value)}
                    placeholder="e.g. Architecture"
                    className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                  />
                  <Button size="sm" onClick={addSubject}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <label className="text-xs font-semibold text-muted-foreground">New topic</label>
                <select
                  value={topicSubjectId}
                  onChange={(event) => setTopicSubjectId(event.target.value)}
                  className="mt-2 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">No parent subject</option>
                  {(taxonomy.data?.subjects ?? []).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex gap-2">
                  <input
                    value={topicName}
                    onChange={(event) => setTopicName(event.target.value)}
                    placeholder="e.g. Building Design"
                    className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                  />
                  <Button size="sm" onClick={addTopic}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {(taxonomy.data?.subjects ?? []).map((subject) => (
                <div key={subject.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{subject.name}</p>
                      <span className="text-xs text-muted-foreground">
                        {subject.topicCount} topics · {subject.documentCount} docs
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => editSubject(subject)}
                        aria-label={`Edit ${subject.name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteSubject(subject)}
                        aria-label={`Delete ${subject.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(taxonomy.data?.topics ?? [])
                      .filter((topic) => topic.subjectId === subject.id)
                      .map((topic) => (
                        <span
                          key={topic.id}
                          className="inline-flex items-center rounded-full border border-border bg-background pl-2 text-xs"
                        >
                          <button
                            type="button"
                            className="py-1 hover:text-brand"
                            onClick={() => editTopic(topic)}
                          >
                            {topic.name}
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-1 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteTopic(topic)}
                            aria-label={`Delete ${topic.name}`}
                          >
                            <XCircle className="size-3" />
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
              ))}
              {(taxonomy.data?.topics ?? []).filter((topic) => topic.subjectId == null).length >
                0 && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <p className="font-semibold">Unassigned topics</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {taxonomy
                      .data!.topics.filter((topic) => topic.subjectId == null)
                      .map((topic) => (
                        <span
                          key={topic.id}
                          className="inline-flex items-center rounded-full border border-border bg-background pl-2 text-xs"
                        >
                          <button
                            type="button"
                            className="py-1 hover:text-brand"
                            onClick={() => editTopic(topic)}
                          >
                            {topic.name}
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-1 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteTopic(topic)}
                          >
                            <XCircle className="size-3" />
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
      <PromptModal modalState={promptModal} />
      <ConfirmModal modalState={confirmModal} />
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center gap-2 text-brand">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold">{value.toLocaleString()}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
