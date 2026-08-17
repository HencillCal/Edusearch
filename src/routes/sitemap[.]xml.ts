import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getDb, initializeDatabase } from "@/backend/db";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        initializeDatabase();
        const configuredUrl = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
        const baseUrl = configuredUrl || new URL(request.url).origin;
        const documents = getDb()
          .prepare(
            `SELECT id,updated_at AS updatedAt FROM documents
             WHERE status='published' AND COALESCE(visibility,'public')='public'
               AND COALESCE(rights_status,'clear') NOT IN ('restricted','removed')
             ORDER BY datetime(updated_at) DESC LIMIT 5000`,
          )
          .all() as Array<{ id: string; updatedAt: string }>;
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "daily", priority: "1.0" },
          { path: "/search", changefreq: "daily", priority: "0.8" },
          { path: "/subjects", changefreq: "weekly", priority: "0.8" },
          { path: "/libraries", changefreq: "weekly", priority: "0.7" },
          { path: "/popular", changefreq: "daily", priority: "0.7" },
          { path: "/recent", changefreq: "daily", priority: "0.7" },
          { path: "/upload", changefreq: "monthly", priority: "0.5" },
          { path: "/scanner", changefreq: "monthly", priority: "0.6" },
          { path: "/saved", changefreq: "monthly", priority: "0.3" },
          { path: "/login", changefreq: "yearly", priority: "0.3" },
          { path: "/register", changefreq: "yearly", priority: "0.3" },
          { path: "/help", changefreq: "monthly", priority: "0.4" },
          { path: "/policies", changefreq: "yearly", priority: "0.3" },
          { path: "/contact", changefreq: "yearly", priority: "0.4" },
          ...documents.map((d) => ({
            path: `/document/${d.id}`,
            lastmod: new Date(d.updatedAt).toISOString(),
            changefreq: "monthly" as const,
            priority: "0.6",
          })),
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${baseUrl}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
