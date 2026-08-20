import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { documentTypes } from "@/lib/edusearch-data";
import { apiFetch, type ApiLibrary } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Upload an academic document — EduSearch AI" }] }),
  component: UploadPage,
});

type Metadata = {
  title: string;
  subject: string;
  topics: string[];
  docType: string;
  year: number;
  level: string;
  language: string;
  description: string;
  keywords: string[];
  institution: string;
  author: string;
};

type AnalyzedUpload = {
  id: string;
  originalFilename: string;
  fileType: string;
  sizeBytes: number;
  pages: number;
  suggestions: Metadata;
  duplicate: { kind: string; documentId?: string; title?: string };
  virusScan: string;
  textPreview: string;
};

function UploadPage() {
  const auth = useAuth();
  const [libraryId, setLibraryId] = useState("");
  const [documentVisibility, setDocumentVisibility] = useState<"public" | "library">("public");
  const [rightsBasis, setRightsBasis] = useState("own_work");
  const [sourceAttribution, setSourceAttribution] = useState("");
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const libraryQuery = useQuery({
    queryKey: ["libraries"],
    queryFn: () => apiFetch<{ libraries: ApiLibrary[] }>("/api/libraries"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const manageableLibraries = (libraryQuery.data?.libraries ?? []).filter(
    (library) => library.canManage,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<AnalyzedUpload[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata());
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selected = uploads[selectedIndex];

  const analyze = async () => {
    if (!files.length) return toast.error("Choose at least one file");
    setAnalyzing(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      const result = await apiFetch<{ uploads: AnalyzedUpload[] }>("/api/uploads/analyze", {
        method: "POST",
        body,
      });
      setUploads(result.uploads);
      setSelectedIndex(0);
      setMetadata(result.uploads[0]?.suggestions ?? emptyMetadata());
      toast.success(
        `${result.uploads.length} file${result.uploads.length === 1 ? "" : "s"} analyzed`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "File analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const chooseUpload = (index: number) => {
    setSelectedIndex(index);
    setMetadata(uploads[index].suggestions);
  };

  const submit = async (status: "draft" | "awaiting_review") => {
    if (!selected) return;
    if (status === "awaiting_review" && !rightsDeclared)
      return toast.error("Confirm that you have the right to share this document");
    setSubmitting(true);
    try {
      const result = await apiFetch<{ document: { id: string; title: string }; status: string }>(
        "/api/uploads/submit",
        {
          method: "POST",
          body: JSON.stringify({
            uploadId: selected.id,
            metadata,
            status,
            publishNow: auth.data?.user?.role === "admin" && status === "awaiting_review",
            libraryId: libraryId || null,
            visibility: libraryId ? documentVisibility : "public",
            rightsBasis,
            sourceAttribution,
            rightsDeclaration: rightsDeclared,
          }),
        },
      );
      toast.success(
        result.status === "published"
          ? "Document published"
          : status === "draft"
            ? "Draft saved"
            : "Submitted for review",
      );
      const remaining = uploads.filter((_, index) => index !== selectedIndex);
      setUploads(remaining);
      setSelectedIndex(0);
      setMetadata(remaining[0]?.suggestions ?? emptyMetadata());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-display font-bold">Upload a document</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload and publish academic notes, exams, past papers, or guides. Metadata is detected automatically.
        </p>

        {!auth.isLoading && !auth.data?.user && (
          <div className="mt-6 rounded-xl border border-highlight/50 bg-highlight/10 p-4 text-sm">
            Registered contributors can upload documents.{" "}
            <Link to="/login" className="font-semibold text-brand">
              Log in
            </Link>{" "}
            or{" "}
            <Link to="/register" className="font-semibold text-brand">
              create an account
            </Link>
            .
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-surface p-8 text-center transition hover:border-brand">
            <FileUp className="size-8 text-brand" />
            <p className="mt-3 font-display text-lg font-semibold">
              Drop PDF, DOCX, images or a ZIP folder
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to 25 files per batch · 50 MB per file
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.heic,.zip"
              className="hidden"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                setFiles(selected);
                setUploads([]);
                if (selected.length) {
                  // auto-trigger analyze on selection
                  setTimeout(() => {
                    const btn = document.getElementById("analyze-btn");
                    if (btn) btn.click();
                  }, 100);
                }
              }}
            />
            <Button
              id="analyze-btn"
              type="button"
              className="mt-4"
              disabled={!auth.data?.user || analyzing}
              onClick={(event) => {
                event.preventDefault();
                if (files.length) analyze();
                else fileInputRef.current?.click();
              }}
            >
              {analyzing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {analyzing
                ? "Extracting and classifying…"
                : files.length
                  ? `Analyze ${files.length} file${files.length === 1 ? "" : "s"}`
                  : "Choose files"}
            </Button>
          </label>

          {files.length > 0 && uploads.length === 0 && !analyzing && (
            <div className="mt-4 flex flex-wrap gap-2">
              {files.map((file) => (
                <Badge key={`${file.name}-${file.size}`} variant="outline">
                  {file.name}
                </Badge>
              ))}
            </div>
          )}

          {uploads.length > 0 && (
            <div className="mt-6 space-y-6">
              {uploads.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {uploads.map((upload, index) => (
                    <button
                      key={upload.id}
                      type="button"
                      onClick={() => chooseUpload(index)}
                      className={`min-w-56 rounded-lg border p-3 text-left text-sm transition ${
                        index === selectedIndex ? "border-brand bg-brand-soft" : "border-border bg-surface"
                      }`}
                    >
                      <span className="block truncate font-medium">{upload.originalFilename}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {upload.fileType} · {upload.pages} pages
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                        AI Detected Summary
                      </span>
                      <h3 className="font-display text-base font-semibold text-foreground">
                        {selected.originalFilename}
                      </h3>
                    </div>
                    <div className="flex gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="secondary">{selected.fileType}</Badge>
                      <Badge variant="secondary">{selected.pages} {selected.pages === 1 ? "page" : "pages"}</Badge>
                    </div>
                  </div>

                  <form className="mt-4 space-y-4" onSubmit={(event) => event.preventDefault()}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Document title"
                        value={metadata.title}
                        onChange={(value) => setMetadata({ ...metadata, title: value })}
                      />
                      <Field
                        label="Course or subject"
                        value={metadata.subject}
                        onChange={(value) => setMetadata({ ...metadata, subject: value })}
                      />
                      <SelectField
                        label="Document type"
                        value={metadata.docType}
                        options={documentTypes}
                        onChange={(value) => setMetadata({ ...metadata, docType: value })}
                      />
                      <Field
                        label="Topics"
                        value={metadata.topics.join(", ")}
                        onChange={(value) => setMetadata({ ...metadata, topics: splitList(value) })}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-medium">Sharing permission</span>
                        <select
                          value={rightsBasis}
                          onChange={(event) => setRightsBasis(event.target.value)}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                        >
                          <option value="own_work">I created this document</option>
                          <option value="permission">I have permission to share it</option>
                          <option value="public_domain">It is public domain or openly licensed</option>
                          <option value="institution_authorized">Institution authorized</option>
                        </select>
                      </label>
                      <Field
                        label="Source / attribution (optional)"
                        value={sourceAttribution}
                        onChange={setSourceAttribution}
                      />
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        {showAdvanced ? "▲ Hide optional details" : "▼ Edit optional details (Year, Level, Institution, Description, Keywords)"}
                      </button>

                      {showAdvanced && (
                        <div className="mt-3 grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
                          <Field
                            label="Year"
                            value={String(metadata.year)}
                            onChange={(value) =>
                              setMetadata({ ...metadata, year: Number(value) || new Date().getFullYear() })
                            }
                          />
                          <Field
                            label="Level"
                            value={metadata.level}
                            onChange={(value) => setMetadata({ ...metadata, level: value })}
                          />
                          <Field
                            label="Institution (optional)"
                            value={metadata.institution}
                            onChange={(value) => setMetadata({ ...metadata, institution: value })}
                          />
                          <Field
                            label="Author or lecturer (optional)"
                            value={metadata.author}
                            onChange={(value) => setMetadata({ ...metadata, author: value })}
                          />
                          <Field
                            label="Keywords"
                            value={metadata.keywords.join(", ")}
                            onChange={(value) => setMetadata({ ...metadata, keywords: splitList(value) })}
                          />
                          <SelectField
                            label="Language"
                            value={metadata.language}
                            options={["English", "Kiswahili", "French", "Arabic", "Other"]}
                            onChange={(value) => setMetadata({ ...metadata, language: value })}
                          />
                          <label className="sm:col-span-2 block">
                            <span className="mb-1.5 block text-sm font-medium">Description</span>
                            <textarea
                              rows={3}
                              value={metadata.description}
                              onChange={(event) =>
                                setMetadata({ ...metadata, description: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <label className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={rightsDeclared}
                        onChange={(event) => setRightsDeclared(event.target.checked)}
                        className="mt-0.5 size-4"
                      />
                      <span>
                        I confirm that I own this material, have permission, or have a lawful basis to upload and share it.
                      </span>
                    </label>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        type="button"
                        disabled={submitting}
                        onClick={() => submit("awaiting_review")}
                      >
                        {submitting && <Loader2 className="size-4 animate-spin" />}
                        {auth.data?.user?.role === "admin" ? "Publish document" : "Submit for review"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={submitting}
                        onClick={() => submit("draft")}
                      >
                        Save draft
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function emptyMetadata(): Metadata {
  return {
    title: "",
    subject: "General Studies",
    topics: [],
    docType: "Notes",
    year: new Date().getFullYear(),
    level: "Unspecified",
    language: "English",
    description: "",
    keywords: [],
    institution: "",
    author: "",
  };
}

function splitList(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
