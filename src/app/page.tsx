"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { JourneySankey } from "@/components/JourneySankey";
type Job = {
  rowNumber: number;
  company: string;
  jobTitle: string;
  link: string;
  dateApplied: string;
  status: string;
  followUpDate: string;
  journey: string;
};

type JobDraft = {
  rowNumber: number;
  company: string;
  jobTitle: string;
  link: string;
  dateApplied: string;
  status: string;
  followUpDate: string;
  journey: string;
};

type NewJobDraft = {
  link: string;
  company: string;
  jobTitle: string;
  dateApplied: string;
  status: string;
  followUpDate: string;
  journey: string;
};

const STAGE_COLORS: Record<string, string> = {
  Applied: "#3b82f6",
  "Phone Screen": "#f59e0b",
  OA: "#8b5cf6",
  "Interviewing 1": "#14b8a6",
  "Interviewing 2": "#06b6d4",
  "Interviewing 3": "#0ea5e9",
  "Interviewing 4": "#0284c7",
  Offer: "#16a34a",
  Rejected: "#ef4444",
  "No Response Yet": "#9ca3af",
  Unknown: "#64748b",
};

/** Charts and legends follow this vertical / read order first */
const STAGE_DISPLAY_ORDER = [
  "No Response Yet",
  "Rejected",
  "Phone Screen",
  "OA",
  "Interviewing 1",
  "Interviewing 2",
  "Interviewing 3",
  "Interviewing 4",
  "Offer",
  "Applied",
  "Unknown",
];

const JOURNEY_STAGE_OPTIONS = [
  "Applied",
  "No Response Yet",
  "Phone Screen",
  "OA",
  "Interviewing 1",
  "Interviewing 2",
  "Interviewing 3",
  "Interviewing 4",
  "Offer",
  "Rejected",
] as const;

