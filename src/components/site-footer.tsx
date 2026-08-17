import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <p className="font-display text-lg font-semibold">EduSearch AI</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            Search any course, topic, question or academic document in one place.
          </p>
        </div>
        <FooterCol
          title="Discover"
          links={[
            { to: "/search", label: "Search documents" },
            { to: "/subjects", label: "Browse subjects" },
            { to: "/popular", label: "Popular documents" },
            { to: "/recent", label: "Recently added" },
          ]}
        />
        <FooterCol
          title="Contribute"
          links={[
            { to: "/upload", label: "Upload document" },
            { to: "/scanner", label: "AI OCR scanner" },
            { to: "/saved", label: "Saved documents" },
          ]}
        />
        <FooterCol
          title="Platform"
          links={[
            { to: "/help", label: "Help centre" },
            { to: "/policies", label: "Copyright & privacy" },
            { to: "/contact", label: "Contact" },
          ]}
        />
      </div>
      <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} EduSearch AI. Documents belong to their original authors.
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="text-sm text-muted-foreground transition-colors hover:text-brand"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
