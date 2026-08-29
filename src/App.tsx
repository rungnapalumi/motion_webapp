import { FormEvent, useEffect, useRef, useState } from "react";
import {
  API_BASE,
  Artifact,
  JobIds,
  JobStatusResponse,
  clearLastJob,
  createJob,
  getJobStatus,
  loadLastJob,
  saveLastJob,
} from "./api";

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

const RESULT_LABELS: { key: keyof JobStatusResponse["results"]; label: string }[] = [
  { key: "skeleton_video", label: "Skeleton video" },
  { key: "report_en_pdf", label: "English PDF" },
];

function isTerminalStatus(data: JobStatusResponse): boolean {
  return Boolean(
    data.complete ||
      data.terminal ||
      data.outcome === "rejected" ||
      data.outcome === "failed",
  );
}

function statusMessage(data: JobStatusResponse): string {
  if (data.message && isTerminalStatus(data)) return data.message;
  const st = data.status;
  return `Group: ${data.group_id}\nProgress: ${data.overall_pct}%\nSkeleton: ${st.skeleton}\nReport: ${st.report}`;
}

function readyLinks(results: JobStatusResponse["results"] | null) {
  if (!results) return [] as { label: string; url: string }[];
  return RESULT_LABELS.flatMap(({ key, label }) => {
    const item: Artifact = results[key];
    if (item?.ready && item.url) return [{ label, url: item.url }];
    return [];
  });
}

export default function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [groupId, setGroupId] = useState("");
  const [jobIds, setJobIds] = useState<JobIds>({});
  const [pct, setPct] = useState(0);
  const [results, setResults] = useState<JobStatusResponse["results"] | null>(null);
  const pollRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const groupIdRef = useRef(groupId);
  const jobIdsRef = useRef(jobIds);
  const phaseRef = useRef(phase);
  groupIdRef.current = groupId;
  jobIdsRef.current = jobIds;
  phaseRef.current = phase;

  const stopPoll = () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const applyStatus = (data: JobStatusResponse) => {
    setPct(data.overall_pct);
    const rejected =
      data.outcome === "rejected" || data.outcome === "failed" || Boolean(data.terminal && !data.complete);
    setResults(rejected ? null : data.results);
    if (data.complete) {
      setPhase("done");
      stopPoll();
      setMessage(statusMessage(data));
    } else if (isTerminalStatus(data)) {
      setPhase("error");
      stopPoll();
      setMessage(statusMessage(data));
    } else {
      setPhase("processing");
      setMessage(statusMessage(data));
    }
  };
  const applyStatusRef = useRef(applyStatus);
  applyStatusRef.current = applyStatus;

  const startPolling = (gid: string, ids: JobIds) => {
    stopPoll();
    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const data = await getJobStatus(gid, ids);
        applyStatusRef.current(data);
      } catch (err) {
        setPhase("error");
        setMessage(err instanceof Error ? err.message : String(err));
        stopPoll();
      } finally {
        inFlightRef.current = false;
      }
    };
    void tick();
    pollRef.current = window.setInterval(() => {
      if (phaseRef.current === "processing") void tick();
    }, 8000);
  };

  useEffect(() => {
    const last = loadLastJob();
    if (!last?.group_id) return;
    setGroupId(last.group_id);
    const ids: JobIds = {
      dots_job_id: last.dots_job_id,
      skeleton_job_id: last.skeleton_job_id,
      report_job_id: last.report_job_id,
    };
    setJobIds(ids);
    setPhase("processing");
    setMessage("Resuming last job…");
    startPolling(last.group_id, ids);
    return () => stopPoll();
  }, []);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      if (phaseRef.current !== "processing") return;
      const gid = groupIdRef.current;
      if (!gid) return;
      void getJobStatus(gid, jobIdsRef.current)
        .then((data) => applyStatusRef.current(data))
        .catch((err) => {
          setPhase("error");
          setMessage(err instanceof Error ? err.message : String(err));
          stopPoll();
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
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!video) {
      setPhase("error");
      setMessage("Please choose a video file.");
      return;
    }
    stopPoll();
    setResults(null);
    setPct(0);
    setPhase("uploading");
    setMessage("Uploading and queuing jobs…");

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("email", email.trim());
    fd.append("gender", "auto");
    fd.append("video", video);

    try {
      const created = await createJob(fd);
      const ids: JobIds = {
        dots_job_id: created.dots_job_id,
        skeleton_job_id: created.skeleton_job_id,
        report_job_id: created.report_job_id,
      };
      setGroupId(created.group_id);
      setJobIds(ids);
      saveLastJob(created.group_id, ids);
      setPhase("processing");
      setMessage(`Queued. Group ID: ${created.group_id}\nPolling status…`);
      startPolling(created.group_id, ids);
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const onClear = () => {
    stopPoll();
    clearLastJob();
    setGroupId("");
    setJobIds({});
    setResults(null);
    setPct(0);
    setPhase("idle");
    setMessage("");
    setVideo(null);
  };

  const busy = phase === "uploading" || phase === "processing";
  const links = readyLinks(results);
  const statusClass =
    phase === "done" ? "ok" : phase === "error" ? "err" : "";

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
          Your analyzed video and report in PDF format will be ready for download in 1-2 minutes.
          Both will also be sent to the email provided.
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
            Recommended video size 480 x 854 in MP4 or MOV. Higher resolution may result in delay
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
          <li>Your video should be at least 90 seconds.</li>
        </ul>
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
            disabled={busy}
          />

          <label htmlFor="email">Email (results will be sent here)</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />

          <label htmlFor="video">Video (mp4/mov, max 100 MB)</label>
          <label className="file-box" htmlFor="video">
            <input
              id="video"
              type="file"
              accept="video/*,.mp4,.mov,.m4v"
              required={!groupId}
              disabled={busy}
              onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
            />
            {video ? <span className="file-name">{video.name}</span> : null}
          </label>

          <button className="primary" type="submit" disabled={busy}>
            {phase === "uploading"
              ? "Uploading…"
              : phase === "processing"
                ? "Processing…"
                : "Start analysis"}
          </button>
        </form>

        {(phase !== "idle" || pct > 0) && (
          <div className="progress" aria-hidden>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}

        {message ? <div className={`status ${statusClass}`}>{message}</div> : null}

        {links.length > 0 ? (
          <div className="downloads">
            {links.map((item) => (
              <a key={item.label} href={item.url} target="_blank" rel="noopener noreferrer">
                Download {item.label}
              </a>
            ))}
          </div>
        ) : null}

        {(groupId || phase === "done" || phase === "error") && (
          <button className="ghost" type="button" onClick={onClear} disabled={phase === "uploading"}>
            Clear and start new
          </button>
        )}
      </div>

      <p className="meta">
        API: <a href={API_BASE}>{API_BASE}</a>
        {jobIds.report_job_id ? ` · report ${jobIds.report_job_id}` : null}
      </p>
    </div>
  );
}
