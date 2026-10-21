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

export type PresignResponse = {
  ok: boolean;
  group_id: string;
  input_key: string;
  upload_url: string;
  content_type: string;
  expires_in: number;
  max_bytes: number;
  languages?: string[];
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

export type QueueStage = "processing" | "waiting" | "ready" | "none";

export type QueueEntry = {
  group_id: string;
  name: string;
  created_at?: string;
  summary: string;
  summary_th?: string;
  stages: {
    report?: QueueStage;
    skeleton?: QueueStage;
    dots?: QueueStage;
  };
  is_processing?: boolean;
  waiting_position?: number;
  waiting_count?: number;
  processing_count?: number;
};

export type QueueNowWorking = {
  group_id: string;
  name: string;
  mode: string;
  summary: string;
  summary_th?: string;
};

export type QueueResponse = {
  ok: boolean;
  updated_at?: string;
  active_groups?: number;
  now_working: QueueNowWorking[];
  queue: QueueEntry[];
};

export type UploadProgress = {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  speed?: number;
  timeRemaining?: number;
};

export type CreateJobViaS3Params = {
  video: File;
  name: string;
  email: string;
  languages?: string;
  gender?: string;
  /** When false, enqueue report + skeleton only (no dots job). */
  includeDots?: boolean;
  onPhase?: (phase: "presign" | "uploading" | "enqueueing", detail?: string) => void;
  onProgress?: (progress: UploadProgress) => void;
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

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Upload a file to a URL using XMLHttpRequest to track progress.
 */
function uploadWithProgress(
  url: string,
  data: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded, e.total);
        }
      });
    }
    
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    });
    
    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed (network error)"));
    });
    
    xhr.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });
    
    xhr.send(data);
  });
}

/**
 * Upload a part to S3 and return its ETag.
 */
function uploadPart(
  url: string,
  data: Blob,
  onProgress?: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded);
        }
      });
    }
    
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) {
          reject(new Error("No ETag in response"));
        } else {
          resolve(etag.replace(/"/g, ""));
        }
      } else {
        reject(new Error(`Part upload failed (HTTP ${xhr.status})`));
      }
    });
    
    xhr.addEventListener("error", () => {
      reject(new Error("Part upload failed (network error)"));
    });
    
    xhr.addEventListener("abort", () => {
      reject(new Error("Part upload aborted"));
    });
    
    xhr.send(data);
  });
}

/**
 * Upload large file using multipart upload with parallel parts.
 */
