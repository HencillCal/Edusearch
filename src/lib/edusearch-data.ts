export type DocDoc = {
  id: string;
  title: string;
  subject: string;
  topics: string[];
  docType: string;
  year: number;
  level: string;
  language: string;
  fileType: "PDF" | "DOCX" | "Image";
  pages: number;
  size: string;
  institution?: string;
  author?: string;
  downloads: number;
  rating: number;
  addedDaysAgo: number;
  description: string;
  snippet: string;
  keywords: string[];
};

export const subjects = [
  {
    name: "Computing",
    topics: ["Programming", "Networks", "Databases", "Artificial Intelligence", "Cybersecurity"],
    count: 0,
  },
  {
    name: "Business",
    topics: [
      "Accounting",
      "Entrepreneurship",
      "Economics",
      "Marketing",
      "Human Resource Management",
    ],
    count: 0,
  },
  {
    name: "Engineering",
    topics: ["Electrical", "Mechanical", "Civil", "Automotive", "Building Technology"],
    count: 0,
  },
  { name: "Health", topics: ["Anatomy", "Nursing", "Pharmacology", "Public Health"], count: 0 },
  {
    name: "Education",
    topics: ["Curriculum Studies", "Educational Psychology", "Teaching Practice"],
    count: 0,
  },
  {
    name: "Agriculture",
    topics: ["Crop Science", "Animal Production", "Agribusiness"],
    count: 0,
  },
  { name: "Hospitality", topics: ["Food Production", "Front Office", "Tourism"], count: 0 },
  {
    name: "Design",
    topics: ["Graphic Design", "Typography", "Illustration", "UI Design"],
    count: 0,
  },
  {
    name: "Social Sciences",
    topics: ["Sociology", "Communication Skills", "Psychology"],
    count: 0,
  },
];

export const popularSearches: string[] = [];

export const exampleSearches: string[] = [];

export const documentTypes = [
  "Past paper",
  "Marking scheme",
  "Notes",
  "Assignment",
  "Practical paper",
  "Lecture slides",
  "Course outline",
  "Research document",
];

export const synonyms: Record<string, string[]> = {
  ai: [
    "artificial intelligence",
    "machine intelligence",
    "intelligent systems",
    "ai fundamentals",
    "machine learning",
  ],
  "computer maintenance": [
    "computer repair",
    "hardware maintenance",
    "pc troubleshooting",
    "computer systems support",
  ],
  oop: ["object-oriented programming", "classes", "inheritance"],
};

export const documents: DocDoc[] = [];

const norm = (s: string) => s.toLowerCase().trim();

export function searchDocuments(query: string): DocDoc[] {
  const q = norm(query);
  if (!q) return documents;
  const expanded = new Set<string>(q.split(/\s+/));
  for (const [key, values] of Object.entries(synonyms)) {
    if (q.includes(key)) values.forEach((v) => v.split(/\s+/).forEach((w) => expanded.add(w)));
    if (values.some((v) => q.includes(v))) expanded.add(key);
  }
  const terms = [...expanded].filter((t) => t.length > 2);
  return documents
    .map((doc) => {
      const haystack = norm(
        [
          doc.title,
          doc.subject,
          doc.topics.join(" "),
          doc.docType,
          doc.description,
          doc.snippet,
          doc.keywords.join(" "),
        ].join(" "),
      );
      const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      return { doc, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.doc.downloads - a.doc.downloads)
    .map((r) => r.doc);
}

export function getDocument(id: string) {
  return documents.find((d) => d.id === id);
}

export const suggestionSeeds: string[] = [];
