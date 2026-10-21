import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Artifact,
  JobIds,
  JobStatusResponse,
  QueueEntry,
  QueueStage,
  TrackedJob,
  addTrackedJob,
  clearAllTrackedJobs,
  createJobViaS3,
  getJobStatus,
  getQueueStatus,
  loadTrackedJobs,
  migrateOldJob,
  pruneOldFinishedJobs,
  removeTrackedJob,
} from "./api";
import { AuthUser, consumeUpload, fetchSession, login, logout } from "./auth";

type JobPhase = "uploading" | "processing" | "done" | "error";

type JobState = {
  group_id: string;
  name: string;
  email: string;
  created_at: number;
  phase: JobPhase;
  message: string;
  jobIds: JobIds;
  results: JobStatusResponse["results"] | null;
  pollInterval: number | null;
  abortController: AbortController | null;
  inFlight: boolean;
};

/** Partner accounts that get report + skeleton only (no dots video). */
const NO_DOTS_USERNAMES = new Set(["aipeoplereader10"]);

function accountIncludesDots(username: string | undefined | null): boolean {
  return !NO_DOTS_USERNAMES.has((username || "").trim().toLowerCase());
}

const RESULT_LABELS: { key: keyof JobStatusResponse["results"]; label: string }[] = [
  { key: "dots_video", label: "Dots video" },
  { key: "skeleton_video", label: "Skeleton video" },
  { key: "report_en_pdf", label: "English PDF" },
  { key: "report_th_pdf", label: "Thai PDF" },
];

function isTerminalStatus(data: JobStatusResponse): boolean {
  return Boolean(
    data.complete ||
      data.terminal ||
      data.outcome === "rejected" ||
      data.outcome === "failed",
  );
}

function statusMessage(data: JobStatusResponse, includeDots: boolean): string {
  if (data.message && isTerminalStatus(data)) return data.message;
  const st = data.status;
  const lines = [`Group: ${data.group_id}`];
  if (includeDots) lines.push(`Dots: ${st.dots || "-"}`);
  lines.push(`Skeleton: ${st.skeleton}`, `Report: ${st.report}`);
  return lines.join("\n");
}

function readyLinks(
  results: JobStatusResponse["results"] | null,
  includeDots: boolean,
) {
  if (!results) return [] as { label: string; url: string }[];
  return RESULT_LABELS.flatMap(({ key, label }) => {
    if (key === "dots_video" && !includeDots) return [];
    const item: Artifact = results[key];
    if (item?.ready && item.url) return [{ label, url: item.url }];
    return [];
  });
}


const STAGE_ORDER: { key: keyof QueueEntry["stages"]; label: string }[] = [
  { key: "report", label: "Report" },
  { key: "skeleton", label: "Skeleton" },
  { key: "dots", label: "Dots" },
];

function stageLabel(stage: QueueStage | undefined): string {
  switch (stage) {
    case "processing":
      return "in progress";
    case "waiting":
      return "waiting";
    case "ready":
      return "ready";
    default:
      return "—";
  }
}

