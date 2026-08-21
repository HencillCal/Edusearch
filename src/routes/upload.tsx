import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { documentTypes } from "@/lib/edusearch-data";
import { apiFetch, type ApiLibrary, ApiError } from "@/lib/api";
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

type UploadItem = {
  id: string;
  file: File;
  status: "idle" | "uploading" | "analyzing" | "ready" | "failed";
  progress: number;
  error?: string;
  analyzed?: AnalyzedUpload;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText className="size-4 text-red-500" />;
  if (ext === "docx" || ext === "doc") return <FileText className="size-4 text-blue-500" />;
  if (["png", "jpg", "jpeg", "webp", "heic"].includes(ext || ""))
    return <ImageIcon className="size-4 text-emerald-500" />;
  if (ext === "zip") return <FileCode className="size-4 text-amber-500" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

export function UploadPage() {
  const auth = useAuth();
  const navigate = useNavigate();
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

  const [items, setItems] = useState<UploadItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata());
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Successfully analyzed uploads
  const readyUploads = items
    .filter((it): it is UploadItem & { analyzed: AnalyzedUpload } => it.status === "ready" && Boolean(it.analyzed))
    .map((it) => it.analyzed);

  const selected = readyUploads[selectedIndex];

  const handleFilesSelected = (newFiles: FileList | File[]) => {
    const fileList = Array.from(newFiles).filter(Boolean);
    if (!fileList.length) return;

    setItems((prev) => {
      const existingKeys = new Set(prev.map((it) => `${it.file.name}_${it.file.size}_${it.file.lastModified}`));
      const added: UploadItem[] = [];

      for (const file of fileList) {
        const key = `${file.name}_${file.size}_${file.lastModified}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          added.push({
            id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            file,
            status: "idle",
            progress: 0,
          });
        }
      }

      if (added.length < fileList.length) {
        toast.info("Duplicate files in selection were skipped.");
      }
      return [...prev, ...added];
    });
  };

  const removeFile = (id: string) => {
    setItems((prev) => {
      const filtered = prev.filter((it) => it.id !== id);
      const remainingReady = filtered.filter((it) => it.status === "ready");
      if (selectedIndex >= remainingReady.length) {
        setSelectedIndex(Math.max(0, remainingReady.length - 1));
      }
      return filtered;
    });
  };

  const clearAll = () => {
    setItems([]);
    setSelectedIndex(0);
    setMetadata(emptyMetadata());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const analyzeSingleFileItem = async (item: UploadItem) => {
    // Mark uploading
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: "uploading", progress: 30, error: undefined } : it)),
    );

    try {
      const body = new FormData();
      body.append("file", item.file);

      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: "analyzing", progress: 60 } : it)),
      );

      const result = await apiFetch<{ upload?: AnalyzedUpload; uploads?: AnalyzedUpload[] }>(
        "/api/uploads/analyze-file",
        {
          method: "POST",
          body,
        },
      );

      const analyzed = result.upload || result.uploads?.[0];
      if (!analyzed) throw new Error("Could not extract document metadata.");

      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, status: "ready", progress: 100, analyzed }
            : it,
        ),
      );

      return analyzed;
    } catch (err) {
      let errorMessage = "Analysis failed";
      if (err instanceof ApiError) {
        errorMessage = err.message;
        if (err.requestId) errorMessage += ` (Ref: ${err.requestId})`;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }

      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, status: "failed", progress: 0, error: errorMessage }
            : it,
        ),
      );
      throw err;
    }
  };

  const analyzeAll = async () => {
    if (!auth.data?.user) {
      toast.error("Please log in to upload and analyze documents.");
      navigate({ to: "/login" });
      return;
    }

    const pending = items.filter((it) => it.status === "idle" || it.status === "failed");
    if (!pending.length) {
      toast.info("All selected files have already been analyzed.");
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;

    // Run parallel with bounded concurrency of 3
    const concurrency = 3;
    const queue = [...pending];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        try {
          const analyzed = await analyzeSingleFileItem(item);
          successCount++;
          if (successCount === 1) {
            setMetadata(analyzed.suggestions);
          }
        } catch {
          failCount++;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, pending.length) }).map(() => worker());
    await Promise.all(workers);

    setIsProcessing(false);

    if (successCount > 0 && failCount === 0) {
      toast.success(`${successCount} file${successCount === 1 ? "" : "s"} analyzed successfully!`);
    } else if (successCount > 0 && failCount > 0) {
      toast.warning(`${successCount} analyzed, ${failCount} failed. You can retry failed files.`);
    } else if (failCount > 0) {
      toast.error("File analysis failed. Please check error details.");
    }
  };

  const chooseUpload = (index: number) => {
    setSelectedIndex(index);
    if (readyUploads[index]) {
      setMetadata(readyUploads[index].suggestions);
    }
  };

  const submit = async (status: "draft" | "awaiting_review") => {
    if (!selected) return;
    if (status === "awaiting_review" && !rightsDeclared) {
      return toast.error("Confirm that you have the right to share this document");
    }
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

      // Remove the submitted item from list
      setItems((prev) => prev.filter((it) => it.analyzed?.id !== selected.id));
      setSelectedIndex(0);
      const remainingReady = readyUploads.filter((u) => u.id !== selected.id);
      if (remainingReady[0]) {
        setMetadata(remainingReady[0].suggestions);
      } else {
        setMetadata(emptyMetadata());
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">
              Upload Documents
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              Upload and publish academic notes, exams, past papers, or guides. Metadata is auto-detected.
            </p>
          </div>
          {auth.data?.user && (
            <Button variant="outline" size="sm" asChild className="h-8 text-xs">
              <Link to="/saved">View My Library</Link>
            </Button>
          )}
        </div>

        {!auth.isLoading && !auth.data?.user && (
          <div className="mt-5 rounded-xl border border-brand/40 bg-brand-soft/60 p-4 text-xs flex flex-wrap items-center justify-between gap-3">
            <span className="text-foreground">
              Please log in to upload documents and contribute to the academic repository.
            </span>
            <Button size="sm" asChild className="h-7 text-xs">
              <Link to="/login">Log in</Link>
            </Button>
          </div>
        )}

        {/* Dropzone Container */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft space-y-6">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
            }}
            className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-surface p-8 text-center transition hover:border-brand/60 hover:bg-brand-soft/20"
          >
            <FileUp className="size-8 text-brand mb-2" />
            <p className="font-display text-base sm:text-lg font-semibold text-foreground">
              Drop PDF, DOCX, images or a ZIP folder
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to 25 files per batch · Maximum 50 MB per file
            </p>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4 h-8 px-4 text-xs font-medium"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Upload className="mr-1.5 size-3.5" /> Choose files
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.heic,.zip"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesSelected(e.target.files);
              }}
            />
          </div>

          {/* Selected Files List & Actions */}
          {items.length > 0 && (
            <div className="space-y-3 border-t border-border/80 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Selected files ({items.length})
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  disabled={isProcessing}
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="mr-1 size-3" /> Clear all
                </Button>
              </div>

              <div className="divide-y divide-border/60 rounded-xl border border-border bg-surface/50 max-h-60 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-2.5 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                      <span className="shrink-0">{getFileIcon(item.file.name)}</span>
                      <span className="truncate font-medium text-foreground max-w-[260px] sm:max-w-sm" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        ({formatBytes(item.file.size)})
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === "idle" && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Ready
                        </Badge>
                      )}
                      {item.status === "uploading" && (
                        <Badge variant="secondary" className="text-[10px] text-brand">
                          <Loader2 className="mr-1 size-2.5 animate-spin" /> Uploading
                        </Badge>
                      )}
                      {item.status === "analyzing" && (
                        <Badge variant="secondary" className="text-[10px] text-brand">
                          <Loader2 className="mr-1 size-2.5 animate-spin" /> Analyzing
                        </Badge>
                      )}
                      {item.status === "ready" && (
                        <Badge variant="secondary" className="text-[10px] text-emerald-600 bg-emerald-50">
                          <CheckCircle2 className="mr-1 size-3" /> Ready
                        </Badge>
                      )}
                      {item.status === "failed" && (
                        <div className="flex items-center gap-1.5">
                          <Badge variant="destructive" className="text-[10px] max-w-[140px] truncate" title={item.error}>
                            Failed
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 text-brand"
                            onClick={() => analyzeSingleFileItem(item)}
                            title="Retry this file"
                          >
                            <RefreshCw className="size-3" />
                          </Button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => removeFile(item.id)}
                        disabled={isProcessing && item.status === "analyzing"}
                        className="p-1 text-muted-foreground hover:text-destructive transition rounded"
                        title="Remove file"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Button */}
              {items.some((it) => it.status === "idle" || it.status === "failed") && (
                <div className="pt-2 flex justify-end">
                  <Button
                    type="button"
                    disabled={isProcessing}
                    onClick={analyzeAll}
                    className="h-9 px-4 text-xs font-semibold"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Analyzing files...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 size-3.5" /> Analyze {items.length} file{items.length === 1 ? "" : "s"}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Analyzed Documents Review Section */}
          {readyUploads.length > 0 && (
            <div className="space-y-4 border-t border-border pt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Ready for Metadata Review ({readyUploads.length})
                </h2>
              </div>

              {/* File Selector Tabs if multiple */}
              {readyUploads.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {readyUploads.map((upload, index) => (
                    <button
                      key={upload.id}
                      type="button"
                      onClick={() => chooseUpload(index)}
                      className={`min-w-48 max-w-64 rounded-lg border p-2.5 text-left text-xs transition ${
                        index === selectedIndex
                          ? "border-brand bg-brand-soft/80 font-medium text-brand"
                          : "border-border bg-surface text-foreground hover:border-brand/40"
                      }`}
                    >
                      <span className="block truncate font-semibold">{upload.originalFilename}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {upload.fileType} · {upload.pages} pages
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected Metadata Editor */}
              {selected && (
                <div className="rounded-xl border border-brand/30 bg-brand-soft/30 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                        AI Detected Summary
                      </span>
                      <h3 className="font-display text-sm sm:text-base font-semibold text-foreground truncate max-w-md">
                        {selected.originalFilename}
                      </h3>
                    </div>
                    <div className="flex gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[11px]">{selected.fileType}</Badge>
                      <Badge variant="secondary" className="text-[11px]">
                        {selected.pages} {selected.pages === 1 ? "page" : "pages"}
                      </Badge>
                    </div>
                  </div>

                  <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Document Title"
                        value={metadata.title}
                        onChange={(value) => setMetadata({ ...metadata, title: value })}
                      />
                      <Field
                        label="Subject / Course"
                        value={metadata.subject}
                        onChange={(value) => setMetadata({ ...metadata, subject: value })}
                      />
                      <SelectField
                        label="Document Type"
                        value={metadata.docType}
                        options={documentTypes}
                        onChange={(value) => setMetadata({ ...metadata, docType: value })}
                      />
                      <Field
                        label="Topics (comma separated)"
                        value={metadata.topics.join(", ")}
                        onChange={(value) => setMetadata({ ...metadata, topics: splitList(value) })}
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs">
                        <span className="font-medium text-muted-foreground mb-1 block">Sharing Permission</span>
                        <select
                          value={rightsBasis}
                          onChange={(e) => setRightsBasis(e.target.value)}
                          className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs outline-none focus:border-brand"
                        >
                          <option value="own_work">I created this document</option>
                          <option value="permission">I have permission to share it</option>
                          <option value="public_domain">Public domain or openly licensed</option>
                          <option value="institution_authorized">Institution authorized</option>
                        </select>
                      </label>
                      <Field
                        label="Source Attribution (optional)"
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
                        {showAdvanced ? "▲ Hide optional details" : "▼ Edit optional details (Year, Level, Institution, Description)"}
                      </button>

                      {showAdvanced && (
                        <div className="mt-3 grid gap-3 rounded-lg border border-border bg-surface p-3.5 sm:grid-cols-2">
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
                            label="Author / Lecturer (optional)"
                            value={metadata.author}
                            onChange={(value) => setMetadata({ ...metadata, author: value })}
                          />
                          <label className="sm:col-span-2 block text-xs">
                            <span className="font-medium text-muted-foreground mb-1 block">Description</span>
                            <textarea
                              rows={2}
                              value={metadata.description}
                              onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <label className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rightsDeclared}
                        onChange={(e) => setRightsDeclared(e.target.checked)}
                        className="mt-0.5 size-4 rounded"
                      />
                      <span>
                        I confirm that I own this material, have permission, or have a lawful basis to share it.
                      </span>
                    </label>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={submitting}
                        onClick={() => submit("awaiting_review")}
                        className="h-8 text-xs font-semibold"
                      >
                        {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                        {auth.data?.user?.role === "admin" ? "Publish document" : "Submit for review"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={submitting}
                        onClick={() => submit("draft")}
                        className="h-8 text-xs"
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
    <label className="block text-xs">
      <span className="font-medium text-muted-foreground mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs outline-none focus:border-brand"
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
    <label className="block text-xs">
      <span className="font-medium text-muted-foreground mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-brand"
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