async function multipartUpload(
  video: File,
  name: string,
  email: string,
  languages: string,
  partSizeBytes: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ groupId: string; inputKey: string }> {
  const createFd = new FormData();
  createFd.append("name", name);
  createFd.append("email", email);
  createFd.append("filename", video.name || "input.mp4");
  createFd.append("content_type", video.type || "video/mp4");
  createFd.append("size_bytes", String(video.size));
  createFd.append("languages", languages);
  createFd.append("part_size_bytes", String(partSizeBytes));
  
  const createRes = await fetch(`${API_BASE}/v1/jobs/multipart/create`, {
    method: "POST",
    body: createFd,
  });
  
  if (createRes.status === 404) {
    throw new Error("MULTIPART_NOT_AVAILABLE");
  }
  
  const createData = await readJson(createRes);
  if (!createRes.ok) {
    throw new Error(detailMessage(createData.detail) || `Multipart create failed (HTTP ${createRes.status})`);
  }
  
  const groupId = String(createData.group_id || "");
  const inputKey = String(createData.input_key || "");
  const uploadId = String(createData.upload_id || "");
  const parts = (createData.parts || []) as Array<{ part_number: number; url: string }>;
  
  if (!groupId || !inputKey || !uploadId || parts.length === 0) {
    throw new Error("Multipart create response missing required fields");
  }
  
  const CONCURRENT_UPLOADS = 4;
  const MAX_RETRIES = 3;
  const uploadedParts: Array<{ part_number: number; etag: string }> = [];
  const partProgress: Map<number, number> = new Map();
  let totalUploaded = 0;
  
  const updateProgress = () => {
    if (onProgress) {
      onProgress(totalUploaded, video.size);
    }
  };
  
  const uploadPartWithRetry = async (partNum: number, url: string, start: number, end: number) => {
    const blob = video.slice(start, end);
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const etag = await uploadPart(url, blob, (loaded) => {
          const prevProgress = partProgress.get(partNum) || 0;
          const delta = loaded - prevProgress;
          partProgress.set(partNum, loaded);
          totalUploaded += delta;
          updateProgress();
        });
        return { part_number: partNum, etag };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error(`Part ${partNum} failed`);
  };
  
  try {
    const partSize = Math.ceil(partSizeBytes);
    const queue: Array<() => Promise<void>> = [];
    
    for (const part of parts) {
      const start = (part.part_number - 1) * partSize;
      const end = Math.min(start + partSize, video.size);
      queue.push(async () => {
        const result = await uploadPartWithRetry(part.part_number, part.url, start, end);
        uploadedParts.push(result);
      });
    }
    
    const runningUploads: Array<Promise<void>> = [];
    for (const task of queue) {
      const promise = task();
      runningUploads.push(promise);
      
      if (runningUploads.length >= CONCURRENT_UPLOADS) {
        await Promise.race(runningUploads);
        runningUploads.splice(
          runningUploads.findIndex((p) => p === promise),
          1,
        );
      }
    }
    
    await Promise.all(runningUploads);
    
    uploadedParts.sort((a, b) => a.part_number - b.part_number);
    
    const completeFd = new FormData();
    completeFd.append("group_id", groupId);
    completeFd.append("input_key", inputKey);
    completeFd.append("upload_id", uploadId);
    completeFd.append("parts", JSON.stringify(uploadedParts));
    
    const completeRes = await fetch(`${API_BASE}/v1/jobs/multipart/complete`, {
      method: "POST",
      body: completeFd,
    });
    
    if (!completeRes.ok) {
      const completeData = await readJson(completeRes);
      throw new Error(detailMessage(completeData.detail) || `Multipart complete failed (HTTP ${completeRes.status})`);
    }
    
    return { groupId, inputKey };
  } catch (err) {
    const abortFd = new FormData();
    abortFd.append("group_id", groupId);
    abortFd.append("input_key", inputKey);
    abortFd.append("upload_id", uploadId);
    
    try {
      await fetch(`${API_BASE}/v1/jobs/multipart/abort`, {
        method: "POST",
        body: abortFd,
      });
    } catch {
      // Ignore abort errors
    }
    
    throw err;
  }
}

/** Legacy path: proxy video through the API (kept for local/debug). */
export async function createJob(form: FormData): Promise<JobCreateResponse> {
  const res = await fetch(`${API_BASE}/v1/jobs`, { method: "POST", body: form });
  const data = await readJson(res);
  if (!res.ok) throw new Error(detailMessage(data.detail) || `HTTP ${res.status}`);
  return data as unknown as JobCreateResponse;
}

/**
 * Browser uploads straight to S3 (presigned PUT), then asks the API to enqueue.
 * Avoids sending large videos through the Render API host.
 */
