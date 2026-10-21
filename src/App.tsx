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

type Language = "en" | "th";

const TRANSLATIONS = {
  en: {
    siteName: "AI People Reader — Presenter Analysis",
    tagline: "Your dots video, skeleton video, and PDF reports will be ready for download in 1-2 minutes. They will also be sent to the email provided.",
    taglineNoDots: "Your skeleton video and PDF reports will be ready for download in 1-2 minutes. They will also be sent to the email provided.",
    recordingGuidelines: "Recording Guidelines",
    guidePortrait: "Record the video in portrait. Stand in front of a plain colored wall and make sure you are visible from head to toe.",
    guideSize: "Recommended video size 480 x 854 in MP4 or MOV. Video should not exceed 200 MB. Higher resolution may result in delay in result download.",
    guideClothing: "Avoid wearing white, black, large prints, loose clothing or same color as the wall behind you.",
    guideMovement: "Move and use hand gesture naturally. Remember AI People Reader is analyzing whole body movement.",
    presentationObjectives: "Presentation Objectives",
    objectivesSee: "If you want to see how you present and how others experience you, use a speech you already have.",
    objectivesRehear: "If you want to rehearse and see how engaging you are, try a presentation that is about sharing information, introducing a new concept or getting a point across to your team.",
    objectivesConfident: "If you want to see how confident and authoritative you come across, try use a speech where you need to convince or give instructions with firmness.",
    partnerLogin: "Partner Login",
    signedInAs: "Signed in as",
    videosRemaining: "Videos remaining",
    noUploadsRemaining: "This username has used all {quota} uploads.",
    uploadsNote: "Each analysis uses 1 of the {quota} uploads for this username.",
    logOut: "Log out",
    username: "Username",
    password: "Password",
    logIn: "Log in",
    signingIn: "Signing in…",
    name: "Name",
    yourName: "Your name",
    email: "Email (results will be sent here)",
    emailPlaceholder: "you@example.com",
    video: "Video (mp4/mov, max 200 MB)",
    startAnalysis: "Start analysis",
    logInToStart: "Log in to start analysis",
    noUploadsRemainingButton: "No uploads remaining",
    uploading: "Uploading…",
    processing: "Processing…",
    clearAndStartNew: "Clear and start new",
    clearForm: "Clear form",
    yourJobs: "Your Jobs",
    reconnecting: "Reconnecting…",
    download: "Download",
    remove: "Remove",
    yourAnalysisStatus: "Your analysis status",
    statusLead: "Shows only your job status and your place in the queue.",
    logInToView: "Log in to view your status.",
    startAnalysisToSee: "Start an analysis to see your status here.",
    beingProcessedNow: "Being processed now",
    youAreInQueue: "You are #{position} in the queue",
    inQueue: "{count} in queue",
    starting: "Starting…",
    analysisComplete: "Analysis is complete.",
    analysisStopped: "Analysis stopped. Check the status message above.",
    updated: "Updated",
    report: "Report",
    skeleton: "Skeleton",
    dots: "Dots",
    inProgress: "in progress",
    waiting: "waiting",
    ready: "ready",
    dotsVideo: "Dots video",
    skeletonVideo: "Skeleton video",
    englishPdf: "English PDF",
    thaiPdf: "Thai PDF",
    preparingDirectUpload: "Preparing direct upload…",
    uploadingVideoToStorage: "Uploading video to storage…",
    queuingAnalysisJobs: "Queuing analysis jobs…",
    queuedGroupId: "Queued. Group ID: {groupId}\nPolling status…",
    resumingJob: "Resuming job…",
    requestTimedOut: "Request timed out",
    uploadingProgress: "Uploading {percent}% ({uploaded} / {total} MB)",
    uploadSpeed: "{speed} MB/s",
    uploadTimeRemaining: "~{time} remaining",
    compressingVideo: "Compressing video {percent}%",
    compressionComplete: "Compression complete: {originalMB} MB → {compressedMB} MB",
  },
  th: {
    siteName: "AI People Reader — วิเคราะห์ผู้นำเสนอ",
    tagline: "วิดีโอจุด วิดีโอโครงร่าง และรายงาน PDF จะพร้อมดาวน์โหลดภายใน 1-2 นาที และจะถูกส่งไปยังอีเมลที่ระบุด้วย",
    taglineNoDots: "วิดีโอโครงร่างและรายงาน PDF จะพร้อมดาวน์โหลดภายใน 1-2 นาที และจะถูกส่งไปยังอีเมลที่ระบุด้วย",
    recordingGuidelines: "แนวทางการบันทึก",
    guidePortrait: "บันทึกวิดีโอในแนวตั้ง ยืนหน้าผนังสีพื้น และให้มองเห็นตัวคุณตั้งแต่หัวจรดเท้า",
    guideSize: "ขนาดวิดีโอที่แนะนำคือ 480 x 854 ในรูปแบบ MP4 หรือ MOV วิดีโอต้องไม่เกิน 200 MB ความละเอียดสูงอาจทำให้ดาวน์โหลดผลล่าช้า",
    guideClothing: "หลีกเลี่ยงการสวมเสื้อผ้าสีขาว สีดำ ลายใหญ่ เสื้อผ้าหลวม หรือสีเดียวกับผนังด้านหลังคุณ",
    guideMovement: "เคลื่อนไหวและใช้ท่าทางมืออย่างเป็นธรรมชาติ จำไว้ว่า AI People Reader กำลังวิเคราะห์การเคลื่อนไหวของร่างกายทั้งหมด",
    presentationObjectives: "วัตถุประสงค์การนำเสนอ",
    objectivesSee: "หากคุณต้องการดูว่าคุณนำเสนออย่างไรและผู้อื่นมองคุณอย่างไร ให้ใช้สุนทรพจน์ที่คุณมีอยู่แล้ว",
    objectivesRehear: "หากคุณต้องการซ้อมและดูว่าคุณน่าสนใจแค่ไหน ลองนำเสนอที่เกี่ยวกับการแบ่งปันข้อมูล แนะนำแนวคิดใหม่ หรือสื่อสารประเด็นให้ทีมของคุณ",
    objectivesConfident: "หากคุณต้องการดูว่าคุณแสดงความมั่นใจและเป็นผู้นำอย่างไร ลองใช้สุนทรพจน์ที่คุณต้องโน้มน้าวหรือสั่งการอย่างแน่วแน่",
    partnerLogin: "Partner Login (เข้าสู่ระบบพาร์ทเนอร์)",
    signedInAs: "เข้าสู่ระบบในชื่อ",
    videosRemaining: "วิดีโอที่เหลือ",
    noUploadsRemaining: "ชื่อผู้ใช้นี้ใช้การอัปโหลดครบทั้งหมด {quota} ครั้งแล้ว",
    uploadsNote: "การวิเคราะห์แต่ละครั้งใช้ 1 ใน {quota} การอัปโหลดสำหรับชื่อผู้ใช้นี้",
    logOut: "ออกจากระบบ",
    username: "Username (ชื่อผู้ใช้)",
    password: "Password (รหัสผ่าน)",
    logIn: "Log in (เข้าสู่ระบบ)",
    signingIn: "กำลังเข้าสู่ระบบ…",
    name: "ชื่อ",
    yourName: "ชื่อของคุณ",
    email: "อีเมล (ผลลัพธ์จะถูกส่งที่นี่)",
    emailPlaceholder: "you@example.com",
    video: "วิดีโอ (mp4/mov, สูงสุด 200 MB)",
    startAnalysis: "เริ่มวิเคราะห์",
    logInToStart: "Log in to start analysis (เข้าสู่ระบบเพื่อเริ่มวิเคราะห์)",
    noUploadsRemainingButton: "ไม่มีการอัปโหลดที่เหลือ",
    uploading: "กำลังอัปโหลด…",
    processing: "กำลังประมวลผล…",
    clearAndStartNew: "ล้างและเริ่มใหม่",
    clearForm: "ล้างฟอร์ม",
    yourJobs: "งานของคุณ",
    reconnecting: "กำลังเชื่อมต่อใหม่…",
    download: "ดาวน์โหลด",
    remove: "ลบ",
    yourAnalysisStatus: "สถานะการวิเคราะห์ของคุณ",
    statusLead: "แสดงเฉพาะสถานะงานของคุณและตำแหน่งของคุณในคิว",
    logInToView: "เข้าสู่ระบบเพื่อดูสถานะของคุณ",
    startAnalysisToSee: "เริ่มการวิเคราะห์เพื่อดูสถานะที่นี่",
    beingProcessedNow: "กำลังประมวลผลอยู่ตอนนี้",
    youAreInQueue: "คุณอยู่ลำดับที่ #{position} ในคิว",
    inQueue: "{count} ในคิว",
    starting: "กำลังเริ่ม…",
    analysisComplete: "การวิเคราะห์เสร็จสมบูรณ์",
    analysisStopped: "การวิเคราะห์หยุด ตรวจสอบข้อความสถานะด้านบน",
    updated: "อัปเดต",
    report: "รายงาน",
    skeleton: "โครงร่าง",
    dots: "จุด",
    inProgress: "กำลังดำเนินการ",
    waiting: "กำลังรอ",
    ready: "พร้อม",
    dotsVideo: "วิดีโอจุด",
    skeletonVideo: "วิดีโอโครงร่าง",
    englishPdf: "PDF ภาษาอังกฤษ",
    thaiPdf: "PDF ภาษาไทย",
    preparingDirectUpload: "กำลังเตรียมอัปโหลดโดยตรง…",
    uploadingVideoToStorage: "กำลังอัปโหลดวิดีโอไปยังที่เก็บข้อมูล…",
    queuingAnalysisJobs: "กำลังจัดคิวงานวิเคราะห์…",
    queuedGroupId: "จัดคิวแล้ว รหัสกลุ่ม: {groupId}\nกำลังตรวจสอบสถานะ…",
    resumingJob: "กำลังดำเนินการงานต่อ…",
    requestTimedOut: "หมดเวลาคำขอ",
    uploadingProgress: "กำลังอัปโหลด {percent}% ({uploaded} / {total} MB)",
    uploadSpeed: "{speed} MB/s",
    uploadTimeRemaining: "~{time} เหลืออีก",
    compressingVideo: "กำลังย่อขนาดวิดีโอ {percent}%",
    compressionComplete: "ย่อขนาดเสร็จสิ้น: {originalMB} MB → {compressedMB} MB",
  },
};

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
  pollErrorCount: number;
  reconnecting: boolean;
  uploadProgress?: {
    percent: number;
    uploadedBytes: number;
    totalBytes: number;
    speed?: number;
    timeRemaining?: number;
  };
};

