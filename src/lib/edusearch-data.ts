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
    count: 1840,
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
    count: 1260,
  },
  {
    name: "Engineering",
    topics: ["Electrical", "Mechanical", "Civil", "Automotive", "Building Technology"],
    count: 1105,
  },
  { name: "Health", topics: ["Anatomy", "Nursing", "Pharmacology", "Public Health"], count: 720 },
  {
    name: "Education",
    topics: ["Curriculum Studies", "Educational Psychology", "Teaching Practice"],
    count: 480,
  },
  {
    name: "Agriculture",
    topics: ["Crop Science", "Animal Production", "Agribusiness"],
    count: 390,
  },
  { name: "Hospitality", topics: ["Food Production", "Front Office", "Tourism"], count: 310 },
  {
    name: "Design",
    topics: ["Graphic Design", "Typography", "Illustration", "UI Design"],
    count: 425,
  },
  {
    name: "Social Sciences",
    topics: ["Sociology", "Communication Skills", "Psychology"],
    count: 505,
  },
];

export const popularSearches = [
  "Artificial Intelligence",
  "Python Programming",
  "Graphic Design",
  "Accounting",
  "Computer Networks",
  "Electrical Installation",
];

export const exampleSearches = [
  "Python OOP practical questions",
  "Graphic Design examination paper",
  "Networking notes PDF",
  "Entrepreneurship marking scheme",
  "Artificial Intelligence CAT",
  "Electrical engineering practical manual",
];

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

