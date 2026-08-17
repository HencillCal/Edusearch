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
        <h1 className="text-3xl">Upload a document</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Institution details are optional. Files are scanned, text-extracted, classified and
          duplicate-checked before publication.
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

        <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-soft">
          <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-surface p-10 text-center transition hover:border-brand">
            <FileUp className="size-7 text-brand" />
            <p className="mt-3 font-display text-lg font-semibold">
              Drop PDF, DOCX, images or a ZIP folder
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to 25 files per batch · 50 MB per file by default
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.heic,.zip"
              className="hidden"
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                setUploads([]);
              }}
            />
            <Button
              type="button"
              className="mt-5"
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
            <>
              <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
                {uploads.map((upload, index) => (
                  <button
                    key={upload.id}
                    type="button"
                    onClick={() => chooseUpload(index)}
                    className={`min-w-56 rounded-lg border p-3 text-left text-sm ${index === selectedIndex ? "border-brand bg-brand-soft" : "border-border bg-surface"}`}
                  >
                    <span className="block truncate font-medium">{upload.originalFilename}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {upload.fileType} · {upload.pages} pages
                    </span>
                  </button>
                ))}
              </div>

              {selected && (
                <div className="mt-4 rounded-lg border border-brand/40 bg-brand-soft p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-brand">
                    <Sparkles className="size-4" /> AI and extraction result
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      <CheckCircle2 className="mr-1 size-3" /> {selected.virusScan}
                    </Badge>
                    <Badge variant="secondary">Course: {selected.suggestions.subject}</Badge>
                    <Badge variant="secondary">Type: {selected.suggestions.docType}</Badge>
                    <Badge variant="secondary">Year: {selected.suggestions.year}</Badge>
                    {selected.duplicate.kind === "none" ? (
                      <Badge variant="secondary">No exact duplicate found</Badge>
                    ) : (
                      <Badge variant="destructive">
                        <AlertTriangle className="mr-1 size-3" /> Possible {selected.duplicate.kind}{" "}
                        duplicate
                      </Badge>
                    )}
                  </div>
                  {selected.textPreview && (
                    <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">
                      {selected.textPreview}
                    </p>
                  )}
                </div>
              )}

              <form
                className="mt-6 grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => event.preventDefault()}
              >
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
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Right to share</span>
                  <select
                    value={rightsBasis}
                    onChange={(event) => setRightsBasis(event.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                  >
                    <option value="own_work">I created this document</option>
                    <option value="permission">I have permission from the rights holder</option>
                    <option value="institution_authorized">
                      My institution authorized this upload
                    </option>
                    <option value="public_domain">
                      The document is public domain or openly licensed
                    </option>
                  </select>
                </label>
                <Field
                  label="Source or licence attribution (optional)"
                  value={sourceAttribution}
                  onChange={setSourceAttribution}
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
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Institution library</span>
                  <select
                    value={libraryId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setLibraryId(value);
                      const library = manageableLibraries.find((item) => item.id === value);
                      setDocumentVisibility(
                        library?.visibility === "private" ? "library" : "public",
                      );
                    }}
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                  >
                    <option value="">Public platform library</option>
                    {manageableLibraries.map((library) => (
                      <option key={library.id} value={library.id}>
                        {library.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Document access</span>
                  <select
                    value={documentVisibility}
                    disabled={!libraryId}
                    onChange={(event) =>
                      setDocumentVisibility(event.target.value as "public" | "library")
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60"
                  >
                    <option value="public">Public and searchable</option>
                    <option value="library">Library members only</option>
                  </select>
                </label>
                <label className="sm:col-span-2 block">
                  <span className="mb-1.5 block text-sm font-medium">Description</span>
                  <textarea
                    rows={4}
                    value={metadata.description}
                    onChange={(event) =>
                      setMetadata({ ...metadata, description: event.target.value })
                    }
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </label>
                <label className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
                  <input
                    type="checkbox"
                    checked={rightsDeclared}
                    onChange={(event) => setRightsDeclared(event.target.checked)}
                    className="mt-1 size-4"
                  />
                  <span>
                    I confirm that the information above is accurate and that I own this material,
                    have permission, or have another lawful basis to upload and share it. I
                    understand that verified rights holders can request restriction or removal.
                  </span>
                </label>
                <div className="sm:col-span-2 flex flex-wrap gap-2">
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
            </>
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