/** Partner accounts that get report + skeleton only (no dots video). */
const NO_DOTS_USERNAMES = new Set(["aipeoplereader10"]);

function accountIncludesDots(username: string | undefined | null): boolean {
  return !NO_DOTS_USERNAMES.has((username || "").trim().toLowerCase());
}

function getResultLabels(t: typeof TRANSLATIONS.en): { key: keyof JobStatusResponse["results"]; label: string }[] {
  return [
    { key: "dots_video", label: t.dotsVideo },
    { key: "skeleton_video", label: t.skeletonVideo },
    { key: "report_en_pdf", label: t.englishPdf },
    { key: "report_th_pdf", label: t.thaiPdf },
  ];
}

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
  t: typeof TRANSLATIONS.en,
) {
  if (!results) return [] as { label: string; url: string }[];
  const labels = getResultLabels(t);
  return labels.flatMap(({ key, label }) => {
    if (key === "dots_video" && !includeDots) return [];
    const item: Artifact = results[key];
    if (item?.ready && item.url) return [{ label, url: item.url }];
    return [];
  });
}


function getStageOrder(t: typeof TRANSLATIONS.en): { key: keyof QueueEntry["stages"]; label: string }[] {
  return [
    { key: "report", label: t.report },
    { key: "skeleton", label: t.skeleton },
    { key: "dots", label: t.dots },
  ];
}