export async function createJobViaS3(params: CreateJobViaS3Params): Promise<JobCreateResponse> {
  const {
    video,
    name,
    email,
    languages = "en,th",
    gender = "auto",
    includeDots = true,
    onPhase,
    onProgress,
  } = params;
  const sizeBytes = video.size;
  if (sizeBytes <= 0) throw new Error("Video file is empty.");

  const MULTIPART_THRESHOLD = 20 * 1024 * 1024; // 20 MB
  const PART_SIZE = 10 * 1024 * 1024; // 10 MB per part
  
  let groupId: string;
  let inputKey: string;
  
  const progressStart = Date.now();
  
  const reportProgress = (loaded: number, total: number) => {
    const now = Date.now();
    const elapsed = (now - progressStart) / 1000;
    const speed = elapsed > 0 ? loaded / elapsed / (1024 * 1024) : 0;
    const remaining = speed > 0 ? (total - loaded) / (speed * 1024 * 1024) : 0;
    
    onProgress?.({
      percent: Math.round((loaded / total) * 100),
      uploadedBytes: loaded,
      totalBytes: total,
      speed: Math.round(speed * 100) / 100,
      timeRemaining: Math.ceil(remaining),
    });
  };

  onPhase?.("presign");
  
  if (sizeBytes > MULTIPART_THRESHOLD) {
    try {
      onPhase?.("uploading", video.name);
      const result = await multipartUpload(
        video,
        name,
        email,
        languages,
        PART_SIZE,
        reportProgress,
      );
      groupId = result.groupId;
      inputKey = result.inputKey;
    } catch (err) {
      if (err instanceof Error && err.message === "MULTIPART_NOT_AVAILABLE") {
        const presignFd = new FormData();
        presignFd.append("name", name);
        presignFd.append("email", email);
        presignFd.append("filename", video.name || "input.mp4");
        presignFd.append("content_type", video.type || "video/mp4");
        presignFd.append("size_bytes", String(sizeBytes));
        presignFd.append("languages", languages);

        const presignRes = await fetch(`${API_BASE}/v1/jobs/presign`, {
          method: "POST",
          body: presignFd,
        });
        const presignData = await readJson(presignRes);
        if (!presignRes.ok) {
          throw new Error(detailMessage(presignData.detail) || `Presign failed (HTTP ${presignRes.status})`);
        }
        const uploadUrl = String(presignData.upload_url || "");
        inputKey = String(presignData.input_key || "");
        groupId = String(presignData.group_id || "");
        const contentType = String(presignData.content_type || video.type || "video/mp4");
        const maxBytes = Number(presignData.max_bytes || 0);
        if (!uploadUrl || !inputKey || !groupId) {
          throw new Error("Presign response missing upload_url / input_key / group_id");
        }
        if (maxBytes > 0 && sizeBytes > maxBytes) {
          const mb = Math.round(maxBytes / (1024 * 1024));
          throw new Error(`Video exceeds ${mb} MB limit`);
        }

        onPhase?.("uploading", video.name);
        await uploadWithProgress(uploadUrl, video, contentType, reportProgress);
      } else {
        throw err;
      }
    }
  } else {
    const presignFd = new FormData();
    presignFd.append("name", name);
    presignFd.append("email", email);
    presignFd.append("filename", video.name || "input.mp4");
    presignFd.append("content_type", video.type || "video/mp4");
    presignFd.append("size_bytes", String(sizeBytes));
    presignFd.append("languages", languages);

    const presignRes = await fetch(`${API_BASE}/v1/jobs/presign`, {
      method: "POST",
      body: presignFd,
    });
    const presignData = await readJson(presignRes);
    if (!presignRes.ok) {
      throw new Error(detailMessage(presignData.detail) || `Presign failed (HTTP ${presignRes.status})`);
    }
    const uploadUrl = String(presignData.upload_url || "");
    inputKey = String(presignData.input_key || "");
    groupId = String(presignData.group_id || "");
    const contentType = String(presignData.content_type || video.type || "video/mp4");
    const maxBytes = Number(presignData.max_bytes || 0);
    if (!uploadUrl || !inputKey || !groupId) {
      throw new Error("Presign response missing upload_url / input_key / group_id");
    }
    if (maxBytes > 0 && sizeBytes > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`Video exceeds ${mb} MB limit`);
    }

    onPhase?.("uploading", video.name);
    await uploadWithProgress(uploadUrl, video, contentType, reportProgress);
  }

  onPhase?.("enqueueing");
  const enqueueFd = new FormData();
  enqueueFd.append("group_id", groupId);
  enqueueFd.append("input_key", inputKey);
  enqueueFd.append("name", name);
  enqueueFd.append("email", email);
  enqueueFd.append("gender", gender);
  enqueueFd.append("languages", languages);
  enqueueFd.append("filename", video.name || "input.mp4");
  enqueueFd.append("include_dots", includeDots ? "true" : "false");

  const enqueueRes = await fetch(`${API_BASE}/v1/jobs/from-s3`, {
    method: "POST",
    body: enqueueFd,
  });
  const enqueueData = await readJson(enqueueRes);
  if (!enqueueRes.ok) {
    throw new Error(detailMessage(enqueueData.detail) || `Enqueue failed (HTTP ${enqueueRes.status})`);
  }
  return enqueueData as unknown as JobCreateResponse;
}