function stageDisplayRank(name: string): number {
  const idx = STAGE_DISPLAY_ORDER.indexOf(name);
  if (idx >= 0) return idx;
  return 900;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Parse typical sheet/Gmail-derived date strings into a local calendar day. */
function parseSheetDate(dateString: string): Date | null {
  const s = dateString.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, m - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return dt;
    }
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    const y = Number(slash[3]);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return dt;
  }

  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) {
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

function daysSince(dateString: string): number | null {
  const date = parseSheetDate(dateString) ?? new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/** e.g. May 04, 2026 */
function formatJobDate(dateString: string): string {
  const parsed = parseSheetDate(dateString);
  if (!parsed) return dateString.trim() ? dateString.trim() : "—";
  const month = MONTH_NAMES[parsed.getMonth()];
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${month} ${day}, ${parsed.getFullYear()}`;
}

/**
 * Pipeline / journey-map truth: still waiting (incl. inferred from 14d+ with no movement).
 * Journey column + Sankey use this via canonicalStage(); single-step journeys flow to NR here.
 */
function pipelineStatus(job: Job): string {
  const status = job.status?.trim();
  if (status) {
    if (status.toLowerCase() === "applied") {
      const days = daysSince(job.dateApplied);
      if (days !== null && days >= 14) return "No Response Yet";
    }
    return status;
  }
  const days = daysSince(job.dateApplied);
  if (days !== null && days >= 14) return "No Response Yet";
  return "Unknown";
}

/** Table, filter, summary cards: merge “no response yet” into the label **Applied**. */
function listStatus(job: Job): string {
  const pipe = pipelineStatus(job);
  if (pipe === "No Response Yet") return "Applied";
  const lower = pipe.toLowerCase();
  if (lower.includes("no response")) return "Applied";
  if (lower === "applied") return "Applied";
  return pipe;
}

function jobMatchesSearch(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const dated = formatJobDate(job.dateApplied);
  const segments = [
    job.company,
    job.jobTitle,
    job.link,
    job.dateApplied,
    dated,
    job.journey,
    job.status,
    listStatus(job),
  ]
    .filter((s): s is string => Boolean(s?.trim()))
    .map((s) => s.toLowerCase());
  return segments.some((s) => s.includes(q));
}

function toStageLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function canonicalStage(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/_/g, " ");
  if (!normalized) return "Unknown";
  if (normalized.includes("no response")) return "No Response Yet";
  if (normalized === "applied") return "Applied";
  if (normalized === "oa" || normalized.includes("online assessment") || normalized.includes("assessment"))
    return "OA";
  if (normalized === "reject") return "Rejected";

  /**
   * Numbered first round (often technical, sometimes after OA): keep separate from generic "phone".
   * Examples: "Interviewing 1", "Interview 1", "ITV 1", "phone itv 1"
   */
  if (
    /\bitv\s*[-]?\s*1\b/.test(normalized) ||
    /\bitv1\b/.test(normalized) ||
    /\binterview(?:ing)?\s*[-]?\s*1\b/.test(normalized) ||
    /\bround\s*[-]?\s*1\b/.test(normalized)
  ) {
    return "Interviewing 1";
  }

  /** Technical phone screen (engineering) — usually treat as interview round, not recruiter phone */
  if (normalized.includes("technical") && normalized.includes("phone")) {
    return "Interviewing 1";
  }

  /** Recruiter / hiring-manager style phone — can appear before OR after OA; Journey order is truth */
  if (
    normalized.includes("phone screen") ||
    normalized.includes("phone interview") ||
    normalized.includes("recruiter") ||
    normalized.includes("screening call") ||
    normalized.includes("hm screen") ||
    normalized === "phone" ||
    normalized === "psc" ||
    (normalized.includes("phone") && normalized.includes("itv") && !/\d/.test(normalized))
  ) {
    return "Phone Screen";
  }

  if (normalized.includes("interviewing 1") || normalized.includes("interview 1")) {
    return "Interviewing 1";
  }
  if (normalized.includes("interviewing 2") || normalized.includes("interview 2")) {
    return "Interviewing 2";
  }
  if (normalized.includes("interviewing 3") || normalized.includes("interview 3")) {
    return "Interviewing 3";
  }
  if (normalized.includes("interviewing 4") || normalized.includes("interview 4")) {
    return "Interviewing 4";
  }
  if (normalized === "offer") return "Offer";
  if (normalized === "rejected") return "Rejected";
  return toStageLabel(value);
}

function journeyStages(job: Job): string[] {
  if (!job.journey?.trim()) return [];
  const split = job.journey.split(/->|>|,|\|/g).map((part) => canonicalStage(part));
  return split.filter(Boolean);
}

function dedupeJobsByIdentity(list: Job[]): Job[] {
  const seen = new Set<string>();
  const result: Job[] = [];
  for (const job of list) {
    const key = `${job.company}\0${job.jobTitle}\0${job.link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(job);
  }
  return result;
}

/** Matches the same semantics as Journey map aggregation (single-step ⇒ → No Response Yet). */
function jobsForSankeyLink(allJobs: Job[], from: string, to: string): Job[] {
  const out: Job[] = [];
  for (const job of allJobs) {
    const stages = journeyStages(job);
    if (to === "No Response Yet" && stages.length === 1 && stages[0] === from) {
      out.push(job);
      continue;
    }
    let hit = false;
    for (let i = 0; i < stages.length - 1; i += 1) {
      if (stages[i] === from && stages[i + 1] === to) {
        hit = true;
        break;
      }
    }
    if (hit) out.push(job);
  }
  return dedupeJobsByIdentity(out);
}

function jobsForSankeyNode(allJobs: Job[], nodeId: string): Job[] {
  const out: Job[] = [];
  for (const job of allJobs) {
    const stages = journeyStages(job);
    if (stages.includes(nodeId)) {
      out.push(job);
      continue;
    }
    if (nodeId === "No Response Yet" && stages.length === 1) {
      out.push(job);
    }
  }
  return dedupeJobsByIdentity(out);
}

function toDraft(job: Job): JobDraft {
  return {
    rowNumber: job.rowNumber,
    company: job.company ?? "",
    jobTitle: job.jobTitle ?? "",
    link: job.link ?? "",
    dateApplied: job.dateApplied ?? "",
    status: job.status ?? "",
    followUpDate: job.followUpDate ?? "",
    journey: job.journey ?? "",
  };
}

function parseJourneyDraft(journey: string): string[] {
  if (!journey.trim()) return [];
  return journey
    .split(/->|>|,|\|/g)
    .map((part) => canonicalStage(part))
    .filter(Boolean);
}

function lastJourneyStatus(stages: string[]): string {
  if (!stages.length) return "Applied";
  return stages[stages.length - 1] ?? "Applied";
}

function rowDateGroupKey(dateApplied: string): string {
  const parsed = parseSheetDate(dateApplied);
  if (!parsed) return `raw:${dateApplied.trim().toLowerCase()}`;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Row tint uses list label (NR → Applied uses Applied grey). */
function canonicalListStatus(job: Job): string {
  return canonicalStage(listStatus(job));
}

function jobTableRowClasses(job: Job): string {
  const base =
    "cursor-pointer border-t border-zinc-200 transition-colors dark:border-zinc-800";
  switch (canonicalListStatus(job)) {
    case "Rejected":
      return `${base} bg-red-50 hover:bg-red-100/95 dark:bg-red-950/35 dark:hover:bg-red-950/50`;
    case "OA":
      return `${base} bg-blue-50 hover:bg-blue-100/95 dark:bg-blue-950/40 dark:hover:bg-blue-950/55`;
    case "Interviewing 1":
      return `${base} bg-amber-50 hover:bg-amber-100/95 dark:bg-amber-950/30 dark:hover:bg-amber-950/45`;
    case "Applied":
      return `${base} bg-zinc-100 hover:bg-zinc-200/90 dark:bg-zinc-800/45 dark:hover:bg-zinc-800/65`;
    default:
      return `${base} bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/80`;
  }
}

/** Drop weighted edges that would create a directed cycle (bad journeys / typos). */
function filterAcyclicWeightedEdges(weights: Map<string, number>): Map<string, number> {
  const entries = [...weights.entries()]
    .map(([key, value]) => {
      const [from, to] = key.split("|||");
      return { key, from, to, value };
    })
    .filter((row) => row.from && row.to && row.from !== row.to && row.value > 0);

  entries.sort((a, b) => b.value - a.value);

  const adj = new Map<string, Set<string>>();

  const canReachIter = (start: string, goal: string): boolean => {
    const stack = [start];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === goal) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      const next = adj.get(n);
      if (!next) continue;
      next.forEach((t) => stack.push(t));
    }
    return false;
  };

  const kept = new Map<string, number>();

  for (const row of entries) {
    if (canReachIter(row.to, row.from)) continue;
    if (!adj.has(row.from)) adj.set(row.from, new Set());
    adj.get(row.from)!.add(row.to);
    kept.set(row.key, row.value);
  }

  return kept;
}

export default function Home() {
  const PAGE_SIZE = 50;
  const router = useRouter();
  const { data: session, status } = useSession();
  const [syncLoading, setSyncLoading] = useState(false);
  const [watchLoading, setWatchLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [journeyModalJob, setJourneyModalJob] = useState<Job | null>(null);
  const [jobDraft, setJobDraft] = useState<JobDraft | null>(null);
  const [journeyDraftStages, setJourneyDraftStages] = useState<string[]>([]);
  const [journeyStageToAdd, setJourneyStageToAdd] = useState<string>(JOURNEY_STAGE_OPTIONS[0]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addStep, setAddStep] = useState<"link" | "confirm">("link");
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState("");
  const [newJobDraft, setNewJobDraft] = useState<NewJobDraft>({
    link: "",
    company: "",
    jobTitle: "",
    dateApplied: new Date().toISOString().slice(0, 10),
    status: "Applied",
    followUpDate: "",
    journey: "Applied",
  });
  const [sankeyBrowse, setSankeyBrowse] = useState<{
    title: string;
    jobs: Job[];
  } | null>(null);

  useEffect(() => {
    const anyOpen = journeyModalJob || sankeyBrowse || addModalOpen;
    if (!anyOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setJourneyModalJob(null);
      setJobDraft(null);
      setJourneyDraftStages([]);
      setJourneyStageToAdd(JOURNEY_STAGE_OPTIONS[0]);
      setSaveMessage("");
      setSankeyBrowse(null);
      setAddModalOpen(false);
      setAddStep("link");
      setAddMessage("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [journeyModalJob, sankeyBrowse, addModalOpen]);

  function openJobModal(job: Job) {
    setSankeyBrowse(null);
    setJourneyModalJob(job);
    const draft = toDraft(job);
    const parsedStages = parseJourneyDraft(draft.journey);
    setJobDraft({
      ...draft,
      journey: parsedStages.join(", "),
    });
    setJourneyDraftStages(parsedStages);
    setJourneyStageToAdd(JOURNEY_STAGE_OPTIONS[0]);
    setSaveMessage("");
  }

  const statuses = useMemo(() => {
    const list = Array.from(new Set(jobs.map((job) => listStatus(job)).filter(Boolean)));
    return ["All", ...list];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    if (statusFilter === "All") return jobs;
    return jobs.filter((job) => listStatus(job) === statusFilter);
  }, [jobs, statusFilter]);

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].reverse();
  }, [filteredJobs]);

  const tableFilteredJobs = useMemo(() => {
    if (!jobSearchQuery.trim()) return sortedJobs;
    return sortedJobs.filter((job) => jobMatchesSearch(job, jobSearchQuery));
  }, [sortedJobs, jobSearchQuery]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(tableFilteredJobs.length / PAGE_SIZE));
  }, [tableFilteredJobs.length, PAGE_SIZE]);

  const visiblePageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    for (let p = adjustedStart; p <= end; p += 1) pages.push(p);
    return pages;
  }, [currentPage, totalPages]);

  const pagedJobs = useMemo(() => {
    const safePage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return tableFilteredJobs.slice(start, start + PAGE_SIZE);
  }, [tableFilteredJobs, currentPage, totalPages, PAGE_SIZE]);

  const statusCounts = useMemo(() => {
    return jobs.reduce<Record<string, number>>((acc, job) => {
      const key = listStatus(job);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [jobs]);

  useEffect(() => {
    if (!jobDraft) return;
    const nextJourney = journeyDraftStages.join(", ");
    const nextStatus = lastJourneyStatus(journeyDraftStages);
    if (jobDraft.journey === nextJourney && jobDraft.status === nextStatus) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobDraft({ ...jobDraft, journey: nextJourney, status: nextStatus });
  }, [journeyDraftStages, jobDraft]);

  useEffect(() => {
    const stages = parseJourneyDraft(newJobDraft.journey);
    const nextStatus = lastJourneyStatus(stages);
    if (newJobDraft.status === nextStatus) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewJobDraft({ ...newJobDraft, status: nextStatus });
  }, [newJobDraft]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [statusFilter, jobSearchQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const journeyTransitions = useMemo(() => {
    const edgeWeights = new Map<string, number>();

    for (const job of jobs) {
      const stages = journeyStages(job);
      if (stages.length === 1) {
        const from = stages[0];
        const to = "No Response Yet";
        const key = `${from}|||${to}`;
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
        continue;
      }
      if (stages.length < 2) continue;
      for (let i = 0; i < stages.length - 1; i += 1) {
        const from = stages[i];
        const to = stages[i + 1];
        if (!from || !to || from === to) continue;
        const key = `${from}|||${to}`;
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      }
    }

    const safeWeights = filterAcyclicWeightedEdges(edgeWeights);

    const rows = Array.from(safeWeights.entries())
      .map(([key, count]) => {
        const [from, to] = key.split("|||");
        return { from, to, count };
      })
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const rf = stageDisplayRank(a.from) - stageDisplayRank(b.from);
        if (rf !== 0) return rf;
        if (a.from !== b.from) return a.from.localeCompare(b.from);
        const rt = stageDisplayRank(a.to) - stageDisplayRank(b.to);
        if (rt !== 0) return rt;
        return a.to.localeCompare(b.to);
      });

    return { rows };
  }, [jobs]);

  async function loadJobs() {
    setJobsLoading(true);
    try {
      const response = await fetch("/api/jobs");
      const data = (await response.json()) as { jobs?: Job[]; error?: string };
      if (!response.ok) {
        setSyncMessage(data.error ?? "Failed to load dashboard data.");
        return;
      }
      setJobs(data.jobs ?? []);
    } catch {
      setSyncMessage("Failed to load dashboard data.");
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadJobs();
    }
  }, [status]);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    router.replace("/signin");
  }, [status, router]);

  async function runSync() {
    setSyncLoading(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        updated?: number;
        scanned?: number;
        diagnostics?: {
          hasSession?: boolean;
          hasSessionAccessToken?: boolean;
          hasJwtToken?: boolean;
          hasJwtAccessToken?: boolean;
        };
      };

      if (!response.ok) {
        const diagnostics = data.diagnostics
          ? ` (session:${data.diagnostics.hasSession ? "yes" : "no"}, sessionToken:${data.diagnostics.hasSessionAccessToken ? "yes" : "no"}, jwt:${data.diagnostics.hasJwtToken ? "yes" : "no"}, jwtToken:${data.diagnostics.hasJwtAccessToken ? "yes" : "no"})`
          : "";
        setSyncMessage(`${data.error ?? "Sync failed."}${diagnostics}`);
        return;
      }

      setSyncMessage(
        `Sync complete. Scanned ${data.scanned ?? 0} emails and updated ${data.updated ?? 0} row(s).`,
      );
      await loadJobs();
    } catch {
      setSyncMessage("Sync failed. Please try again.");
    } finally {
      setSyncLoading(false);
    }
  }

  async function enableRealtimeSync() {
    setWatchLoading(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/gmail/watch", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        expiration?: string;
      };
      if (!response.ok) {
        setSyncMessage(data.error ?? "Failed to enable Gmail push watch.");
        return;
      }
      const expiry = data.expiration ? new Date(Number(data.expiration)).toLocaleString() : "unknown";
      setSyncMessage(`Realtime watch enabled. Gmail watch expires around: ${expiry}.`);
    } catch {
      setSyncMessage("Failed to enable Gmail push watch.");
    } finally {
      setWatchLoading(false);
    }
  }

  async function saveJobEdits() {
    if (!jobDraft) return;
    setSaveLoading(true);
    setSaveMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobDraft),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSaveMessage(data.error ?? "Failed to save changes.");
        return;
      }
      setSaveMessage("Saved to Google Sheets.");
      await loadJobs();
      setJourneyModalJob({
        rowNumber: jobDraft.rowNumber,
        company: jobDraft.company,
        jobTitle: jobDraft.jobTitle,
        link: jobDraft.link,
        dateApplied: jobDraft.dateApplied,
        status: jobDraft.status,
        followUpDate: jobDraft.followUpDate,
        journey: jobDraft.journey,
      });
    } catch {
      setSaveMessage("Failed to save changes.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function createApplicationFromLink() {
    if (!newJobDraft.link.trim()) {
      setAddMessage("Please paste a job link first.");
      return;
    }
    setAddLoading(true);
    setAddMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newJobDraft),
      });
      const data = (await response.json()) as {
        error?: string;
        inferred?: { company?: string; jobTitle?: string };
      };
      if (!response.ok) {
        setAddMessage(data.error ?? "Failed to add application.");
        return;
      }
      setAddMessage(
        `Added. Detected ${data.inferred?.company ?? "company"} — ${data.inferred?.jobTitle ?? "title"}.`,
      );
      await loadJobs();
      setAddModalOpen(false);
      setAddStep("link");
      setNewJobDraft({
        link: "",
        company: "",
        jobTitle: "",
        dateApplied: new Date().toISOString().slice(0, 10),
        status: "Applied",
        followUpDate: "",
        journey: "Applied",
      });
    } catch {
      setAddMessage("Failed to add application.");
    } finally {
      setAddLoading(false);
    }
  }

  async function previewApplicationFromLink() {
    if (!newJobDraft.link.trim()) {
      setAddMessage("Please paste a job link first.");
      return;
    }
    setAddLoading(true);
    setAddMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preview: true,
          link: newJobDraft.link,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        draft?: Partial<NewJobDraft>;
      };
      if (!response.ok || !data.draft) {
        setAddMessage(data.error ?? "Could not detect company/title from this link.");
        return;
      }
      setNewJobDraft({
        link: data.draft.link ?? newJobDraft.link,
        company: data.draft.company ?? "",
        jobTitle: data.draft.jobTitle ?? "",
        dateApplied: data.draft.dateApplied ?? new Date().toISOString().slice(0, 10),
        status: data.draft.status ?? "Applied",
        followUpDate: data.draft.followUpDate ?? "",
        journey: data.draft.journey ?? "Applied",
      });
      setAddStep("confirm");
    } catch {
      setAddMessage("Could not detect company/title from this link.");
    } finally {
      setAddLoading(false);
    }
  }

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 p-8 font-sans dark:bg-black">
      <main className="w-full max-w-6xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Job Tracker Dashboard
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with Google to allow Gmail and Sheets sync.
        </p>

        {!session ? null : (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Signed in as{" "}
              <span className="font-medium">{session.user?.email}</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  setAddMessage("");
                  setAddStep("link");
                  setNewJobDraft({
                    link: "",
                    company: "",
                    jobTitle: "",
                    dateApplied: new Date().toISOString().slice(0, 10),
                    status: "Applied",
                    followUpDate: "",
                    journey: "Applied",
                  });
                  setAddModalOpen(true);
                  setSankeyBrowse(null);
                  setJourneyModalJob(null);
                  setJobDraft(null);
                }}
                className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Add Application
              </button>
              <button
                onClick={runSync}
                disabled={syncLoading}
                className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {syncLoading ? "Syncing..." : "Sync Gmail to Sheet"}
              </button>
              <button
                onClick={enableRealtimeSync}
                disabled={watchLoading}
                className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {watchLoading ? "Enabling..." : "Enable Realtime Watch"}
              </button>
              <button
                onClick={loadJobs}
                disabled={jobsLoading}
                className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {jobsLoading ? "Refreshing..." : "Refresh Dashboard"}
              </button>
            </div>
            {syncMessage ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{syncMessage}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Jobs</p>
                <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {jobs.length}
                </p>
              </div>
              {Object.entries(statusCounts)
                .sort((a, b) => {
                  const ra = stageDisplayRank(a[0]) - stageDisplayRank(b[0]);
                  if (ra !== 0) return ra;
                  return b[1] - a[1];
                })
                .slice(0, 3)
                .map(([name, count]) => (
                  <div
                    key={name}
                    className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                  >
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{name}</p>
                    <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                      {count}
                    </p>
                  </div>
                ))}
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Journey map
              </p>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                Sankey diagram of <span className="font-medium">From → To</span> steps from your{" "}
                <span className="font-medium">Journey</span> column. Cycles are trimmed so the layout stays stable.
                Click any <span className="font-medium text-zinc-600 dark:text-zinc-400">stage or flow</span> to list matching jobs.
              </p>
              {journeyTransitions.rows.length ? (
                <JourneySankey
                  rows={journeyTransitions.rows}
                  stageRank={stageDisplayRank}
                  stageColors={STAGE_COLORS}
                  onInspectNode={(nodeId) => {
                    setJourneyModalJob(null);
                    setSankeyBrowse({
                      title: nodeId,
                      jobs: jobsForSankeyNode(jobs, nodeId),
                    });
                  }}
                  onInspectLink={(from, to) => {
                    setJourneyModalJob(null);
                    setSankeyBrowse({
                      title: `${from} → ${to}`,
                      jobs: jobsForSankeyLink(jobs, from, to),
                    });
                  }}
                />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Add a <span className="font-medium">Journey</span> column (e.g.{" "}
                  <span className="font-medium">Applied, Phone Screen, OA</span>) to see the map.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="status-filter"
                  className="text-sm whitespace-nowrap text-zinc-700 dark:text-zinc-300"
                >
                  Status:
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1">
                <label
                  htmlFor="job-search"
                  className="text-sm text-zinc-700 dark:text-zinc-300"
                >
                  Search
                </label>
                <input
                  id="job-search"
                  type="search"
                  value={jobSearchQuery}
                  onChange={(event) => setJobSearchQuery(event.target.value)}
                  placeholder="Company, title, journey, date, link…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-zinc-100 dark:bg-zinc-900">
                  <tr>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Job Title</th>
                    <th className="px-4 py-3 font-medium">Date Applied</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedJobs.map((job, index) => (
                    <tr
                      key={`${job.company}-${job.jobTitle}-${(currentPage - 1) * PAGE_SIZE + index}`}
                      className={`${jobTableRowClasses(job)} ${
                        index > 0 &&
                        rowDateGroupKey(pagedJobs[index - 1]?.dateApplied ?? "") !==
                          rowDateGroupKey(job.dateApplied)
                          ? "border-t-4 border-zinc-400/70 dark:border-zinc-500/70"
                          : ""
                      }`}
                      onClick={() => openJobModal(job)}
                    >
                      <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">{job.company || "—"}</td>
                      <td className="px-4 py-3">
                        {job.link ? (
                          <a
                            href={job.link}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {job.jobTitle?.trim() ? job.jobTitle : "View posting"}
                          </a>
                        ) : (
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {job.jobTitle?.trim() ? job.jobTitle : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-800 dark:text-zinc-200">
                        {formatJobDate(job.dateApplied)}
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        {listStatus(job)}
                      </td>
                    </tr>
                  ))}
                  {!jobsLoading && tableFilteredJobs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                        {filteredJobs.length > 0
                          ? "No jobs match your search."
                          : "No jobs found for this filter."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {tableFilteredJobs.length > 0 ? (
              <div className="flex items-center justify-between pt-2 text-sm text-zinc-600 dark:text-zinc-300">
                <span>
                  Page {currentPage} of {totalPages} ({tableFilteredJobs.length} rows)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700"
                  >
                    Previous
                  </button>
                  {visiblePageNumbers.map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`rounded-lg border px-3 py-1.5 ${
                        page === currentPage
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
            {addModalOpen ? (
              <div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
                role="presentation"
                onClick={() => setAddModalOpen(false)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="add-job-title"
                  className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 id="add-job-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Add application from link
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Paste the URL; company and role are auto-filled when possible.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close"
                      className="-mr-2 -mt-2 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      onClick={() => setAddModalOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-5 space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Link</span>
                      <input
                        value={newJobDraft.link}
                        onChange={(event) => setNewJobDraft({ ...newJobDraft, link: event.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </label>
                    {addStep === "confirm" ? (
                      <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Company</span>
                        <input
                          value={newJobDraft.company}
                          onChange={(event) => setNewJobDraft({ ...newJobDraft, company: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Role Title</span>
                        <input
                          value={newJobDraft.jobTitle}
                          onChange={(event) => setNewJobDraft({ ...newJobDraft, jobTitle: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date Applied</span>
                        <input
                          value={newJobDraft.dateApplied}
                          onChange={(event) => setNewJobDraft({ ...newJobDraft, dateApplied: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</span>
                        <div className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                          {newJobDraft.status || "Applied"}
                        </div>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Follow-Up</span>
                        <input
                          value={newJobDraft.followUpDate}
                          onChange={(event) => setNewJobDraft({ ...newJobDraft, followUpDate: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Journey (optional)</span>
                      <input
                        value={newJobDraft.journey}
                        onChange={(event) => setNewJobDraft({ ...newJobDraft, journey: event.target.value })}
                        placeholder="Applied, OA"
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </label>
                      </>
                    ) : (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Click Continue and I will detect company and role title first.
                      </p>
                    )}
                    {addMessage ? (
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">{addMessage}</p>
                    ) : null}
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
                        onClick={() => {
                          if (addStep === "confirm") {
                            setAddStep("link");
                            return;
                          }
                          setAddModalOpen(false);
                        }}
                      >
                        {addStep === "confirm" ? "Back" : "Cancel"}
                      </button>
                      {addStep === "link" ? (
                        <button
                          type="button"
                          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          disabled={addLoading}
                          onClick={() => void previewApplicationFromLink()}
                        >
                          {addLoading ? "Checking..." : "Continue"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          disabled={addLoading}
                          onClick={() => void createApplicationFromLink()}
                        >
                          {addLoading ? "Adding..." : "Add to Sheet"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {sankeyBrowse ? (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
                role="presentation"
                onClick={() => setSankeyBrowse(null)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="sankey-browse-title"
                  className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 p-5 dark:border-zinc-800">
                    <div className="min-w-0 pr-6">
                      <h2
                        id="sankey-browse-title"
                        className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
                      >
                        {sankeyBrowse.title}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {sankeyBrowse.jobs.length}{" "}
                        {sankeyBrowse.jobs.length === 1 ? "application" : "applications"}
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {" "}
                          · click a row for journey detail
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close"
                      className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      onClick={() => setSankeyBrowse(null)}
                    >
                      ×
                    </button>
                  </div>
                  <ul className="min-h-[120px] flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                    {sankeyBrowse.jobs.length ? (
                      sankeyBrowse.jobs.map((job, index) => (
                        <li key={`${job.company}-${job.jobTitle}-${job.link}-${index}`}>
                          <button
                            type="button"
                            className="flex w-full flex-col gap-0.5 px-5 py-3 text-left text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900/80"
                            onClick={() => {
                              setSankeyBrowse(null);
                              openJobModal(job);
                            }}
                          >
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {job.company || "—"}
                            </span>
                            <span className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                              {job.jobTitle?.trim() ? job.jobTitle : "—"}
                              {job.link ? (
                                <>
                                  {" "}
                                  <span className="text-blue-600 dark:text-blue-400">(open posting)</span>
                                </>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        No applications match—check that the <span className="font-medium">Journey</span> column
                        includes this stage or transition.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            ) : null}
            {journeyModalJob ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
                role="presentation"
                onClick={() => {
                  setJourneyModalJob(null);
                  setJobDraft(null);
                  setJourneyDraftStages([]);
                  setJourneyStageToAdd(JOURNEY_STAGE_OPTIONS[0]);
                  setSaveMessage("");
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="journey-modal-title"
                  className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 id="journey-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Edit application
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Changes save directly to Google Sheets.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close"
                      className="-mr-2 -mt-2 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      onClick={() => {
                        setJourneyModalJob(null);
                        setJobDraft(null);
                        setJourneyDraftStages([]);
                        setJourneyStageToAdd(JOURNEY_STAGE_OPTIONS[0]);
                        setSaveMessage("");
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {jobDraft ? (
                    <div className="mt-5 space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Company</span>
                        <input
                          value={jobDraft.company}
                          onChange={(event) => setJobDraft({ ...jobDraft, company: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Job Title</span>
                        <input
                          value={jobDraft.jobTitle}
                          onChange={(event) => setJobDraft({ ...jobDraft, jobTitle: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Link</span>
                        <input
                          value={jobDraft.link}
                          onChange={(event) => setJobDraft({ ...jobDraft, link: event.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date Applied</span>
                          <input
                            value={jobDraft.dateApplied}
                            onChange={(event) => setJobDraft({ ...jobDraft, dateApplied: event.target.value })}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Follow-Up Date</span>
                          <input
                            value={jobDraft.followUpDate}
                            onChange={(event) => setJobDraft({ ...jobDraft, followUpDate: event.target.value })}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </label>
                      </div>
                      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Journey</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={journeyStageToAdd}
                            onChange={(event) => setJourneyStageToAdd(event.target.value)}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          >
                            {JOURNEY_STAGE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
                            onClick={() => setJourneyDraftStages([...journeyDraftStages, journeyStageToAdd])}
                          >
                            Add stage
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                            onClick={() => setJourneyDraftStages([])}
                          >
                            Clear
                          </button>
                        </div>
                        {journeyDraftStages.length > 0 ? (
                          <div className="mt-3 flex flex-wrap items-center gap-1 text-sm text-zinc-700 dark:text-zinc-200">
                            {journeyDraftStages.map((stage, i) => (
                              <span key={`${stage}-${i}`} className="inline-flex items-center gap-1">
                                {i > 0 ? <span className="text-zinc-400 dark:text-zinc-500">→</span> : null}
                                <button
                                  type="button"
                                  className="rounded-md bg-zinc-100 px-2 py-1 font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                                  onClick={() =>
                                    setJourneyDraftStages(journeyDraftStages.filter((_, idx) => idx !== i))
                                  }
                                  title="Remove this stage"
                                >
                                  {stage}
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm italic text-zinc-500 dark:text-zinc-400">
                            No journey stages selected.
                          </p>
                        )}
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</span>
                        <div className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                          {jobDraft.status || "Applied"}
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Auto set from the last Journey stage.
                        </p>
                      </label>
                      {saveMessage ? (
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">{saveMessage}</p>
                      ) : null}
                      <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                          type="button"
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
                          onClick={() => {
                            setJourneyModalJob(null);
                            setJobDraft(null);
                            setJourneyDraftStages([]);
                            setJourneyStageToAdd(JOURNEY_STAGE_OPTIONS[0]);
                            setSaveMessage("");
                          }}
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          disabled={saveLoading}
                          onClick={() => void saveJobEdits()}
                        >
                          {saveLoading ? "Saving..." : "Save to Sheet"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <button
              onClick={() => signOut()}
              className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Sign out
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
