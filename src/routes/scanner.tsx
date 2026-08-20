import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileClock,
  FileText,
  FileUp,
  History,
  Loader2,
  RotateCcw,
  Save,
  ScanLine,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal, type ConfirmModalState } from "@/components/ui/prompt-dialog";
import {
  apiFetch,
  type OcrBlock,
  type OcrBlockType,
  type OcrJob,
  type OcrPreflight,
  type OcrRevision,
  type OcrStructure,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

type ScannerSearch = { job?: string };

export const Route = createFileRoute("/scanner")({
  validateSearch: (search: Record<string, unknown>): ScannerSearch => ({
    job: typeof search.job === "string" ? search.job : undefined,
  }),
  head: () => ({ meta: [{ title: "AI OCR Reconstruction & Document Editor — EduSearch AI" }] }),
  component: ScannerPage,
});

const steps = [
  "Image enhancement",
  "OCR extraction",
  "Layout reconstruction",
  "Question and marks detection",
  "Confidence review",
  "PDF and DOCX generation",
];

const semanticTags: Array<{ value: OcrBlockType; label: string; format: (text: string) => string }> = [
  { value: "title", label: "Title", format: (t) => `# ${t.toUpperCase()}` },
  { value: "section", label: "Section", format: (t) => `## ${t}` },
  { value: "question", label: "Question", format: (t) => `Question: ${t}` },
  { value: "subquestion", label: "Sub-question", format: (t) => `  a) ${t}` },
  { value: "instruction", label: "Instruction", format: (t) => `*Note: ${t}*` },
  { value: "formula", label: "Formula", format: (t) => `$$ ${t} $$` },
  { value: "paragraph", label: "Paragraph", format: (t) => t },
];

function ScannerPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { job: requestedJobId } = Route.useSearch();
  const [stage, setStage] = useState<"idle" | "processing" | "done" | "failed">(
    requestedJobId ? "processing" : "idle",
  );
  const [job, setJob] = useState<OcrJob | null>(null);
  const [structure, setStructure] = useState<OcrStructure | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [selectedPage, setSelectedPage] = useState(1);
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [rightsBasis, setRightsBasis] = useState<OcrJob["rightsBasis"]>("unspecified");
  const [sourceAttribution, setSourceAttribution] = useState("");
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const [profile, setProfile] = useState<OcrJob["profile"]>("exam");
  const [qualityMode, setQualityMode] = useState<OcrJob["qualityMode"]>("balanced");
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [reprocessing, setReprocessing] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [currentIssueIndex, setCurrentIssueIndex] = useState(0);
  const [isReviewingIssues, setIsReviewingIssues] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedJob = useQuery({
    queryKey: ["ocr-job", requestedJobId],
    queryFn: () =>
      apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${encodeURIComponent(requestedJobId || "")}`),
    enabled: typeof window !== "undefined" && Boolean(requestedJobId),
    retry: false,
    refetchInterval: (query) => {
      const current = query.state.data as { job?: OcrJob } | undefined;
      return current?.job?.status === "processing" ? 1500 : false;
    },
  });
  const recentJobs = useQuery({
    queryKey: ["ocr-jobs", "mine"],
    queryFn: () => apiFetch<{ jobs: OcrJob[] }>("/api/ocr/jobs"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const revisions = useQuery({
    queryKey: ["ocr-revisions", job?.id],
    queryFn: () =>
      apiFetch<{ revisions: OcrRevision[] }>(
        `/api/ocr/jobs/${encodeURIComponent(job?.id || "")}/revisions`,
      ),
    enabled: typeof window !== "undefined" && Boolean(job?.id),
    retry: false,
  });

  useEffect(() => {
    if (selectedJob.data?.job) applyJob(selectedJob.data.job);
  }, [selectedJob.data]);

  const applyJob = (nextJob: OcrJob) => {
    setJob(nextJob);
    setStructure(nextJob.structure.pages.length ? cloneStructure(nextJob.structure) : null);
    setMetadata({ ...nextJob.metadata });
    setRawText(nextJob.correctedText || nextJob.extractedText);
    setRightsBasis(nextJob.rightsBasis || "unspecified");
    setSourceAttribution(nextJob.sourceAttribution || "");
    setRightsDeclared(nextJob.rightsDeclared);
    setProfile(nextJob.profile || "exam");
    setQualityMode(nextJob.qualityMode || "balanced");
    setOcrLanguage(nextJob.language || "eng");
    setSelectedPage((current) =>
      Math.min(Math.max(1, current), Math.max(1, nextJob.structure.pages.length)),
    );
    setStage(
      nextJob.status === "failed"
        ? "failed"
        : nextJob.status === "processing"
          ? "processing"
          : "done",
    );
  };

  const chooseFiles = async (selected: FileList | File[]) => {
    const files = Array.from(selected).filter(Boolean);
    if (!files.length) return;
    setStage("processing");
    try {
      const form = new FormData();
      for (const file of files) form.append("images", file);
      form.append("profile", profile);
      form.append("qualityMode", qualityMode);
      form.append("language", ocrLanguage);
      form.append("combineAsDocument", "true");
      const result = await apiFetch<{ job: OcrJob }>("/api/ocr/jobs", { method: "POST", body: form });
      applyJob(result.job);
      await navigate({ to: "/scanner", search: { job: result.job.id }, replace: true });
      await queryClient.invalidateQueries({ queryKey: ["ocr-jobs"] });
    } catch (error) {
      setStage("idle");
      toast.error(error instanceof Error ? error.message : "OCR failed");
    }
  };

  const currentPage =
    structure?.pages.find((page) => page.pageNumber === selectedPage) || structure?.pages[0];

  const liveStats = useMemo(() => {
    const blocks = structure?.pages.flatMap((page) => page.blocks) || [];
    const lowConf = blocks.filter(
      (block) =>
        (block.needsReview || block.confidence < 70 || (block.agreement ?? 1) < 0.58) &&
        !block.reviewed,
    );
    return {
      pages: structure?.pages.length || 0,
      blocks: blocks.length,
      lowConfidenceBlocks: lowConf.length,
      lowConfItems: lowConf,
      questions: blocks.filter((block) => block.type === "question" || block.type === "subquestion")
        .length,
      totalMarks: blocks.reduce((sum, block) => sum + (block.marks || 0), 0),
    };
  }, [structure]);

  const canDeclareRights = Boolean(
    auth.data?.user && (!job?.contributorUserId || job.contributorUserId === auth.data.user.id),
  );

  const aiOrganiseDocument = () => {
    if (!rawText.trim()) return;
    const lines = rawText.split("\n");
    const processed: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) {
        processed.push("");
        continue;
      }
      if (/^(?:question\s+\d+|q\d+[\.:]|\d+[\.\)]\s+)/i.test(line)) {
        line = line.replace(/^(question\s+\d+)/i, "\n$1").trim();
      }
      line = line.replace(/\[\s*(\d+)\s*marks?\s*\]/gi, " [$1 Marks]");
      line = line.replace(/\(\s*(\d+)\s*marks?\s*\)/gi, " ($1 Marks)");
      if (
        processed.length > 0 &&
        processed[processed.length - 1] &&
        !/[.:?!\]\)]$/.test(processed[processed.length - 1]) &&
        !/^(?:question|\d+[\.\)]|[a-z][\.\)]|[ivx]+[\.\)])/i.test(line) &&
        line.length > 0 &&
        !/^[A-Z\s]{4,}$/.test(line)
      ) {
        processed[processed.length - 1] += " " + line;
      } else {
        processed.push(line);
      }
    }
    const cleaned = processed.join("\n").replace(/\n{3,}/g, "\n\n");
    setRawText(cleaned);
    toast.success("AI Organised document layout, questions, and marks");
  };

  const applySemanticTag = (tag: (typeof semanticTags)[number]) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = rawText.substring(start, end);
    if (!selected) {
      toast.info("Highlight text in the editor first to tag it");
      return;
    }
    const formatted = tag.format(selected);
    const updated = rawText.substring(0, start) + formatted + rawText.substring(end);
    setRawText(updated);
    toast.success(`Tagged as ${tag.label}`);
  };

  const reviewNextIssue = () => {
    if (liveStats.lowConfidenceBlocks === 0) return;
    setCurrentIssueIndex((prev) => (prev + 1) % liveStats.lowConfidenceBlocks);
  };

  const reviewPrevIssue = () => {
    if (liveStats.lowConfidenceBlocks === 0) return;
    setCurrentIssueIndex((prev) =>
      prev === 0 ? liveStats.lowConfidenceBlocks - 1 : prev - 1,
    );
  };

  const markCurrentIssueVerified = () => {
    if (!structure || !liveStats.lowConfItems.length) return;
    const target = liveStats.lowConfItems[currentIssueIndex];
    if (!target) return;
    setStructure({
      ...structure,
      pages: structure.pages.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) =>
          block.id === target.id ? { ...block, reviewed: true, needsReview: false } : block,
        ),
      })),
    });
    toast.success("Marked verified");
    if (currentIssueIndex >= liveStats.lowConfidenceBlocks - 1) {
      setCurrentIssueIndex(0);
    }
  };

  const markAllRemainingReviewed = () => {
    setConfirmModal({
      open: true,
      title: "Mark all remaining areas verified?",
      description: `All ${liveStats.lowConfidenceBlocks} highlighted areas will be accepted as verified.`,
      confirmLabel: "Mark all verified",
      onConfirm: async () => {
        setConfirmModal(null);
        if (!structure) return;
        setStructure({
          ...structure,
          pages: structure.pages.map((page) => ({
            ...page,
            blocks: page.blocks.map((block) => ({
              ...block,
              reviewed: true,
              needsReview: false,
            })),
          })),
        });
        setIsReviewingIssues(false);
        toast.success("All OCR areas marked verified");
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const saveCorrections = async () => {
    if (!job || !structure) return;
    setSaving(true);
    try {
      const result = await apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          correctedText: rawText,
          structure,
          metadata,
          note: revisionNote || "Saved reconstruction corrections",
          ...(canDeclareRights && rightsDeclared
            ? { rightsBasis, sourceAttribution, rightsDeclaration: true }
            : {}),
        }),
      });
      applyJob(result.job);
      setRevisionNote("");
      toast.success(`Revision ${result.job.revision} saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save corrections");
    } finally {
      setSaving(false);
    }
  };

  const restoreRevision = (revision: number) => {
    if (!job) return;
    setConfirmModal({
      open: true,
      title: `Restore Revision ${revision}?`,
      description: "A new revision will preserve current edit history.",
      confirmLabel: "Restore Revision",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const result = await apiFetch<{ job: OcrJob }>(
            `/api/ocr/jobs/${job.id}/revisions/${revision}/restore`,
            { method: "POST" },
          );
          applyJob(result.job);
          toast.success(`Revision ${revision} restored`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not restore revision");
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const reprocessOcr = async () => {
    if (!job || job.status === "published") return;
    setReprocessing(true);
    try {
      const result = await apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${job.id}/reprocess`, {
        method: "POST",
        body: JSON.stringify({ profile, qualityMode, language: ocrLanguage }),
      });
      applyJob(result.job);
      toast.success(`Reprocessed · ${Math.round(result.job.qualityScore)}/100 OCR quality score`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reprocess OCR");
    } finally {
      setReprocessing(false);
    }
  };

  const handlePublishClick = () => {
    if (!job) return;
    if (liveStats.lowConfidenceBlocks > 0) {
      setPublishModalOpen(true);
      return;
    }
    executePublish();
  };

  const executePublish = async () => {
    if (!job) return;
    try {
      if (canDeclareRights && (!rightsDeclared || rightsBasis === "unspecified")) {
        toast.error("Choose a legal sharing basis and confirm declaration before publishing");
        return;
      }
      const result = await apiFetch<{ documentId: string; status: string }>(
        `/api/ocr/jobs/${job.id}/publish`,
        {
          method: "POST",
          ...(canDeclareRights
            ? {
                body: JSON.stringify({
                  rightsBasis,
                  sourceAttribution,
                  rightsDeclaration: rightsDeclared,
                }),
              }
            : {}),
        },
      );
      setPublishModalOpen(false);
      toast.success(
        result.status === "published"
          ? "Document published to EduSearch AI!"
          : "Document submitted to admin review queue!",
      );
      const refreshed = await apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${job.id}`);
      applyJob(refreshed.job);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish document");
    }
  };

  const sourceIsPdf = job?.originalFilename.toLowerCase().endsWith(".pdf");
  const exportTemplate = profile === "notes" ? "notes" : profile === "table" ? "compact" : "exam";
  const enhancedPageUrl = job?.enhancedPaths[selectedPage - 1];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <SiteHeader />

      <main className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="hidden lg:flex w-[300px] shrink-0 flex-col border-r border-border bg-card overflow-y-auto overscroll-contain p-4">
          <div className="space-y-4">
            <div>
              <p className="font-display text-base font-bold">OCR Workspace</p>
              <p className="text-xs text-muted-foreground">
                Enhance scans and edit academic papers.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-surface p-3 text-xs">
              <label className="block font-medium text-muted-foreground">
                Document format
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value as OcrJob["profile"])}
                  className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-brand"
                >
                  <option value="exam">Printed exam</option>
                  <option value="notes">Lecture notes</option>
                  <option value="table">Tables and marks</option>
                  <option value="mixed">Mixed academic layout</option>
                </select>
              </label>
              <label className="block font-medium text-muted-foreground">
                Accuracy mode
                <select
                  value={qualityMode}
                  onChange={(e) => setQualityMode(e.target.value as OcrJob["qualityMode"])}
                  className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-brand"
                >
                  <option value="balanced">Balanced (Fast & clean)</option>
                  <option value="fast">Fast (Single-pass)</option>
                  <option value="accurate">Accurate · Multi-pass</option>
                </select>
              </label>
            </div>

            <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-surface p-5 text-center transition hover:border-brand">
              <ScanLine className="size-6 text-brand" />
              <p className="mt-2 font-display text-sm font-semibold">Upload exam or notes</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Images or PDFs up to 20 pages
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                className="hidden"
                onChange={(e) => e.target.files?.length && chooseFiles(e.target.files)}
              />
              <Button
                className="mt-3 h-8 text-xs"
                type="button"
                disabled={stage === "processing"}
                onClick={(e) => {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }}
              >
                {stage === "processing" ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <FileUp className="mr-1 size-3.5" />
                )}
                {stage === "processing" ? "Processing…" : "Choose files"}
              </Button>
            </label>

            <div className="space-y-1.5 rounded-xl border border-border bg-surface p-3 text-xs">
              <p className="mb-2 font-semibold text-muted-foreground">Pipeline Status</p>
              {steps.map((step) => (
                <div key={step} className="flex items-center gap-2 text-[11px]">
                  {stage === "done" ? (
                    <CheckCircle2 className="size-3 text-brand" />
                  ) : stage === "processing" ? (
                    <Loader2 className="size-3 animate-spin text-brand" />
                  ) : (
                    <span className="size-3 rounded-full border border-border" />
                  )}
                  <span className={stage === "idle" ? "text-muted-foreground" : "text-foreground"}>
                    {step}
                  </span>
                </div>
              ))}
            </div>

            {auth.data?.user && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                  <FileClock className="size-3.5 text-brand" /> Recent scans
                </p>
                <div className="space-y-1.5">
                  {recentJobs.isLoading && <Loader2 className="size-3.5 animate-spin text-brand" />}
                  {recentJobs.data?.jobs.slice(0, 5).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate({ to: "/scanner", search: { job: item.id } })}
                      className={`w-full rounded-lg border p-2 text-left text-xs transition hover:border-brand ${
                        job?.id === item.id ? "border-brand bg-brand/5" : "border-border bg-background"
                      }`}
                    >
                      <p className="truncate font-medium">{item.originalFilename}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Revision {item.revision} · {item.status.replaceAll("_", " ")}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="flex flex-1 flex-col min-h-0 overflow-y-auto overscroll-contain p-4 lg:p-6">
          {!job && stage === "idle" && (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <Sparkles className="mx-auto size-12 text-brand" />
                <p className="mt-4 font-display text-xl font-bold">Upload a paper to begin OCR</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  The original scan will appear alongside an AI-assisted unified document editor.
                </p>
                <Button
                  className="mt-6"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 size-4" /> Upload paper or notes
                </Button>
              </div>
            </div>
          )}

          {stage === "processing" && (
            <div className="grid flex-1 place-items-center text-center">
              <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-7 shadow-soft">
                <div className="relative mx-auto flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Loader2 className="size-7 animate-spin" />
                </div>
                <div>
                  <p className="font-display text-lg font-semibold text-foreground">
                    {job?.currentStage || formatOcrStage(job?.stage) || "Extracting text and structure..."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {job?.totalPages && job.totalPages > 1
                      ? `Processing page ${job.pagesCompleted || 1} of ${job.totalPages}`
                      : "Enhancing contrast, deskewing, and recognizing text"}
                  </p>
                </div>
                <div className="space-y-1.5 text-left">
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>OCR Progress</span>
                    <span className="text-brand">
                      {Math.max(15, Math.min(100, Math.round(job?.progress || 50)))}%
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.max(15, Math.min(100, Math.round(job?.progress || 50)))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {stage === "failed" && job && (
            <div className="grid flex-1 place-items-center text-center">
              <div className="max-w-xl rounded-xl border border-destructive/40 bg-destructive/5 p-6">
                <AlertTriangle className="mx-auto size-9 text-destructive" />
                <p className="mt-4 font-display text-lg font-semibold">OCR failed</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {job.errorMessage || "The source text could not be extracted."}
                </p>
              </div>
            </div>
          )}

          {job && structure && stage === "done" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold">
                    {String(metadata.title || job.originalFilename)}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">Revision {job.revision}</Badge>
                    <Badge
                      variant={
                        job.qualityScore >= 85
                          ? "secondary"
                          : job.qualityScore >= 70
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {Math.round(job.qualityScore)}/100 Quality
                    </Badge>
                    <Badge variant={liveStats.lowConfidenceBlocks ? "outline" : "secondary"}>
                      {liveStats.lowConfidenceBlocks} review items
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={aiOrganiseDocument}
                    className="bg-brand/5 border-brand/40 text-brand hover:bg-brand/10 font-semibold"
                  >
                    <Sparkles className="mr-1.5 size-3.5" /> AI Organise Document
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || job.status === "published"}
                    onClick={saveCorrections}
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 size-3.5" />
                    )}
                    Save Edits
                  </Button>
                  {auth.data?.user ? (
                    <Button
                      size="sm"
                      disabled={job.status === "published"}
                      onClick={handlePublishClick}
                      className="bg-brand text-brand-foreground font-semibold"
                    >
                      {job.status === "published" ? "Published" : "Publish Document"}
                    </Button>
                  ) : (
                    <Button asChild size="sm">
                      <Link to="/login">Log in to publish</Link>
                    </Button>
                  )}
                </div>
              </div>

              {liveStats.lowConfidenceBlocks > 0 && (
                <div className="rounded-xl border border-amber-300/80 bg-amber-50/80 p-3.5 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                      <span>
                        {liveStats.lowConfidenceBlocks} OCR areas need confidence review
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsReviewingIssues(!isReviewingIssues)}
                        className="h-7 text-xs bg-background"
                      >
                        {isReviewingIssues ? "Close Reviewer" : "Open Step Reviewer"}
                      </Button>
                    </div>
                  </div>

                  {isReviewingIssues && liveStats.lowConfItems.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/80 pt-2.5 dark:border-amber-800">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          Issue {currentIssueIndex + 1} of {liveStats.lowConfidenceBlocks}:
                        </span>
                        <span className="rounded bg-background px-2 py-1 font-mono text-[11px] border border-border">
                          {liveStats.lowConfItems[currentIssueIndex]?.text.slice(0, 60)}…
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={reviewPrevIssue}
                          className="size-7 bg-background"
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={markCurrentIssueVerified}
                          className="h-7 text-xs bg-background text-brand"
                        >
                          <CheckCircle2 className="mr-1 size-3" /> Accept & Verify
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={reviewNextIssue}
                          className="size-7 bg-background"
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-border bg-card p-4">
                <MetadataField
                  label="Title"
                  value={String(metadata.title || "")}
                  onChange={(v) => setMetadata({ ...metadata, title: v })}
                />
                <MetadataField
                  label="Subject"
                  value={String(metadata.subject || "")}
                  onChange={(v) => setMetadata({ ...metadata, subject: v })}
                />
                <MetadataField
                  label="Document type"
                  value={String(metadata.docType || "")}
                  onChange={(v) => setMetadata({ ...metadata, docType: v })}
                />
                <MetadataField
                  label="Year"
                  value={String(metadata.year || "")}
                  onChange={(v) =>
                    setMetadata({ ...metadata, year: Number(v) || new Date().getFullYear() })
                  }
                />
              </div>

              {structure.pages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {structure.pages.map((page) => (
                    <Button
                      key={page.pageNumber}
                      size="sm"
                      variant={selectedPage === page.pageNumber ? "default" : "outline"}
                      onClick={() => setSelectedPage(page.pageNumber)}
                    >
                      Page {page.pageNumber}
                    </Button>
                  ))}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-3 shadow-soft">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Source page {selectedPage}
                    </p>
                  </div>
                  {enhancedPageUrl ? (
                    <img
                      src={enhancedPageUrl}
                      alt={`Page ${selectedPage}`}
                      className="max-h-[640px] w-full rounded-lg border border-border bg-white object-contain"
                    />
                  ) : sourceIsPdf ? (
                    <iframe
                      title="PDF View"
                      src={`${job.sourceUrl}#page=${selectedPage}`}
                      className="h-[640px] w-full rounded-lg border border-border bg-white"
                    />
                  ) : (
                    <img
                      src={job.sourceUrl}
                      alt="Source document"
                      className="max-h-[640px] w-full rounded-lg border border-border bg-white object-contain"
                    />
                  )}
                </div>

                <div className="flex flex-col rounded-xl border border-border bg-card p-3 shadow-soft">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-[11px] font-semibold text-muted-foreground">
                        Tag selection:
                      </span>
                      {semanticTags.map((tag) => (
                        <button
                          key={tag.value}
                          type="button"
                          onClick={() => applySemanticTag(tag)}
                          className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground transition hover:border-brand hover:text-brand"
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Document text will appear here..."
                    className="h-[600px] w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="flex items-center gap-1.5 font-display font-semibold text-sm">
                  <History className="size-4 text-brand" /> Revision history
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {revisions.data?.revisions.map((rev) => (
                    <div
                      key={rev.revision}
                      className="rounded-lg border border-border bg-card p-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Revision {rev.revision}</span>
                        {rev.revision === job.revision && <Badge variant="secondary">Current</Badge>}
                      </div>
                      <p className="mt-1 text-muted-foreground line-clamp-1">{rev.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {publishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="size-6 text-amber-500" />
                <h3 className="font-display text-lg font-bold">Review Required</h3>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPublishModalOpen(false)}
                className="size-7"
              >
                <X className="size-4" />
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Some areas have low confidence. Review them, or publish as-is.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button onClick={() => setPublishModalOpen(false)} className="w-full bg-brand">
                Review issues
              </Button>
              <Button variant="outline" onClick={executePublish} className="w-full">
                Publish anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal modalState={confirmModal} />
    </div>
  );
}

function MetadataField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs outline-none focus:border-brand"
      />
    </label>
  );
}

function formatOcrStage(stage?: string) {
  const labels: Record<string, string> = {
    uploaded: "Upload received",
    preprocessing: "Correcting orientation, perspective and page lighting…",
    ocr_running: "Extracting real text and word coordinates…",
    ocr_completed: "OCR text extracted; validating recognition…",
    layout_analysis: "Analysing columns, tables, figures and reading order…",
    reconstructing: "Reconstructing questions, instructions and marks…",
    awaiting_review: "OCR complete — review highlighted blocks",
    verified: "OCR complete — reconstruction ready",
    failed: "OCR failed",
    published: "Published to EduSearch AI",
  };
  return labels[stage || ""] || "Processing OCR…";
}

function cloneStructure(structure: OcrStructure): OcrStructure {
  return JSON.parse(JSON.stringify(structure)) as OcrStructure;
}
