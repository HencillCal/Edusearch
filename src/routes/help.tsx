import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help centre — EduSearch AI" },
      {
        name: "description",
        content:
          "How to search, preview, download, upload documents and use the OCR scanner on EduSearch AI.",
      },
      { property: "og:title", content: "Help centre — EduSearch AI" },
      {
        property: "og:description",
        content: "Answers to common questions about using EduSearch AI.",
      },
    ],
  }),
  component: HelpPage,
});

const faqs = [
  {
    q: "Do I need an account to search or download?",
    a: "No. Searching, previewing and downloading are open to everyone. An account only adds saving, collections, uploads and notifications.",
  },
  {
    q: "How does search understand different course names?",
    a: "Synonym mapping and semantic search connect related names, so 'AI past paper' also returns Artificial Intelligence, Machine Intelligence and Intelligent Systems documents.",
  },
  {
    q: "Can I search for an exact exam question?",
    a: "Yes. Text is extracted from PDFs and DOCX files, so searching a question such as 'Explain four types of machine learning' shows the matching section inside the result.",
  },
  {
    q: "What if the institution of a document is unknown?",
    a: "Institution data is optional. Documents are organised by course, topic, type and year, so useful papers are still published.",
  },
  {
    q: "How does the OCR scanner work?",
    a: "Upload a photo. The AI enhances the image, extracts text, reconstructs common academic structure, and generates PDF and DOCX files for correction before publishing.",
  },
];

function HelpPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl">Help centre</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything you need to get the most out of EduSearch AI.
        </p>
        <Accordion type="single" collapsible className="mt-8">
          {faqs.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </main>
      <SiteFooter />
    </div>
  );
}
