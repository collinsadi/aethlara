import type {
  Job,
  ChatMessage,
  LegacyResume,
  LegacyResumeStructuredData,
} from "./types";

const sampleStructuredData: LegacyResumeStructuredData = {
  fullName: "Alex Rivera",
  email: "alex@aethlara.dev",
  phone: "+1 (555) 234-5678",
  summary:
    "Senior full-stack engineer with 6+ years of experience building scalable web applications. Passionate about AI/ML integration and developer tooling.",
  experience: [
    {
      title: "Senior Software Engineer",
      company: "TechCorp Inc.",
      period: "2022 – Present",
      description:
        "Led a team of 5 engineers building a real-time analytics platform processing 10M+ events/day. Architected microservices migration reducing latency by 40%.",
    },
    {
      title: "Software Engineer",
      company: "StartupXYZ",
      period: "2020 – 2022",
      description:
        "Built core product features for a B2B SaaS platform. Implemented CI/CD pipelines and automated testing, achieving 95% code coverage.",
    },
    {
      title: "Junior Developer",
      company: "WebAgency",
      period: "2018 – 2020",
      description:
        "Developed responsive web applications for enterprise clients using React, Node.js, and PostgreSQL.",
    },
  ],
  education: [
    {
      degree: "B.S. Computer Science",
      school: "University of California, Berkeley",
      year: "2018",
    },
  ],
  skills: [
    "TypeScript",
    "React",
    "Node.js",
    "Python",
    "PostgreSQL",
    "AWS",
    "Docker",
    "Kubernetes",
    "GraphQL",
    "Redis",
  ],
};

export const SAMPLE_RESUMES: LegacyResume[] = [
  {
    id: "res_1",
    name: "Software Engineer Resume",
    rawText: `Alex Rivera\nalex@aethlara.dev | +1 (555) 234-5678\n\nSummary\nSenior full-stack engineer with 6+ years of experience building scalable web applications.\n\nExperience\nSenior Software Engineer — TechCorp Inc. (2022–Present)\n• Led a team of 5 engineers building a real-time analytics platform\n• Architected microservices migration reducing latency by 40%\n\nSoftware Engineer — StartupXYZ (2020–2022)\n• Built core product features for a B2B SaaS platform\n• Implemented CI/CD pipelines achieving 95% code coverage\n\nSkills: TypeScript, React, Node.js, Python, PostgreSQL, AWS, Docker, Kubernetes`,
    structuredData: sampleStructuredData,
    createdAt: "2025-12-01T10:00:00Z",
    updatedAt: "2025-12-15T14:30:00Z",
  },
  {
    id: "res_2",
    name: "Product-Focused Resume",
    rawText: `Alex Rivera\nalex@aethlara.dev\n\nProduct-minded engineer passionate about building delightful user experiences.\n\nExperience\nSenior Software Engineer — TechCorp Inc.\n• Drove product decisions resulting in 25% increase in user engagement\n• Led cross-functional collaboration with design and product teams\n\nSkills: TypeScript, React, Product Strategy, UX Research, Agile, A/B Testing`,
    structuredData: {
      ...sampleStructuredData,
      summary:
        "Product-minded engineer passionate about building delightful user experiences and driving measurable outcomes.",
    },
    createdAt: "2026-01-10T09:00:00Z",
    updatedAt: "2026-01-10T09:00:00Z",
  },
];

export const SAMPLE_JOBS: Job[] = [
  {
    id: "job_1",
    title: "Staff Software Engineer",
    company: "Vercel",
    location: "Remote",
    jobDescription:
      "We're looking for a Staff Software Engineer to help build the future of web development. You'll work on our core infrastructure, developer tools, and platform services. Requirements: 8+ years of experience, deep expertise in TypeScript and React, experience with distributed systems.",
    matchScore: 92,
    status: "interview",
    createdAt: "2026-03-15T10:00:00Z",
    updatedAt: "2026-04-01T10:00:00Z",
    resumeId: "res_1",
  },
  {
    id: "job_2",
    title: "Senior Frontend Engineer",
    company: "Linear",
    location: "Remote (US/EU)",
    jobDescription:
      "Join our team building the best project management tool for software teams. You'll work on our React application, focusing on performance and developer experience. Requirements: 5+ years with React, TypeScript expertise, passion for craft.",
    matchScore: 88,
    status: "applied",
    createdAt: "2026-03-20T10:00:00Z",
    updatedAt: "2026-03-25T10:00:00Z",
    resumeId: "res_1",
  },
  {
    id: "job_3",
    title: "Engineering Manager",
    company: "Stripe",
    location: "San Francisco, CA",
    jobDescription:
      "Lead a team of 8-12 engineers building Stripe's payment processing infrastructure. You'll own the technical strategy and mentor senior engineers. Requirements: 3+ years management experience, strong technical background, experience with financial systems.",
    matchScore: 74,
    status: "not_applied",
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T10:00:00Z",
  },
  {
    id: "job_4",
    title: "Full Stack Developer",
    company: "Notion",
    location: "New York, NY",
    jobDescription:
      "Build features that millions of people use every day. Work across the stack with React, Node.js, and PostgreSQL. Requirements: 4+ years experience, strong product sense, collaborative mindset.",
    matchScore: 85,
    status: "offer",
    createdAt: "2026-02-10T10:00:00Z",
    updatedAt: "2026-04-10T10:00:00Z",
    resumeId: "res_2",
  },
];