function stageLabel(stage: QueueStage | undefined, t: typeof TRANSLATIONS.en): string {
  switch (stage) {
    case "processing":
      return t.inProgress;
    case "waiting":
      return t.waiting;
    case "ready":
      return t.ready;
    default:
      return "—";
  }
}

function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem("apr_language");
    if (saved === "en" || saved === "th") return saved;
  } catch {}
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith("th") ? "th" : "en";
}

function saveLanguage(lang: Language) {
  try {
    localStorage.setItem("apr_language", lang);
  } catch {}
}

export default function App() {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
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
  const t = TRANSLATIONS[language];
  
  const toggleLanguage = () => {
    const newLang: Language = language === "en" ? "th" : "en";
    setLanguage(newLang);
    saveLanguage(newLang);
  };

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
      const data = await getJobStatus(groupId, currentJob.jobIds, 30000);
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
          pollErrorCount: 0,
          reconnecting: false,
        });
        return next;
      });
    } catch (err) {
      const isAbortError = (err as Error).name === "AbortError";
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      setJobs((prev) => {
        const job = prev.get(groupId);
        if (!job) return prev;
        
        const newErrorCount = job.pollErrorCount + 1;
        const FAILURE_THRESHOLD = 3;
        
        if (newErrorCount >= FAILURE_THRESHOLD) {
          if (job.pollInterval != null) {
            window.clearInterval(job.pollInterval);
          }
          const next = new Map(prev);
          next.set(groupId, {
            ...job,
            phase: "error",
            message: isAbortError ? t.requestTimedOut : errorMsg,
            abortController: null,
            inFlight: false,
            pollInterval: null,
            pollErrorCount: newErrorCount,
            reconnecting: false,
          });
          return next;
        }
        
        const next = new Map(prev);
        next.set(groupId, {
          ...job,
          abortController: null,
          inFlight: false,
          pollErrorCount: newErrorCount,
          reconnecting: true,
        });
        return next;
      });
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
    for (const job of tracked) {
      newJobs.set(job.group_id, {
        group_id: job.group_id,
        name: job.name,
        email: job.email,
        created_at: job.created_at,
        phase: "processing",
        message: t.resumingJob,
        jobIds: {
          dots_job_id: job.dots_job_id,
          skeleton_job_id: job.skeleton_job_id,
          report_job_id: job.report_job_id,
        },
        results: null,
        pollInterval: null,
        abortController: null,
        inFlight: false,
        pollErrorCount: 0,
        reconnecting: false,
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
      message: t.preparingDirectUpload,
      jobIds: {},
      results: null,
      pollInterval: null,
      abortController: null,
      inFlight: false,
      pollErrorCount: 0,
      reconnecting: false,
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
          if (phase === "presign") msg = t.preparingDirectUpload;
          else if (phase === "uploading") msg = t.uploadingVideoToStorage;
          else if (phase === "enqueueing") msg = t.queuingAnalysisJobs;
          setJobs((prev) => {
            const job = prev.get(tempGroupId);
            if (!job) return prev;
            const next = new Map(prev);
            next.set(tempGroupId, { ...job, message: msg, uploadProgress: undefined });
            return next;
          });
        },
        onProgress: (progress) => {
          setJobs((prev) => {
            const job = prev.get(tempGroupId);
            if (!job) return prev;
            const next = new Map(prev);
            next.set(tempGroupId, { ...job, uploadProgress: progress });
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
          message: t.queuedGroupId.replace("{groupId}", created.group_id),
          jobIds: ids,
          results: null,
          pollInterval: null,
          abortController: null,
          inFlight: false,
          pollErrorCount: 0,
          reconnecting: false,
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
      <div className="language-toggle">
        <button 
          type="button" 
          onClick={toggleLanguage}
          className="lang-btn"
          aria-label="Switch language"
        >
          {language === "en" ? "EN | ไทย" : "EN | ไทย"}
        </button>
      </div>
      <header className="hero">
        <img
          className="logo"
          src="/brand-logo.png"
          alt={t.siteName}
          width={512}
          height={512}
        />
        <div className="brand-line" aria-hidden="true" />
        <h1 className="sr-only">{t.siteName}</h1>
        <p className="sub">
          {includeDots ? t.tagline : t.taglineNoDots}
        </p>
      </header>

      <section className="panel guidelines" aria-labelledby="recording-guidelines-title">
        <h2 id="recording-guidelines-title">{t.recordingGuidelines}</h2>
        <ul>
          <li>{t.guidePortrait}</li>
          <li>{t.guideSize}</li>
          <li>{t.guideClothing}</li>
          <li>{t.guideMovement}</li>
        </ul>
      </section>

      <section className="panel guidelines" aria-labelledby="presentation-objectives-title">
        <h2 id="presentation-objectives-title">{t.presentationObjectives}</h2>
        <ol>
          <li>{t.objectivesSee}</li>
          <li>{t.objectivesRehear}</li>
          <li>{t.objectivesConfident}</li>
        </ol>
      </section>

      <section className="panel login" aria-labelledby="partner-login-title">
        <h2 id="partner-login-title">{t.partnerLogin}</h2>
        {auth ? (
          <div className="login-session">
            <p className="login-user">
              {t.signedInAs} <strong>{auth.username}</strong>
            </p>
            <div className={`quota${noQuota ? " empty" : ""}`}>
              <span className="quota-label">{t.videosRemaining}</span>
              <strong className="quota-count">
                {remaining} / {auth.quota}
              </strong>
            </div>
            {noQuota ? (
              <p className="login-note">{t.noUploadsRemaining.replace("{quota}", String(auth.quota))}</p>
            ) : (
              <p className="login-note">
                {t.uploadsNote.replace("{quota}", String(auth.quota))}
              </p>
            )}
            <button className="ghost" type="button" onClick={() => void onLogout()} disabled={uploading}>
              {t.logOut}
            </button>
          </div>
        ) : (
          <form onSubmit={onLogin}>
            <label htmlFor="username">{t.username}</label>
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
            <label htmlFor="password">{t.password}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.password}
              disabled={authBusy || !authReady}
            />
            <button className="primary" type="submit" disabled={authBusy || !authReady}>
              {authBusy ? t.signingIn : t.logIn}
            </button>
            {authError ? <div className="status err">{authError}</div> : null}
          </form>
        )}
      </section>

      <div className="panel card">
        <form onSubmit={onSubmit}>
          <label htmlFor="name">{t.name}</label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.yourName}
            disabled={formLocked}
          />

          <label htmlFor="email">{t.email}</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailPlaceholder}
            disabled={formLocked}
          />

          <label htmlFor="video">{t.video}</label>
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
              ? t.logInToStart
              : noQuota
                ? t.noUploadsRemainingButton
                : uploading
                  ? t.uploading
                  : t.startAnalysis}
          </button>
        </form>

        {(name || email || video) && (
          <button className="ghost" type="button" onClick={onClear} disabled={uploading}>
            {t.clearForm}
          </button>
        )}
      </div>

      {jobsList.length > 0 && (
        <section className="panel" aria-labelledby="jobs-title">
          <h2 id="jobs-title">{t.yourJobs}</h2>
          {jobsList.map((job) => {
            const links = readyLinks(job.results, includeDots, t);
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
                {job.reconnecting ? (
                  <div className="status">{t.reconnecting}</div>
                ) : job.message ? (
                  <div className={`status ${statusClass}`}>
                    {job.message}
                    {job.uploadProgress && job.phase === "uploading" && (
                      <div className="upload-progress">
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${job.uploadProgress.percent}%` }}
                          />
                        </div>
                        <div className="progress-text">
                          {t.uploadingProgress
                            .replace("{percent}", String(job.uploadProgress.percent))
                            .replace("{uploaded}", (job.uploadProgress.uploadedBytes / (1024 * 1024)).toFixed(1))
                            .replace("{total}", (job.uploadProgress.totalBytes / (1024 * 1024)).toFixed(1))}
                          {job.uploadProgress.speed != null && job.uploadProgress.timeRemaining != null && (
                            <span className="progress-details">
                              {" · "}
                              {t.uploadSpeed.replace("{speed}", String(job.uploadProgress.speed))}
                              {" · "}
                              {t.uploadTimeRemaining.replace("{time}", `${job.uploadProgress.timeRemaining}s`)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
                        {t.download} {item.label}
                      </a>
                    ))}
                  </div>
                ) : null}
                {myQueueEntry && (
                  <div className="queue-stages">
                    {getStageOrder(t).map(({ key, label }) => {
                      const stage = myQueueEntry.stages?.[key];
                      if (!stage || stage === "none") return null;
                      return (
                        <span key={key} className={`queue-chip stage-${stage}`}>
                          {label}: {stageLabel(stage, t)}
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
                    {t.remove}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="panel queue-board" aria-labelledby="queue-status-title">
        <h2 id="queue-status-title">{t.yourAnalysisStatus}</h2>
        <p className="queue-lead">
          {t.statusLead}
        </p>
        {!auth ? (
          <p className="queue-empty">{t.logInToView}</p>
        ) : jobsList.length === 0 ? (
          <p className="queue-empty">{t.startAnalysisToSee}</p>
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
                          ? t.beingProcessedNow
                          : t.youAreInQueue.replace("{position}", String(myQueuePosition))}
                        {queueWaitingCount != null && queueWaitingCount > 1 ? ` · ${t.inQueue.replace("{count}", String(queueWaitingCount))}` : ""}
                      </p>
                      <p className="queue-summary">
                        {language === "th" && myQueueEntry.summary_th ? myQueueEntry.summary_th : myQueueEntry.summary}
                      </p>
                      <div className="queue-stages">
                        {getStageOrder(t).map(({ key, label }) => {
                          const stage = myQueueEntry.stages?.[key];
                          if (!stage || stage === "none") return null;
                          return (
                            <span key={key} className={`queue-chip stage-${stage}`}>
                              {label}: {stageLabel(stage, t)}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  ) : job.phase === "uploading" || job.phase === "processing" ? (
                    <p className="queue-empty">
                      <strong>{job.name || "Unnamed"}</strong> · {t.starting}
                    </p>
                  ) : job.phase === "done" ? (
                    <p className="queue-empty">
                      <strong>{job.name || "Unnamed"}</strong> · {t.analysisComplete}
                    </p>
                  ) : job.phase === "error" ? (
                    <p className="queue-empty">
                      <strong>{job.name || "Unnamed"}</strong> · {t.analysisStopped}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {queueError ? <p className="queue-error">{queueError}</p> : null}
            {queueUpdatedAt ? (
              <p className="queue-meta">
                {t.updated} {new Date(queueUpdatedAt).toLocaleTimeString()}
              </p>
            ) : null}
          </>
        )}
      </section>

    </div>
  );
}