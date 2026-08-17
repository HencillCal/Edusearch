import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileWarning, Loader2, Scale, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

type PolicySearch = { document?: string };

export const Route = createFileRoute("/policies")({
  validateSearch: (search: Record<string, unknown>): PolicySearch => ({
    document: typeof search.document === "string" ? search.document.slice(0, 180) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Copyright and privacy policy — EduSearch AI" },
      {
        name: "description",
        content:
          "How EduSearch AI handles copyright takedown requests, personal information and document moderation.",
      },
      { property: "og:title", content: "Copyright and privacy policy — EduSearch AI" },
      {
        property: "og:description",
        content: "Copyright, moderation and privacy commitments of EduSearch AI.",
      },
    ],
  }),
  component: PoliciesPage,
});

function PoliciesPage() {
  const search = Route.useSearch();
  const auth = useAuth();
  const authUser = auth.data?.user;
  const evidenceRef = useRef<HTMLInputElement>(null);
  const [documentId, setDocumentId] = useState(search.document ?? "");
  const [claimantName, setClaimantName] = useState("");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [claimantOrganization, setClaimantOrganization] = useState("");
  const [relationship, setRelationship] = useState("rights_holder");
  const [requestedAction, setRequestedAction] = useState("remove");
  const [statement, setStatement] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [declaration, setDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tracking, setTracking] = useState<{ id: string; trackingCode: string } | null>(null);
  const [statusId, setStatusId] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusResult, setStatusResult] = useState<{
    documentTitle: string;
    status: string;
    resolutionAction: string;
    resolutionNote?: string;
    updatedAt: string;
  } | null>(null);

  useEffect(() => {
    if (!authUser) return;
    setClaimantName((value) => value || authUser.name);
    setClaimantEmail((value) => value || authUser.email);
  }, [authUser]);

  const submit = async () => {
    if (!documentId.trim()) return toast.error("Enter the document ID");
    if (!declaration) return toast.error("Confirm the good-faith declaration");
    setSubmitting(true);
    try {
      const body = new FormData();
      body.set("documentId", documentId.trim());
      body.set("claimantName", claimantName.trim());
      body.set("claimantEmail", claimantEmail.trim());
      body.set("claimantOrganization", claimantOrganization.trim());
      body.set("relationship", relationship);
      body.set("requestedAction", requestedAction);
      body.set("statement", statement.trim());
      body.set("declaration", String(declaration));
      if (evidence) body.set("evidence", evidence);
      const result = await apiFetch<{ id: string; trackingCode: string }>(
        "/api/copyright-requests",
        { method: "POST", body },
      );
      setTracking(result);
      setStatusId(result.id);
      setStatusCode(result.trackingCode);
      toast.success("Copyright request submitted for administrator review");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not submit the copyright request",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const checkStatus = async () => {
    if (!statusId.trim() || !statusCode.trim())
      return toast.error("Enter the request ID and tracking code");
    setCheckingStatus(true);
    try {
      const result = await apiFetch<{
        request: {
          documentTitle: string;
          status: string;
          resolutionAction: string;
          resolutionNote?: string;
          updatedAt: string;
        };
      }>("/api/copyright-requests/status", {
        method: "POST",
        body: JSON.stringify({ id: statusId.trim(), trackingCode: statusCode.trim() }),
      });
      setStatusResult(result.request);
    } catch (error) {
      setStatusResult(null);
      toast.error(error instanceof Error ? error.message : "Could not check request status");
    } finally {
      setCheckingStatus(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="max-w-3xl">
          <h1 className="text-3xl">Copyright, moderation and privacy</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            EduSearch AI stores academic documents for search, preview and study. Uploaders must
            declare a lawful basis for sharing every submitted file. Verified rights holders can
            request temporary restriction or permanent removal.
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <PolicyCard icon={<Scale className="size-5" />} title="Copyright">
            Documents remain the property of their authors and institutions. A formal request
            records the claimant, affected document, requested action, evidence and administrator
            decision.
          </PolicyCard>
          <PolicyCard icon={<FileWarning className="size-5" />} title="Moderation">
            Uploads are scanned, extracted and reviewed. Malware, personal information, incomplete
            pages, unreliable OCR and unsupported rights claims can block publication.
          </PolicyCard>
          <PolicyCard icon={<ShieldCheck className="size-5" />} title="Privacy">
            Public search requires no account. Private-library material remains
            membership-restricted, and copyright evidence is accessible only to administrators.
          </PolicyCard>
        </div>

        <section className="mt-10 rounded-xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <Scale className="mt-0.5 size-6 text-brand" />
            <div>
              <h2 className="text-xl">Submit a copyright or takedown request</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Provide enough information for an administrator to verify the claim. False or
                incomplete requests may be dismissed.
              </p>
            </div>
          </div>

          {tracking ? (
            <div className="mt-6 rounded-lg border border-success/40 bg-success/10 p-5">
              <p className="font-semibold">Request received</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Keep this tracking code. It is shown only once.
              </p>
              <code className="mt-3 block break-all rounded-md bg-background p-3 text-sm">
                {tracking.trackingCode}
              </code>
              <p className="mt-2 text-xs text-muted-foreground">Request ID: {tracking.id}</p>
              <Button variant="outline" className="mt-4" onClick={() => setTracking(null)}>
                Submit another request
              </Button>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field
                label="Document ID"
                value={documentId}
                onChange={setDocumentId}
                placeholder="Shown in the document URL"
              />
              <Field label="Your full name" value={claimantName} onChange={setClaimantName} />
              <Field
                label="Email address"
                type="email"
                value={claimantEmail}
                onChange={setClaimantEmail}
              />
              <Field
                label="Organisation (optional)"
                value={claimantOrganization}
                onChange={setClaimantOrganization}
                required={false}
              />
              <SelectField
                label="Relationship to the work"
                value={relationship}
                onChange={setRelationship}
                options={[
                  ["author", "Author or creator"],
                  ["rights_holder", "Copyright or rights holder"],
                  ["authorized_representative", "Authorised representative"],
                  ["institution", "Institution or publisher"],
                  ["other", "Other relationship"],
                ]}
              />
              <SelectField
                label="Requested action"
                value={requestedAction}
                onChange={setRequestedAction}
                options={[
                  ["remove", "Remove the document"],
                  ["restrict", "Temporarily restrict access"],
                  ["contact_uploader", "Contact the uploader first"],
                ]}
              />
              <label className="sm:col-span-2 block">
                <span className="mb-1.5 block text-sm font-medium">Explain the claim</span>
                <textarea
                  rows={6}
                  value={statement}
                  onChange={(event) => setStatement(event.target.value)}
                  placeholder="Identify the protected work, explain your rights, and describe why this document should be restricted or removed."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Minimum 40 characters. Do not include passwords or unrelated personal information.
                </span>
              </label>
              <div className="sm:col-span-2 rounded-lg border border-dashed border-border bg-surface p-4">
                <input
                  ref={evidenceRef}
                  type="file"
                  accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(event) => setEvidence(event.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Supporting evidence (optional)</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PDF, DOCX or image. It is virus-scanned and kept private.
                    </p>
                    {evidence && (
                      <p className="mt-2 text-xs font-medium text-brand">{evidence.name}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => evidenceRef.current?.click()}
                  >
                    <Upload className="size-4" /> Choose evidence
                  </Button>
                </div>
              </div>
              <label className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
                <input
                  type="checkbox"
                  checked={declaration}
                  onChange={(event) => setDeclaration(event.target.checked)}
                  className="mt-1 size-4"
                />
                <span>
                  I declare in good faith that the information in this request is accurate and that
                  I am the rights holder or authorised to act for the rights holder.
                </span>
              </label>
              <div className="sm:col-span-2">
                <Button onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Scale className="size-4" />
                  )}
                  {submitting ? "Submitting…" : "Submit rights request"}
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-soft">
          <h2 className="text-xl">Check a request</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the request ID and private tracking code supplied after submission. The code is
            stored only as a one-way hash.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Request ID" value={statusId} onChange={setStatusId} />
            <Field label="Tracking code" value={statusCode} onChange={setStatusCode} />
            <div className="self-end">
              <Button variant="outline" onClick={checkStatus} disabled={checkingStatus}>
                {checkingStatus && <Loader2 className="size-4 animate-spin" />}
                {checkingStatus ? "Checking…" : "Check status"}
              </Button>
            </div>
          </div>
          {statusResult && (
            <div className="mt-5 rounded-lg border border-brand/30 bg-brand-soft p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{statusResult.documentTitle}</p>
                <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold">
                  {statusResult.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">
                Decision: {statusResult.resolutionAction.replaceAll("_", " ")}
              </p>
              {statusResult.resolutionNote && (
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {statusResult.resolutionNote}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Updated {new Date(statusResult.updatedAt).toLocaleString()}
              </p>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function PolicyCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-2 text-brand">
        {icon}
        <h2 className="text-lg text-foreground">{title}</h2>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{children}</p>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}