export const SAMPLE_CHAT_MESSAGES: Record<string, ChatMessage[]> = {
  job_1: [
    {
      id: "msg_1",
      jobId: "job_1",
      role: "user",
      content: "Analyze this job and tell me how well my resume matches.",
      timestamp: "2026-03-15T10:05:00Z",
    },
    {
      id: "msg_2",
      jobId: "job_1",
      role: "ai",
      content: `## Match Analysis: Staff Software Engineer @ Vercel\n\n**Overall Match Score: 92%** ✨\n\n### Strong Matches\n- ✅ **TypeScript & React expertise** — Your 6+ years directly align\n- ✅ **Distributed systems** — Your microservices migration at TechCorp demonstrates this\n- ✅ **Developer tooling passion** — Evident in your CI/CD work\n\n### Gaps to Address\n- ⚠️ **"Staff" level** — Consider highlighting more technical leadership and architecture decisions\n- ⚠️ **Open source contributions** — Vercel values this; add any OSS work\n\n### Recommended Resume Tweaks\n1. Lead with your architecture work — the microservices migration story is gold\n2. Add metrics: "10M+ events/day" is perfect, add more like this\n3. Mention any Next.js or Vercel-specific experience\n\nWould you like me to tailor your resume for this role?`,
      timestamp: "2026-03-15T10:05:30Z",
    },
    {
      id: "msg_3",
      jobId: "job_1",
      role: "user",
      content: "Yes, please tailor my resume for this position.",
      timestamp: "2026-03-15T10:06:00Z",
    },
    {
      id: "msg_4",
      jobId: "job_1",
      role: "ai",
      content: `## Tailored Resume Ready 🎯\n\nI've optimized your resume for the Vercel Staff Engineer role. Key changes:\n\n### Summary (Updated)\n> Staff-level engineer with 6+ years building high-performance web infrastructure. Expert in TypeScript, React, and distributed systems, with a track record of leading teams and architecting systems processing 10M+ events daily.\n\n### Experience Highlights (Reframed)\n- **"Led architecture migration"** → **"Designed and led company-wide microservices migration, reducing p99 latency by 40% and improving deployment velocity 3x"**\n- Added emphasis on **developer experience** and **platform engineering**\n- Reordered skills to lead with Vercel's core stack\n\n### New Sections Added\n- **Technical Leadership** section highlighting mentorship and architecture decisions\n- **Impact Metrics** woven throughout each role\n\nThe tailored version is available in the preview panel →`,
      timestamp: "2026-03-15T10:06:30Z",
    },
  ],
  job_2: [
    {
      id: "msg_5",
      jobId: "job_2",
      role: "user",
      content: "Can you write a cover letter for this role?",
      timestamp: "2026-03-20T10:05:00Z",
    },
    {
      id: "msg_6",
      jobId: "job_2",
      role: "ai",
      content: `## Cover Letter: Senior Frontend Engineer @ Linear\n\n---\n\nDear Linear Hiring Team,\n\nI'm drawn to Linear because you've proven that **craft matters** — your product is the gold standard for what software tools should feel like. As a senior frontend engineer with deep React and TypeScript expertise, I want to help push that standard even further.\n\nAt TechCorp, I led the frontend architecture for a real-time analytics platform, where **performance wasn't optional — it was the product**. I reduced initial load times by 60% through code splitting, lazy loading, and custom virtualization. This mirrors Linear's obsession with speed.\n\nWhat excites me most is your approach to **local-first architecture**. I've been exploring CRDTs and optimistic UI patterns in my own projects, and I'd love to bring that passion to a team that's already leading the way.\n\nI believe great tools should feel invisible — and Linear already does. I'd love to help keep it that way.\n\nBest,\nAlex Rivera\n\n---\n\n*Shall I adjust the tone or emphasize different aspects?*`,
      timestamp: "2026-03-20T10:05:30Z",
    },
  ],
};

export const AI_RESPONSES: string[] = [
  `Great question! Let me analyze this in detail...\n\nBased on your resume and the job description, here are the key alignment points:\n\n1. **Technical Skills Match**: Your TypeScript and React expertise directly maps to their requirements\n2. **Experience Level**: Your seniority aligns well with what they're seeking\n3. **Culture Fit**: Your product-minded approach matches their values\n\nWould you like me to dig deeper into any specific area?`,

  `## Resume Optimization Suggestions\n\nI've identified several ways to strengthen your application:\n\n- **Quantify more achievements** — Numbers speak louder than descriptions\n- **Mirror their language** — Use keywords from the job description naturally\n- **Lead with impact** — Start each bullet with the result, not the task\n- **Add a "Why This Company" angle** — Show you've done your research\n\nShall I apply these changes to your resume?`,

  `Here's my analysis of the compensation range for this role:\n\n💰 **Estimated Range**: $180K – $240K base + equity\n\nThis is based on:\n- Company stage and funding\n- Role seniority level\n- Location/remote policy\n- Market data for similar positions\n\n*Note: This is an estimate based on market data. Actual compensation may vary.*`,

  `## Interview Prep Tips\n\nFor this role, I'd prepare for:\n\n1. **System Design**: Be ready to design a real-time collaborative editor or similar\n2. **Coding**: Focus on TypeScript patterns, React performance optimization\n3. **Behavioral**: Prepare stories about leading technical decisions under ambiguity\n4. **Culture**: Research their engineering blog and recent product launches\n\nWant me to generate practice questions?`,
];

export function getRandomAIResponse(): string {
  return AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)];
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
