import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileClock,
  FileText,
  FileUp,
  History,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
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
  head: () => ({ meta: [{ title: "AI OCR reconstruction editor — EduSearch AI" }] }),
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
const blockTypes: Array<{ value: OcrBlockType; label: string }> = [
  { value: "institution", label: "Institution" },
  { value: "title", label: "Document title" },
  { value: "metadata", label: "Metadata" },
  { value: "instruction", label: "Instructions" },
  { value: "section", label: "Section heading" },
  { value: "question", label: "Question" },
  { value: "subquestion", label: "Sub-question" },
  { value: "table", label: "Table / columns" },
  { value: "figure", label: "Figure / diagram" },
  { value: "formula", label: "Formula" },
  { value: "paragraph", label: "Paragraph" },
  { value: "footer", label: "Footer" },
];

function ScannerPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { job: requestedJobId } = Route.useSearch();
  const [stage, setStage] = useState<"idle" | "processing" | "done">(
    requestedJobId ? "processing" : "idle",
  );
  const [job, setJob] = useState<OcrJob | null>(null);
  const [structure, setStructure] = useState<OcrStructure | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [selectedPage, setSelectedPage] = useState(1);
  const [mode, setMode] = useState<"structured" | "raw">("structured");
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [rightsBasis, setRightsBasis] = useState<OcrJob["rightsBasis"]>("unspecified");
  const [sourceAttribution, setSourceAttribution] = useState("");
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const [profile, setProfile] = useState<OcrJob["profile"]>("exam");
  const [qualityMode, setQualityMode] = useState<OcrJob["qualityMode"]>("accurate");
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [reprocessing, setReprocessing] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedJob = useQuery({
    queryKey: ["ocr-job", requestedJobId],
    queryFn: () =>
      apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${encodeURIComponent(requestedJobId || "")}`),
    enabled: typeof window !== "undefined" && Boolean(requestedJobId),
    retry: false,
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
  const preflight = useQuery({
    queryKey: ["ocr-preflight", job?.id, job?.revision],
    queryFn: () =>
      apiFetch<{ preflight: OcrPreflight }>(
        `/api/ocr/jobs/${encodeURIComponent(job?.id || "")}/preflight`,
      ),
    enabled: typeof window !== "undefined" && Boolean(job?.id),
    retry: false,
  });

  useEffect(() => {
    if (selectedJob.data?.job) applyJob(selectedJob.data.job);
  }, [selectedJob.data]);

  useEffect(() => {
    if (selectedJob.isError) {
      setStage("idle");
      toast.error(
        selectedJob.error instanceof Error
          ? selectedJob.error.message
          : "Could not open the OCR job",
      );
    }
  }, [selectedJob.isError, selectedJob.error]);

  const applyJob = (nextJob: OcrJob) => {
    setJob(nextJob);
    setStructure(cloneStructure(nextJob.structure));
    setMetadata({ ...nextJob.metadata });
    setRawText(nextJob.correctedText || nextJob.extractedText);
    setRightsBasis(nextJob.rightsBasis || "unspecified");
    setSourceAttribution(nextJob.sourceAttribution || "");
    setRightsDeclared(nextJob.rightsDeclared);
    setProfile(nextJob.profile || "exam");
    setQualityMode(nextJob.qualityMode || "accurate");
    setOcrLanguage(nextJob.language || "eng");
    setSelectedPage((current) =>
      Math.min(Math.max(1, current), Math.max(1, nextJob.structure.pages.length)),
    );
    setStage("done");
  };

  const chooseFile = async (selected: File) => {
    setStage("processing");
    setJob(null);
    setStructure(null);
    try {
      const form = new FormData();
      form.append("file", selected);
      form.append("profile", profile);
      form.append("qualityMode", qualityMode);
      form.append("language", ocrLanguage);
      const result = await apiFetch<{ job: OcrJob }>("/api/ocr/jobs", {
        method: "POST",
        body: form,
      });
      applyJob(result.job);
      await navigate({ to: "/scanner", search: { job: result.job.id }, replace: true });
      await queryClient.invalidateQueries({ queryKey: ["ocr-jobs"] });
      toast.success(
        `OCR reconstruction complete · ${Math.round(result.job.qualityScore)}/100 quality score`,
      );
    } catch (error) {
      setStage("idle");
      toast.error(error instanceof Error ? error.message : "OCR failed");
    }
  };

  const currentPage =
    structure?.pages.find((page) => page.pageNumber === selectedPage) || structure?.pages[0];
  const liveStats = useMemo(() => {
    const blocks = structure?.pages.flatMap((page) => page.blocks) || [];
    return {
      pages: structure?.pages.length || 0,
      blocks: blocks.length,
      lowConfidenceBlocks: blocks.filter(
        (block) =>
          (block.needsReview || block.confidence < 70 || (block.agreement ?? 1) < 0.58) &&
          !block.reviewed,
      ).length,
      questions: blocks.filter((block) => block.type === "question" || block.type === "subquestion")
        .length,
      totalMarks: blocks.reduce((sum, block) => sum + (block.marks || 0), 0),
    };
  }, [structure]);

  const canDeclareRights = Boolean(
    auth.data?.user && (!job?.contributorUserId || job.contributorUserId === auth.data.user.id),
  );

  const updateBlock = (blockId: string, patch: Partial<OcrBlock>) => {
    setStructure(
      (current) =>
        current && {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            blocks: page.blocks.map((block) =>
              block.id === blockId ? { ...block, ...patch } : block,
            ),
          })),
        },
    );
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    setStructure((current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => {
          const index = page.blocks.findIndex((block) => block.id === blockId);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= page.blocks.length) return page;
          const blocks = [...page.blocks];
          [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
          return { ...page, blocks: blocks.map((block, order) => ({ ...block, order })) };
        }),
      };
    });
  };

  const deleteBlock = (blockId: string) => {
    setStructure(
      (current) =>
        current && {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            blocks: page.blocks
              .filter((block) => block.id !== blockId)
              .map((block, order) => ({ ...block, order })),
          })),
        },
    );
  };

  const addBlock = () => {
    if (!structure || !currentPage) return;
    const block: OcrBlock = {
      id: `p${currentPage.pageNumber}-manual-${Date.now()}`,
      page: currentPage.pageNumber,
      order: currentPage.blocks.length,
      type: "paragraph",
      text: "New text block",
      confidence: 100,
      needsReview: false,
      reviewed: true,
    };
    setStructure({
      ...structure,
      pages: structure.pages.map((page) =>
        page.pageNumber === currentPage.pageNumber
          ? { ...page, blocks: [...page.blocks, block] }
          : page,
      ),
    });
  };

  const saveCorrections = async () => {
    if (!job || !structure) return;
    setSaving(true);
    try {
      const result = await apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          correctedText: mode === "raw" ? rawText : undefined,
          structure: mode === "structured" ? structure : undefined,
          metadata,
          note: revisionNote || "Saved reconstruction corrections",
          ...(canDeclareRights && rightsDeclared
            ? { rightsBasis, sourceAttribution, rightsDeclaration: true }
            : {}),
        }),
      });
      applyJob(result.job);
      setRevisionNote("");
      await queryClient.invalidateQueries({ queryKey: ["ocr-revisions", job.id] });
      await queryClient.invalidateQueries({ queryKey: ["ocr-jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["ocr-preflight", job.id] });
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
      description: "A new revision will preserve the current history.",
      confirmLabel: "Restore Revision",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const result = await apiFetch<{ job: OcrJob }>(
            `/api/ocr/jobs/${job.id}/revisions/${revision}/restore`,
            { method: "POST" },
          );
          applyJob(result.job);
          await queryClient.invalidateQueries({ queryKey: ["ocr-revisions", job.id] });
          await queryClient.invalidateQueries({ queryKey: ["ocr-preflight", job.id] });
          toast.success(`Revision ${revision} restored as revision ${result.job.revision}`);
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
        body: JSON.stringify({
          profile,
          qualityMode,
          language: ocrLanguage,
          forceImageOcr: sourceIsPdf,
        }),
      });
      applyJob(result.job);
      await queryClient.invalidateQueries({ queryKey: ["ocr-revisions", job.id] });
      await queryClient.invalidateQueries({ queryKey: ["ocr-jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["ocr-preflight", job.id] });
      toast.success(`Reprocessed · ${Math.round(result.job.qualityScore)}/100 OCR quality score`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reprocess OCR");
    } finally {
      setReprocessing(false);
    }
  };

  const publish = async () => {
    if (!job) return;
    if (liveStats.lowConfidenceBlocks > 0) {
      toast.error(
        `Review ${liveStats.lowConfidenceBlocks} unresolved low-confidence block${liveStats.lowConfidenceBlocks === 1 ? "" : "s"} first`,
      );
      return;
    }
    try {
      if (canDeclareRights && (!rightsDeclared || rightsBasis === "unspecified")) {
        toast.error("Choose a legal sharing basis and confirm the declaration before publishing");
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
      toast.success(
        result.status === "published"
          ? "OCR document published"
          : "OCR document sent for moderation",
      );
      const refreshed = await apiFetch<{ job: OcrJob }>(`/api/ocr/jobs/${job.id}`);
      applyJob(refreshed.job);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish OCR document");
    }
  };

  const sourceIsPdf = job?.originalFilename.toLowerCase().endsWith(".pdf");
  const enhancedPageUrl = job?.enhancedPaths[selectedPage - 1];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl">Exam reconstruction editor</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Enhance a photographed academic paper, detect its structure, review uncertain text
              block-by-block, and export an exam-ready or well-organised PDF and DOCX.
            </p>
          </div>
          {job && (
            <div className="flex flex-wrap gap-2 text-xs">
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
                {Math.round(job.qualityScore)}/100 OCR quality
              </Badge>
              <Badge variant={liveStats.lowConfidenceBlocks ? "destructive" : "secondary"}>
                {liveStats.lowConfidenceBlocks} unresolved
              </Badge>
              <Badge variant="outline">{liveStats.questions} questions</Badge>
              <Badge variant="outline">{liveStats.totalMarks} detected marks</Badge>
            </div>
          )}
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Document profile
                  <select
                    value={profile}
                    onChange={(event) => setProfile(event.target.value as OcrJob["profile"])}
                    className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand"
                  >
                    <option value="exam">Printed exam</option>
                    <option value="notes">Printed / lecture notes</option>
                    <option value="table">Tables and forms</option>
                    <option value="mixed">Mixed layout</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Accuracy mode
                  <select
                    value={qualityMode}
                    onChange={(event) =>
                      setQualityMode(event.target.value as OcrJob["qualityMode"])
                    }
                    className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand"
                  >
                    <option value="accurate">Accurate · multi-pass</option>
                    <option value="balanced">Balanced</option>
                    <option value="fast">Fast</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground sm:col-span-2 xl:col-span-1">
                  OCR languages
                  <input
                    value={ocrLanguage}
                    onChange={(event) => setOcrLanguage(event.target.value)}
                    placeholder="eng or eng+swa"
                    className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand"
                  />
                  <span className="mt-1 block text-[11px] font-normal">
                    Use Tesseract language codes. Example: eng+swa.
                  </span>
                </label>
              </div>
              <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-surface p-7 text-center transition hover:border-brand">
                <ScanLine className="size-8 text-brand" />
                <p className="mt-3 font-display text-base font-semibold">Upload exam or notes</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  JPG, PNG, WEBP, HEIC or PDF · up to 20 pages
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                  className="hidden"
                  onChange={(event) => event.target.files?.[0] && chooseFile(event.target.files[0])}
                />
                <Button
                  className="mt-4"
                  type="button"
                  disabled={stage === "processing"}
                  onClick={(event) => {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }}
                >
                  {stage === "processing" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileUp className="size-4" />
                  )}
                  {stage === "processing" ? "Processing OCR…" : "Choose file"}
                </Button>
              </label>
              <div className="mt-5 space-y-2">
                {steps.map((step) => (
                  <div key={step} className="flex items-center gap-2 text-xs">
                    {stage === "done" ? (
                      <CheckCircle2 className="size-3.5 text-brand" />
                    ) : stage === "processing" ? (
                      <Loader2 className="size-3.5 animate-spin text-brand" />
                    ) : (
                      <span className="size-3.5 rounded-full border border-border" />
                    )}
                    <span
                      className={stage === "idle" ? "text-muted-foreground" : "text-foreground"}
                    >
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {auth.data?.user && (
              <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
                <div className="mb-3 flex items-center gap-2 font-display font-semibold">
                  <FileClock className="size-4 text-brand" /> Recent OCR jobs
                </div>
                <div className="space-y-2">
                  {recentJobs.isLoading && <Loader2 className="size-4 animate-spin text-brand" />}
                  {recentJobs.data?.jobs.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate({ to: "/scanner", search: { job: item.id } })}
                      className={`w-full rounded-lg border p-3 text-left transition hover:border-brand ${job?.id === item.id ? "border-brand bg-brand/5" : "border-border bg-surface"}`}
                    >
                      <p className="truncate text-sm font-medium">{item.originalFilename}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Revision {item.revision} · {item.status.replaceAll("_", " ")}
                      </p>
                    </button>
                  ))}
                  {!recentJobs.isLoading && recentJobs.data?.jobs.length === 0 && (
                    <p className="text-xs text-muted-foreground">No saved OCR jobs yet.</p>
                  )}
                </div>
              </div>
            )}
          </aside>

          <section className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
            {!job && stage === "idle" && (
              <div className="grid min-h-[520px] place-items-center text-center">
                <div>
                  <Sparkles className="mx-auto size-10 text-brand" />
                  <p className="mt-4 font-display text-xl font-semibold">Upload a paper to begin</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    The original page will appear beside an editable structured reconstruction.
                  </p>
                </div>
              </div>
            )}
            {stage === "processing" && (
              <div className="grid min-h-[520px] place-items-center text-center">
                <div>
                  <Loader2 className="mx-auto size-9 animate-spin text-brand" />
                  <p className="mt-4 font-medium">Enhancing pages and reconstructing the exam…</p>
                </div>
              </div>
            )}

            {job && structure && stage === "done" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <p className="font-display text-lg font-semibold">
                      {String(metadata.title || job.originalFilename)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round(job.confidence)}% OCR confidence · {Math.round(job.qualityScore)}
                      /100 quality score · {structure.pages.length} page
                      {structure.pages.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={mode === "structured" ? "default" : "outline"}
                      onClick={() => setMode("structured")}
                    >
                      Structured
                    </Button>
                    <Button
                      size="sm"
                      variant={mode === "raw" ? "default" : "outline"}
                      onClick={() => setMode("raw")}
                    >
                      Raw text
                    </Button>
                  </div>
                </div>


                {job.pipeline.warnings.length > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
                    <p className="font-semibold">Scan-quality warnings</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {job.pipeline.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}


                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetadataField
                    label="Title"
                    value={String(metadata.title || "")}
                    onChange={(value) => setMetadata({ ...metadata, title: value })}
                  />
                  <MetadataField
                    label="Subject"
                    value={String(metadata.subject || "")}
                    onChange={(value) => setMetadata({ ...metadata, subject: value })}
                  />
                  <MetadataField
                    label="Document type"
                    value={String(metadata.docType || "")}
                    onChange={(value) => setMetadata({ ...metadata, docType: value })}
                  />
                  <MetadataField
                    label="Year"
                    value={String(metadata.year || "")}
                    onChange={(value) =>
                      setMetadata({ ...metadata, year: Number(value) || new Date().getFullYear() })
                    }
                  />
                  <MetadataField
                    label="Institution"
                    value={String(metadata.institution || "")}
                    onChange={(value) => setMetadata({ ...metadata, institution: value })}
                  />
                  <MetadataField
                    label="Author / lecturer"
                    value={String(metadata.author || "")}
                    onChange={(value) => setMetadata({ ...metadata, author: value })}
                  />
                  <MetadataField
                    label="Level"
                    value={String(metadata.level || "")}
                    onChange={(value) => setMetadata({ ...metadata, level: value })}
                  />
                  <MetadataField
                    label="Language"
                    value={String(metadata.language || "")}
                    onChange={(value) => setMetadata({ ...metadata, language: value })}
                  />
                </div>



                <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                  {structure.pages.map((page) => (
                    <Button
                      key={page.pageNumber}
                      size="sm"
                      variant={selectedPage === page.pageNumber ? "default" : "outline"}
                      onClick={() => setSelectedPage(page.pageNumber)}
                    >
                      Page {page.pageNumber}
                      {page.blocks.some(
                        (block) =>
                          (block.needsReview ||
                            block.confidence < 70 ||
                            (block.agreement ?? 1) < 0.58) &&
                          !block.reviewed,
                      ) && <AlertTriangle className="size-3.5" />}
                    </Button>
                  ))}
                </div>

                {mode === "raw" ? (
                  <textarea
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    className="mt-4 h-[620px] w-full resize-y rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed outline-none focus:border-brand"
                  />
                ) : (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="min-w-0 rounded-lg border border-border bg-surface p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Enhanced original · page {selectedPage}
                        </p>
                        <Badge variant="outline">{Math.round(currentPage?.confidence || 0)}%</Badge>
                      </div>
                      {enhancedPageUrl ? (
                        <img
                          src={enhancedPageUrl}
                          alt={`Enhanced OCR page ${selectedPage}`}
                          className="max-h-[720px] w-full rounded border border-border bg-white object-contain"
                        />
                      ) : sourceIsPdf ? (
                        <iframe
                          title="Original PDF"
                          src={`${job.sourceUrl}#page=${selectedPage}`}
                          className="h-[720px] w-full rounded border border-border bg-white"
                        />
                      ) : (
                        <img
                          src={job.sourceUrl}
                          alt="Original academic document"
                          className="max-h-[720px] w-full rounded border border-border bg-white object-contain"
                        />
                      )}
                    </div>

                    <div className="min-w-0 rounded-lg border border-border bg-surface p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Editable document blocks
                        </p>
                        <Button size="sm" variant="outline" onClick={addBlock}>
                          <Plus className="size-3.5" /> Add block
                        </Button>
                      </div>
                      <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
                        {currentPage?.blocks.map((block, index) => (
                          <div
                            key={block.id}
                            className={`rounded-lg border p-3 ${(block.needsReview || block.confidence < 70 || (block.agreement ?? 1) < 0.58) && !block.reviewed ? "border-destructive/60 bg-destructive/5" : "border-border bg-background"}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={block.type}
                                onChange={(event) =>
                                  updateBlock(block.id, {
                                    type: event.target.value as OcrBlockType,
                                  })
                                }
                                className="h-8 rounded border border-border bg-surface px-2 text-xs outline-none focus:border-brand"
                              >
                                {blockTypes.map((type) => (
                                  <option key={type.value} value={type.value}>
                                    {type.label}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={index === 0}
                                onClick={() => moveBlock(block.id, -1)}
                                aria-label="Move block up"
                              >
                                <ChevronUp className="size-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={index === currentPage.blocks.length - 1}
                                onClick={() => moveBlock(block.id, 1)}
                                aria-label="Move block down"
                              >
                                <ChevronDown className="size-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deleteBlock(block.id)}
                                aria-label="Delete block"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                            {(block.type === "question" || block.type === "subquestion") && (
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className="text-xs text-muted-foreground">
                                  Number
                                  <input
                                    value={block.questionNumber || ""}
                                    onChange={(event) =>
                                      updateBlock(block.id, { questionNumber: event.target.value })
                                    }
                                    className="mt-1 h-8 w-full rounded border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-brand"
                                  />
                                </label>
                                <label className="text-xs text-muted-foreground">
                                  Marks
                                  <input
                                    type="number"
                                    min={0}
                                    max={1000}
                                    value={block.marks ?? ""}
                                    onChange={(event) =>
                                      updateBlock(block.id, {
                                        marks: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                      })
                                    }
                                    className="mt-1 h-8 w-full rounded border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-brand"
                                  />
                                </label>
                              </div>
                            )}
                            {block.type === "figure" && (
                              <label className="mt-2 block text-xs text-muted-foreground">
                                Figure caption
                                <input
                                  value={block.caption || ""}
                                  onChange={(event) =>
                                    updateBlock(block.id, { caption: event.target.value })
                                  }
                                  placeholder="Describe the diagram or figure"
                                  className="mt-1 h-8 w-full rounded border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-brand"
                                />
                              </label>
                            )}
                            <textarea
                              value={block.text}
                              onChange={(event) =>
                                updateBlock(block.id, { text: event.target.value })
                              }
                              className="mt-2 min-h-24 w-full resize-y rounded border border-border bg-surface p-2 text-sm leading-relaxed outline-none focus:border-brand"
                            />
                          </div>
                        ))}
                        {currentPage?.blocks.length === 0 && (
                          <p className="py-10 text-center text-sm text-muted-foreground">
                            No blocks detected on this page. Add one manually.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-border pt-5">
                  <label className="min-w-52 flex-1 text-xs text-muted-foreground">
                    Revision note
                    <input
                      value={revisionNote}
                      onChange={(event) => setRevisionNote(event.target.value)}
                      placeholder="What did you correct?"
                      className="mt-1 h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-brand"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || job.status === "published"}
                    onClick={saveCorrections}
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}{" "}
                    Save revision
                  </Button>
                  <Button asChild size="sm">
                    <a
                      href={`/api/ocr/jobs/${job.id}/export?format=pdf&layout=clean&template=exam&answerSpace=preserve&visuals=reconstruct&final=1`}
                    >
                      <Download className="size-4" /> Download PDF
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/api/ocr/jobs/${job.id}/export?format=docx&template=exam&answerSpace=preserve&visuals=reconstruct`}
                    >
                      <FileText className="size-4" /> Download Word (DOCX)
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || job.status === "published"}
                    onClick={saveCorrections}
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}{" "}
                    Save Edits
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reprocessing || job.status === "published"}
                    onClick={reprocessOcr}
                  >
                    {reprocessing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}{" "}
                    Reprocess OCR
                  </Button>
                  {auth.data?.user ? (
                    <Button
                      size="sm"
                      disabled={job.status === "published"}
                      onClick={publish}
                    >
                      {job.status === "published" ? "Published" : "Publish Document"}
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/login">Log in to publish</Link>
                    </Button>
                  )}
                </div>

                <div className="mt-6 rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 font-display font-semibold">
                    <History className="size-4 text-brand" /> Revision history
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {revisions.data?.revisions.map((revision) => (
                      <div
                        key={revision.revision}
                        className="rounded-lg border border-border bg-background p-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">Revision {revision.revision}</p>
                          {revision.revision === job.revision && (
                            <Badge variant="secondary">Current</Badge>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {revision.note}
                        </p>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {revision.createdBy} · {new Date(revision.createdAt).toLocaleString()}
                        </p>
                        {revision.revision !== job.revision && job.status !== "published" && (
                          <Button
                            className="mt-2"
                            size="sm"
                            variant="ghost"
                            onClick={() => restoreRevision(revision.revision)}
                          >
                            <RotateCcw className="size-3.5" /> Restore
                          </Button>
                        )}
                      </div>
                    ))}
                    {revisions.isLoading && <Loader2 className="size-4 animate-spin text-brand" />}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
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
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

function cloneStructure(structure: OcrStructure): OcrStructure {
  return JSON.parse(JSON.stringify(structure)) as OcrStructure;
}