export async function getQueueStatus(): Promise<QueueResponse> {
  const url = `${API_BASE}/v1/queue?_t=${Date.now()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(detailMessage(data.detail) || `HTTP ${res.status}`);
  }
  return {
    ok: Boolean(data.ok ?? true),
    updated_at: typeof data.updated_at === "string" ? data.updated_at : undefined,
    active_groups: typeof data.active_groups === "number" ? data.active_groups : undefined,
    now_working: Array.isArray(data.now_working)
      ? (data.now_working as QueueNowWorking[])
      : [],
    queue: Array.isArray(data.queue) ? (data.queue as QueueEntry[]) : [],
  };
}

export async function getJobStatus(
  groupId: string,
  jobIds: JobIds = {},
  timeoutMs = 15000,
): Promise<JobStatusResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const q = new URLSearchParams();
    if (jobIds.report_job_id) q.set("report_job_id", jobIds.report_job_id);
    if (jobIds.dots_job_id) q.set("dots_job_id", jobIds.dots_job_id);
    if (jobIds.skeleton_job_id) q.set("skeleton_job_id", jobIds.skeleton_job_id);
    q.set("_t", String(Date.now()));
    const url = `${API_BASE}/v1/jobs/${encodeURIComponent(groupId)}?${q.toString()}`;
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    const data = await readJson(res);
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
    return data as unknown as JobStatusResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { API_BASE };

const STORAGE_KEY = "apr_mobile_last_job";
const TRACKED_JOBS_KEY = "apr_mobile_tracked_jobs";

export type TrackedJob = {
  group_id: string;
  name: string;
  email: string;
  created_at: number;
  dots_job_id?: string;
  skeleton_job_id?: string;
  report_job_id?: string;
};

export function migrateOldJob(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { group_id?: string } & JobIds;
    if (parsed.group_id) {
      const jobs = loadTrackedJobs();
      if (!jobs.some((j) => j.group_id === parsed.group_id)) {
        jobs.push({
          group_id: parsed.group_id,
          name: "Migrated job",
          email: "",
          created_at: Date.now(),
          dots_job_id: parsed.dots_job_id,
          skeleton_job_id: parsed.skeleton_job_id,
          report_job_id: parsed.report_job_id,
        });
        saveTrackedJobs(jobs);
      }
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadTrackedJobs(): TrackedJob[] {
  try {
    const raw = localStorage.getItem(TRACKED_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TrackedJob[];
  } catch {
    return [];
  }
}

export function saveTrackedJobs(jobs: TrackedJob[]): void {
  try {
    localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
  } catch {
    /* ignore */
  }
}

export function addTrackedJob(job: TrackedJob): void {
  const jobs = loadTrackedJobs();
  const existing = jobs.findIndex((j) => j.group_id === job.group_id);
  if (existing >= 0) {
    jobs[existing] = job;
  } else {
    jobs.unshift(job);
  }
  saveTrackedJobs(jobs);
}

export function removeTrackedJob(groupId: string): void {
  const jobs = loadTrackedJobs().filter((j) => j.group_id !== groupId);
  saveTrackedJobs(jobs);
}

export function pruneOldFinishedJobs(
  finishedGroupIds: Set<string>,
  maxAgeMs = 24 * 60 * 60 * 1000,
): void {
  const cutoff = Date.now() - maxAgeMs;
  const jobs = loadTrackedJobs().filter(
    (j) => !finishedGroupIds.has(j.group_id) || j.created_at >= cutoff,
  );
  saveTrackedJobs(jobs);
}

export function clearAllTrackedJobs(): void {
  try {
    localStorage.removeItem(TRACKED_JOBS_KEY);
  } catch {
    /* ignore */
  }
}