export default function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueError, setQueueError] = useState("");
  const [queueUpdatedAt, setQueueUpdatedAt] = useState("");
  const [jobs, setJobs] = useState<Map<string, JobState>>(new Map());
  const queuePollRef = useRef<number | null>(null);
  const includeDots = accountIncludesDots(auth?.username);

  const stopQueuePoll = () => {
    if (queuePollRef.current != null) {
      window.clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
  };

  const refreshQueue = async () => {
    try {
      const data = await getQueueStatus();
      setQueue(data.queue || []);
      setQueueUpdatedAt(data.updated_at || "");
      setQueueError("");
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    }
  };

  const startQueuePolling = () => {
    stopQueuePoll();
    void refreshQueue();
    queuePollRef.current = window.setInterval(() => {
      void refreshQueue();
    }, 10000);
  };

  const stopJobPolling = (groupId: string) => {
    setJobs((prev) => {
      const job = prev.get(groupId);
      if (!job) return prev;
      if (job.pollInterval != null) {
        window.clearInterval(job.pollInterval);
      }
      if (job.abortController) {
        job.abortController.abort();
      }
      const next = new Map(prev);
      next.set(groupId, {
        ...job,
        pollInterval: null,
        abortController: null,
        inFlight: false,
      });
      return next;
    });
  };

  const updateJobState = (groupId: string, updates: Partial<JobState>) => {
    setJobs((prev) => {
      const job = prev.get(groupId);
      if (!job) return prev;
      const next = new Map(prev);
      next.set(groupId, { ...job, ...updates });
      return next;
    });
  };

  const pollJobStatus = async (groupId: string) => {
    setJobs((prev) => {
      const job = prev.get(groupId);
      if (!job || job.inFlight) return prev;
      const controller = new AbortController();
      const next = new Map(prev);
      next.set(groupId, { ...job, inFlight: true, abortController: controller });
      return next;
    });

    const currentJob = jobs.get(groupId);
    if (!currentJob) return;

    try {
      const data = await getJobStatus(groupId, currentJob.jobIds, 15000);
      setJobs((prev) => {
        const job = prev.get(groupId);
        if (!job) return prev;

        const rejected =
          data.outcome === "rejected" ||
          data.outcome === "failed" ||
          Boolean(data.terminal && !data.complete);
        const results = rejected ? null : data.results;
        const msg = statusMessage(data, includeDots);

        let phase: JobPhase;
        if (data.complete) {
          phase = "done";
        } else if (isTerminalStatus(data)) {
          phase = "error";
        } else {
          phase = "processing";
        }

        const shouldStop = phase === "done" || phase === "error";
        if (shouldStop && job.pollInterval != null) {
          window.clearInterval(job.pollInterval);
        }

        const next = new Map(prev);
        next.set(groupId, {
          ...job,
          phase,
          message: msg,
          results,
          pollInterval: shouldStop ? null : job.pollInterval,
          abortController: null,
          inFlight: false,
        });
        return next;
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Timeout or manual abort, retry next interval
        setJobs((prev) => {
          const job = prev.get(groupId);
          if (!job) return prev;
          const next = new Map(prev);
          next.set(groupId, { ...job, abortController: null, inFlight: false });
          return next;
        });
      } else {
        // Network or other error
        setJobs((prev) => {
          const job = prev.get(groupId);
          if (!job) return prev;
          const next = new Map(prev);
          next.set(groupId, {
            ...job,
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
            abortController: null,
            inFlight: false,
            pollInterval: null,
          });
          return next;
        });
        if (currentJob.pollInterval != null) {
          window.clearInterval(currentJob.pollInterval);
        }
      }
    }
  };

  const startJobPolling = (groupId: string) => {
    stopJobPolling(groupId);
    void pollJobStatus(groupId);
    const intervalId = window.setInterval(() => {
      void pollJobStatus(groupId);
    }, 8000);
    updateJobState(groupId, { pollInterval: intervalId });
  };

  useEffect(() => {
    void fetchSession()
      .then((user) => setAuth(user))
      .catch(() => setAuth(null))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authReady || !auth) return;
    migrateOldJob();
    const tracked = loadTrackedJobs();
    const newJobs = new Map<string, JobState>();
    for (const t of tracked) {
      newJobs.set(t.group_id, {
        group_id: t.group_id,
        name: t.name,
        email: t.email,
        created_at: t.created_at,
        phase: "processing",
        message: "Resuming job…",
        jobIds: {
          dots_job_id: t.dots_job_id,
          skeleton_job_id: t.skeleton_job_id,
          report_job_id: t.report_job_id,
        },
        results: null,
        pollInterval: null,
        abortController: null,
        inFlight: false,
      });
    }
    setJobs(newJobs);
    return () => {
      newJobs.forEach((job) => {
        if (job.pollInterval != null) window.clearInterval(job.pollInterval);
        if (job.abortController) job.abortController.abort();
      });
    };
  }, [authReady, auth?.username]);

  useEffect(() => {
    jobs.forEach((job) => {
      if (job.phase === "processing" && job.pollInterval == null) {
        startJobPolling(job.group_id);
      }
    });
  }, [jobs]);

  useEffect(() => {
    if (!authReady || !auth) {
      stopQueuePoll();
      setQueue([]);
      setQueueError("");
      setQueueUpdatedAt("");
      return;
    }
    startQueuePolling();
    return () => stopQueuePoll();
  }, [authReady, auth?.username]);

  useEffect(() => {
    const finishedGroupIds = new Set<string>();
    jobs.forEach((job) => {
      if (job.phase === "done" || job.phase === "error") {
        finishedGroupIds.add(job.group_id);
      }
    });
    if (finishedGroupIds.size > 0) {
      pruneOldFinishedJobs(finishedGroupIds);
    }
  }, [jobs]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      jobs.forEach((job) => {
        if (job.phase === "processing" && !job.inFlight) {
          void pollJobStatus(job.group_id);
        }
      });
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
    };
  }, [jobs]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) {
      return;
    }
    if (auth.remaining <= 0) {
      return;
    }
    if (!video) {
      return;
    }
    setUploading(true);

    const tempGroupId = `temp-${Date.now()}`;
    const newJob: JobState = {
      group_id: tempGroupId,
      name: name.trim(),
      email: email.trim(),
      created_at: Date.now(),
      phase: "uploading",
      message: "Preparing direct upload…",
      jobIds: {},
      results: null,
      pollInterval: null,
      abortController: null,
      inFlight: false,
    };
    setJobs((prev) => new Map(prev).set(tempGroupId, newJob));

    try {
      const created = await createJobViaS3({
        video,
        name: name.trim(),
        email: email.trim(),
        languages: "en,th",
        gender: "auto",
        includeDots: accountIncludesDots(auth.username),
        onPhase: (phase) => {
          let msg = "";
          if (phase === "presign") msg = "Preparing direct upload…";
          else if (phase === "uploading") msg = "Uploading video to storage…";
          else if (phase === "enqueueing") msg = "Queuing analysis jobs…";
          setJobs((prev) => {
            const job = prev.get(tempGroupId);
            if (!job) return prev;
            const next = new Map(prev);
            next.set(tempGroupId, { ...job, message: msg });
            return next;
          });
        },
      });

      const ids: JobIds = {
        dots_job_id: created.dots_job_id || undefined,
        skeleton_job_id: created.skeleton_job_id,
        report_job_id: created.report_job_id,
      };

      try {
        setAuth(await consumeUpload());
      } catch {
        /* job is already queued; remaining will refresh on next login */
      }

      const trackedJob: TrackedJob = {
        group_id: created.group_id,
        name: name.trim(),
        email: email.trim(),
        created_at: Date.now(),
        dots_job_id: ids.dots_job_id,
        skeleton_job_id: ids.skeleton_job_id,
        report_job_id: ids.report_job_id,
      };
      addTrackedJob(trackedJob);

      setJobs((prev) => {
        const next = new Map(prev);
        next.delete(tempGroupId);
        next.set(created.group_id, {
          group_id: created.group_id,
          name: name.trim(),
          email: email.trim(),
          created_at: Date.now(),
          phase: "processing",
          message: `Queued. Group ID: ${created.group_id}\nPolling status…`,
          jobIds: ids,
          results: null,
          pollInterval: null,
          abortController: null,
          inFlight: false,
        });
        return next;
      });

      setName("");
      setEmail("");
      setVideo(null);
      setUploading(false);
    } catch (err) {
      setJobs((prev) => {
        const next = new Map(prev);
        next.set(tempGroupId, {
          ...newJob,
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return next;
      });
      setUploading(false);
    }
  };

  const onClear = () => {
    setName("");
    setEmail("");
    setVideo(null);
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const user = await login(username.trim(), password);
      setAuth(user);
      setPassword("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const onLogout = async () => {
    jobs.forEach((job) => {
      if (job.pollInterval != null) window.clearInterval(job.pollInterval);
      if (job.abortController) job.abortController.abort();
    });
    await logout();
    setAuth(null);
    setPassword("");
    setJobs(new Map());
    clearAllTrackedJobs();
    onClear();
  };

  const jobsList = Array.from(jobs.values()).sort((a, b) => b.created_at - a.created_at);
  const remaining = auth?.remaining ?? 0;
  const noQuota = Boolean(auth && remaining <= 0);
  const formLocked = uploading || !auth || noQuota;

  return (
    <div className="app">
      <header className="hero">
        <img
          className="logo"
          src="/brand-logo.png"
          alt="AI People Reader — Presenter Analysis"
          width={512}
          height={512}
        />
        <div className="brand-line" aria-hidden="true" />
        <h1 className="sr-only">AI Presenter Analysis</h1>
        <p className="sub">
          {includeDots
            ? "Your dots video, skeleton video, and PDF reports will be ready for download in 1-2 minutes. They will also be sent to the email provided."
            : "Your skeleton video and PDF reports will be ready for download in 1-2 minutes. They will also be sent to the email provided."}
        </p>
      </header>

      <section className="panel guidelines" aria-labelledby="recording-guidelines-title">
        <h2 id="recording-guidelines-title">Recording Guidelines</h2>
        <ul>
          <li>
            Record the video in portrait. Stand in front of a plain colored wall and make sure you
            are visible from head to toe.
          </li>
          <li>
            Recommended video size 480 x 854 in MP4 or MOV. Video should not exceed 200 MB. Higher resolution may result in delay
            in result download.
          </li>
          <li>
            Avoid wearing white, black, large prints, loose clothing or same color as the wall
            behind you.
          </li>
          <li>
            Move and use hand gesture naturally. Remember AI People Reader is analyzing whole body
            movement.
          </li>
        </ul>
      </section>

      <section className="panel guidelines" aria-labelledby="presentation-objectives-title">
        <h2 id="presentation-objectives-title">Presentation Objectives</h2>
        <ol>
          <li>
            If you want to see how you present and how others experience you, use a speech you
            already have.
          </li>
          <li>
            If you want to rehearse and see how engaging you are, try a presentation that is about
            sharing information, introducing a new concept or getting a point across to your team.
          </li>
          <li>
            If you want to see how confident and authoritative you come across, try use a speech
            where you need to convince or give instructions with firmness.
          </li>
        </ol>
      </section>

      <section className="panel login" aria-labelledby="partner-login-title">
        <h2 id="partner-login-title">Partner Login</h2>
        {auth ? (
          <div className="login-session">
            <p className="login-user">
              Signed in as <strong>{auth.username}</strong>
            </p>
            <div className={`quota${noQuota ? " empty" : ""}`}>
              <span className="quota-label">Videos remaining</span>
              <strong className="quota-count">
                {remaining} / {auth.quota}
              </strong>
            </div>
            {noQuota ? (
              <p className="login-note">This username has used all {auth.quota} uploads.</p>
            ) : (
              <p className="login-note">
                Each analysis uses 1 of the {auth.quota} uploads for this username.
              </p>
            )}
            <button className="ghost" type="button" onClick={() => void onLogout()} disabled={uploading}>
              Log out
            </button>
          </div>
        ) : (
          <form onSubmit={onLogin}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="aipeoplereader01"
              disabled={authBusy || !authReady}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              disabled={authBusy || !authReady}
            />
            <button className="primary" type="submit" disabled={authBusy || !authReady}>
              {authBusy ? "Signing in…" : "Log in"}
            </button>
            {authError ? <div className="status err">{authError}</div> : null}
          </form>
        )}
      </section>

      <div className="panel card">
        <form onSubmit={onSubmit}>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={formLocked}
          />

          <label htmlFor="email">Email (results will be sent here)</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={formLocked}
          />

          <label htmlFor="video">Video (mp4/mov, max 200 MB)</label>
          <label className="file-box" htmlFor="video">
            <input
              id="video"
              type="file"
              accept="video/*,.mp4,.mov,.m4v"
              required
              disabled={formLocked}
              onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
            />
            {video ? <span className="file-name">{video.name}</span> : null}
          </label>

          <button className="primary" type="submit" disabled={formLocked}>
            {!auth
              ? "Log in to start analysis"
              : noQuota
                ? "No uploads remaining"
                : uploading
                  ? "Uploading…"
                  : "Start analysis"}
          </button>
        </form>

        {(name || email || video) && (
          <button className="ghost" type="button" onClick={onClear} disabled={uploading}>
            Clear form
          </button>
        )}
      </div>

      {jobsList.length > 0 && (
        <section className="panel" aria-labelledby="jobs-title">
          <h2 id="jobs-title">Your Jobs</h2>
          {jobsList.map((job) => {
            const links = readyLinks(job.results, includeDots);
            const statusClass =
              job.phase === "done" ? "ok" : job.phase === "error" ? "err" : "";
            const myQueueEntry = queue.find((item) => item.group_id === job.group_id);
            return (
              <div key={job.group_id} className="job-item">
                <div className="job-header">
                  <strong>{job.name || "Unnamed"}</strong>
                  {" · "}
                  <span className="job-meta">
                    {new Date(job.created_at).toLocaleString()}
                  </span>
                </div>
                {job.message ? (
                  <div className={`status ${statusClass}`}>{job.message}</div>
                ) : null}
                {links.length > 0 ? (
                  <div className="downloads">
                    {links.map((item) => (
                      <a
                        key={item.label}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download {item.label}
                      </a>
                    ))}
                  </div>
                ) : null}
                {myQueueEntry && (
                  <div className="queue-stages">
                    {STAGE_ORDER.map(({ key, label }) => {
                      const stage = myQueueEntry.stages?.[key];
                      if (!stage || stage === "none") return null;
                      return (
                        <span key={key} className={`queue-chip stage-${stage}`}>
                          {label}: {stageLabel(stage)}
                        </span>
                      );
                    })}
                  </div>
                )}
                {(job.phase === "done" || job.phase === "error") && (
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      removeTrackedJob(job.group_id);
                      setJobs((prev) => {
                        const next = new Map(prev);
                        next.delete(job.group_id);
                        return next;
                      });
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="panel queue-board" aria-labelledby="queue-status-title">
        <h2 id="queue-status-title">Your analysis status</h2>
        <p className="queue-lead">
          Shows only your job status and your place in the queue.
        </p>
        {!auth ? (
          <p className="queue-empty">Log in to view your status.</p>
        ) : jobsList.length === 0 ? (
          <p className="queue-empty">Start an analysis to see your status here.</p>
        ) : (
          <>
            {jobsList.map((job) => {
              const myQueueIndex = queue.findIndex(
                (item) => item.group_id === job.group_id,
              );
              const myQueueEntry = myQueueIndex >= 0 ? queue[myQueueIndex] : null;
              
              let myQueuePosition: number | null = null;
              let queueWaitingCount: number | null = null;
              
              if (myQueueEntry) {
                if (myQueueEntry.waiting_position != null && myQueueEntry.waiting_count != null) {
                  myQueuePosition = myQueueEntry.waiting_position;
                  queueWaitingCount = myQueueEntry.waiting_count;
                } else {
                  const nonProcessingAhead = queue
                    .slice(0, myQueueIndex)
                    .filter(item => !item.is_processing).length;
                  myQueuePosition = nonProcessingAhead + 1;
                  queueWaitingCount = queue.filter(item => !item.is_processing).length;
                }
              }

              return (
                <div key={job.group_id} className="queue-mine">
                  {myQueueEntry ? (
                    <>
                      <p className="queue-position">
                        <strong>{job.name || "Unnamed"}</strong>
                        {" · "}
                        {myQueueEntry.is_processing
                          ? "Being processed now"
                          : `You are #${myQueuePosition} in the queue`}
                        {queueWaitingCount != null && queueWaitingCount > 1 ? ` · ${queueWaitingCount} in queue` : ""}
                      </p>
                      <p className="queue-summary">
                        {myQueueEntry.summary_th || myQueueEntry.summary}
                      </p>
                      <div className="queue-stages">
                        {STAGE_ORDER.map(({ key, label }) => {
                          const stage = myQueueEntry.stages?.[key];
                          if (!stage || stage === "none") return null;
                          return (
                            <span key={key} className={`queue-chip stage-${stage}`}>
                              {label}: {stageLabel(stage)}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  ) : job.phase === "uploading" || job.phase === "processing" ? (
                    <p className="queue-empty">
                      <strong>{job.name || "Unnamed"}</strong> · Starting…
                    </p>
                  ) : job.phase === "done" ? (
                    <p className="queue-empty">
                      <strong>{job.name || "Unnamed"}</strong> · Analysis is
                      complete.
                    </p>
                  ) : job.phase === "error" ? (
                    <p className="queue-empty">
                      <strong>{job.name || "Unnamed"}</strong> · Analysis stopped.
                      Check the status message above.
                    </p>
                  ) : null}
                </div>
              );
            })}
            {queueError ? <p className="queue-error">{queueError}</p> : null}
            {queueUpdatedAt ? (
              <p className="queue-meta">
                Updated {new Date(queueUpdatedAt).toLocaleTimeString()}
              </p>
            ) : null}
          </>
        )}
      </section>

    </div>
  );
}