export const documents: DocDoc[] = [
  {
    id: "python-oop-practical-2025",
    title: "Python Object-Oriented Programming Practical Questions",
    subject: "Python Programming",
    topics: ["Classes", "Inheritance", "Objects"],
    docType: "Practical paper",
    year: 2025,
    level: "Intermediate",
    language: "English",
    fileType: "PDF",
    pages: 6,
    size: "1.2 MB",
    institution: "Unknown",
    author: "Dept. of Computing",
    downloads: 4820,
    rating: 4.8,
    addedDaysAgo: 3,
    description:
      "Six practical tasks covering class design, inheritance chains, encapsulation and object composition with marking guidance.",
    snippet:
      "Question 4: Explain four types of machine learning and demonstrate a class hierarchy for each.",
    keywords: ["python", "oop", "practical", "classes", "inheritance"],
  },
  {
    id: "oop-notes-python",
    title: "Object-Oriented Programming Notes Using Python",
    subject: "Programming",
    topics: ["OOP", "Python", "Abstraction"],
    docType: "Notes",
    year: 2024,
    level: "Beginner",
    language: "English",
    fileType: "DOCX",
    pages: 34,
    size: "3.6 MB",
    author: "M. Achieng",
    downloads: 9120,
    rating: 4.6,
    addedDaysAgo: 11,
    description:
      "Full semester notes introducing objects, classes, polymorphism and exception handling in Python.",
    snippet:
      "3.2 Inheritance allows a subclass to reuse and extend the behaviour of a parent class...",
    keywords: ["python", "notes", "oop", "polymorphism"],
  },
  {
    id: "ai-past-paper-2025",
    title: "Artificial Intelligence Past Paper 2025",
    subject: "Artificial Intelligence",
    topics: ["Search algorithms", "Machine learning", "Knowledge representation"],
    docType: "Past paper",
    year: 2025,
    level: "Diploma",
    language: "English",
    fileType: "PDF",
    pages: 8,
    size: "980 KB",
    institution: "Technical University",
    downloads: 7340,
    rating: 4.9,
    addedDaysAgo: 1,
    description:
      "End of semester examination paper covering intelligent agents, search and learning paradigms.",
    snippet: "Question 1(b): Explain four types of machine learning. (8 marks)",
    keywords: ["ai", "artificial intelligence", "past paper", "machine learning"],
  },
  {
    id: "dbms-past-paper",
    title: "Database Management Systems Past Paper",
    subject: "Databases",
    topics: ["Normalisation", "SQL", "Transactions"],
    docType: "Past paper",
    year: 2024,
    level: "Certificate",
    language: "English",
    fileType: "PDF",
    pages: 5,
    size: "740 KB",
    downloads: 6110,
    rating: 4.5,
    addedDaysAgo: 20,
    description: "Examination paper on relational design, SQL querying and transaction management.",
    snippet: "Question 3: Normalise the given relation to third normal form. (10 marks)",
    keywords: ["database", "sql", "dbms", "normalisation"],
  },
  {
    id: "graphic-design-marking-scheme",
    title: "Graphic Design Marking Scheme",
    subject: "Graphic Design",
    topics: ["Typography", "Layout", "Colour theory"],
    docType: "Marking scheme",
    year: 2025,
    level: "Diploma",
    language: "English",
    fileType: "PDF",
    pages: 12,
    size: "2.1 MB",
    downloads: 2980,
    rating: 4.4,
    addedDaysAgo: 6,
    description: "Official marking guide with award points for each design examination question.",
    snippet: "Award 2 marks for correct explanation of visual hierarchy...",
    keywords: ["graphic design", "marking scheme", "typography"],
  },
  {
    id: "networking-notes",
    title: "Computer Networks Complete Notes",
    subject: "Computer Networks",
    topics: ["OSI model", "Routing", "Subnetting"],
    docType: "Notes",
    year: 2024,
    level: "Intermediate",
    language: "English",
    fileType: "PDF",
    pages: 58,
    size: "6.4 MB",
    author: "J. Kimani",
    downloads: 10450,
    rating: 4.7,
    addedDaysAgo: 30,
    description:
      "Detailed networking notes from physical layer fundamentals to routing protocols and subnetting practice.",
    snippet: "4.1 Subnetting divides a network into smaller logical segments...",
    keywords: ["networking", "osi", "routing", "notes"],
  },
  {
    id: "entrepreneurship-marking-scheme",
    title: "Entrepreneurship Marking Scheme 2025",
    subject: "Entrepreneurship",
    topics: ["Business plan", "Innovation", "Finance"],
    docType: "Marking scheme",
    year: 2025,
    level: "Certificate",
    language: "English",
    fileType: "DOCX",
    pages: 9,
    size: "820 KB",
    downloads: 3410,
    rating: 4.3,
    addedDaysAgo: 4,
    description: "Answers and award criteria for the entrepreneurship end of term examination.",
    snippet: "Any four characteristics of an entrepreneur @1 mark each...",
    keywords: ["entrepreneurship", "marking scheme", "business"],
  },
  {
    id: "electrical-practical-manual",
    title: "Electrical Engineering Practical Manual",
    subject: "Electrical Engineering",
    topics: ["Wiring", "Solar installation", "Testing"],
    docType: "Practical paper",
    year: 2023,
    level: "Diploma",
    language: "English",
    fileType: "PDF",
    pages: 42,
    size: "8.9 MB",
    institution: "National Polytechnic",
    downloads: 5220,
    rating: 4.6,
    addedDaysAgo: 45,
    description:
      "Laboratory manual covering domestic wiring, solar installation and safety testing procedures.",
    snippet: "Experiment 7: Install and commission a 12V solar lighting circuit.",
    keywords: ["electrical", "practical", "solar", "manual"],
  },
  {
    id: "accounting-cat",
    title: "Financial Accounting CAT with Solutions",
    subject: "Accounting",
    topics: ["Ledgers", "Trial balance", "Final accounts"],
    docType: "Past paper",
    year: 2025,
    level: "Certificate",
    language: "English",
    fileType: "PDF",
    pages: 7,
    size: "1.1 MB",
    downloads: 4030,
    rating: 4.5,
    addedDaysAgo: 8,
    description:
      "Continuous assessment test on double entry, ledgers and preparation of final accounts.",
    snippet: "Question 2: Prepare the trial balance as at 31 December. (12 marks)",
    keywords: ["accounting", "cat", "trial balance"],
  },
  {
    id: "java-cat-2024",
    title: "Java Programming CAT 2024",
    subject: "Java Programming",
    topics: ["Arrays", "Methods", "Exception handling"],
    docType: "Past paper",
    year: 2024,
    level: "Beginner",
    language: "English",
    fileType: "Image",
    pages: 4,
    size: "3.2 MB",
    downloads: 2210,
    rating: 4.1,
    addedDaysAgo: 15,
    description: "Photographed Java assessment converted to searchable text by the OCR scanner.",
    snippet: "Question 5: Write a Java method that catches an ArithmeticException.",
    keywords: ["java", "cat", "ocr"],
  },
];

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

export const suggestionSeeds = [
  "Artificial Intelligence past paper 2025",
  "Database Management Systems past paper",
  "Python OOP practical questions",
  "Computer networks notes PDF",
  "Explain four types of machine learning",
  "Entrepreneurship marking scheme",
];
