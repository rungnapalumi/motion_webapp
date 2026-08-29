const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8002").replace(
  /\/$/,
  "",
);

export type Artifact = {
  ready: boolean;
  s3_key: string | null;
  url: string | null;
};

export type JobCreateResponse = {
  ok: boolean;
  group_id: string;
  dots_job_id: string;
  skeleton_job_id: string;
  report_job_id: string;
  languages?: string[];
  created_at?: string;
};

export type JobStatusResponse = {
  ok: boolean;
  group_id: string;
  overall_pct: number;
  complete: boolean;
  outcome?: "processing" | "complete" | "rejected" | "failed";
  terminal?: boolean;
  message?: string;
  rejection?: {
    codes?: string[];
    primary_code?: string;
    stage?: string;
    user_message_en?: string;
    user_message_th?: string;
    email_sent?: boolean | null;
  } | null;
  status: {
    dots: string;
    skeleton: string;
    report: string;
  };
  results: {
    dots_video: Artifact;
    skeleton_video: Artifact;
    report_en_pdf: Artifact;
    report_th_pdf: Artifact;
  };
};

export type JobIds = {
  dots_job_id?: string;
  skeleton_job_id?: string;
  report_job_id?: string;
};

function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "object" && d && "msg" in d ? String(d.msg) : JSON.stringify(d)))
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const en = typeof d.user_message_en === "string" ? d.user_message_en.trim() : "";
    const th = typeof d.user_message_th === "string" ? d.user_message_th.trim() : "";
    if (en || th) {
      return [
        "This video could not be accepted for Presenter Analysis.",
        en,
        th,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    if (typeof d.message === "string" && d.message.trim()) return d.message;
    return JSON.stringify(detail);
  }
  return "Request failed";
}

export async function createJob(form: FormData): Promise<JobCreateResponse> {
  const res = await fetch(`${API_BASE}/v1/jobs`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(detailMessage(data.detail) || `HTTP ${res.status}`);
  return data as JobCreateResponse;
}

export async function getJobStatus(
  groupId: string,
  jobIds: JobIds = {},
): Promise<JobStatusResponse> {
  const q = new URLSearchParams();
  if (jobIds.report_job_id) q.set("report_job_id", jobIds.report_job_id);
  if (jobIds.dots_job_id) q.set("dots_job_id", jobIds.dots_job_id);
  if (jobIds.skeleton_job_id) q.set("skeleton_job_id", jobIds.skeleton_job_id);
  q.set("_t", String(Date.now()));
  const url = `${API_BASE}/v1/jobs/${encodeURIComponent(groupId)}?${q.toString()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) {
    const msg = detailMessage(data.detail);
    return {
      ok: false,
      group_id: groupId,
      overall_pct: 0,
      complete: false,
      outcome: "rejected",
      terminal: true,
      message: msg,
      status: {
        dots: "-",
        skeleton: "-",
        report: "Rejected — video did not meet recording conditions",
      },
      results: {
        dots_video: { ready: false, s3_key: null, url: null },
        skeleton_video: { ready: false, s3_key: null, url: null },
        report_en_pdf: { ready: false, s3_key: null, url: null },
        report_th_pdf: { ready: false, s3_key: null, url: null },
      },
    };
  }
  if (!res.ok) throw new Error(detailMessage(data.detail) || `HTTP ${res.status}`);
  return data as JobStatusResponse;
}

export { API_BASE };

const STORAGE_KEY = "apr_mobile_last_job";

export function saveLastJob(groupId: string, jobIds: JobIds): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ group_id: groupId, ...jobIds }));
  } catch {
    /* ignore */
  }
}

export function loadLastJob(): (JobIds & { group_id: string }) | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { group_id?: string } & JobIds;
    if (!parsed.group_id) return null;
    return parsed as JobIds & { group_id: string };
  } catch {
    return null;
  }
}

export function clearLastJob(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
