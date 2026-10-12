
import { memo, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ChartNoAxesCombined,
  Check,
  FileChartColumn,
  FilePlus2,
  Files,
  House,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Send,
  Trash2,
  Upload,
  UserRound,
  ChevronRight,
  X,
  Copy
} from "lucide-react";
import "./App.css";

const API = "http://localhost:8000";
const DEMO_ID = "897987";
const USERS_KEY = "labstory-users";

type Tab = "home" | "demo" | "yours";

type LabUser = {
  id: string;
  name: string;
};

type DataPoint = {
  date: string;
  value: number;
  reference_low?: number | null;
  reference_high?: number | null;
};

type TestAnalysis = {
  test_name: string;
  unit: string;
  data_points: DataPoint[];
  trend: string;
};

type PatientAnalysis = {
  patient_id: string;
  status: string;
  report_count?: number;
  analysis?: TestAnalysis[];
};

type AskSource = { title?: string; url?: string };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
};

type BadgeStatus = "attention" | "normal" | "insufficient";

const statusLabels: Record<
  BadgeStatus,
  { label: string; symbol: string }
> = {
  attention: { label: "Needs attention", symbol: "!" },
  normal: { label: "Within range", symbol: "✓" },
  insufficient: { label: "Insufficient data", symbol: "i" },
};

function parseDate(date: string): number {
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

  const match = date.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);

  if (match) {
    return new Date(`${match[2]} ${match[1]}, ${match[3]}`).getTime();
  }

  return 0;
}

function formatDate(date: string): string {
  const timestamp = parseDate(date);
  if (!timestamp) return date;

  return new Date(timestamp).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

function getStatus(point?: DataPoint): BadgeStatus {
  if (!point) return "insufficient";

  const hasLow = point.reference_low != null;
  const hasHigh = point.reference_high != null;

  if (!hasLow && !hasHigh) return "insufficient";

  if (
    (hasLow && point.value < point.reference_low!) ||
    (hasHigh && point.value > point.reference_high!)
  ) {
    return "attention";
  }

  return "normal";
}

function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="status-symbol" aria-hidden="true">
        {statusLabels[status].symbol}
      </span>
      {statusLabels[status].label}
    </span>
  );
}

const LabChart = memo(function LabChart({ test }: { test: TestAnalysis }) {
  const points = useMemo(
    () =>
      [...(test.data_points ?? [])]
        .sort((a, b) => parseDate(a.date) - parseDate(b.date))
        .map((point) => ({
          ...point,
          displayDate: formatDate(point.date),
        })),
    [test.data_points]
  );

  const latest = points[points.length - 1];
  const status = getStatus(latest);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <article className="lab-card">
      <StatusBadge status={status} />

      <div className="lab-card-heading">
        <div className="lab-card-title">
          <h3>{test.test_name}</h3>
          <p>{test.unit || "Unit not specified"}</p>
        </div>

        <div className="latest-value">
          <strong>{latest?.value ?? "—"}</strong>
          <span>{test.unit || "Latest result"}</span>
        </div>
      </div>

      <div className="lab-chart">
        {points.length === 0 ? (
          <div className="empty-chart">No dated results available.</div>
        ) : (() => {
          // Native SVG avoids ResponsiveContainer's post-mount size measurement,
          // so the trend line is present in the first paint.
          const width = 320;
          const height = 160;
          const left = 39;
          const right = 8;
          const top = 10;
          const bottom = 25;
          const plotWidth = width - left - right;
          const plotHeight = height - top - bottom;
          const values = points.flatMap((point) =>
            [point.value, point.reference_low, point.reference_high].filter(
              (value): value is number => typeof value === "number" && Number.isFinite(value)
            )
          );
          const rawMin = values.length ? Math.min(...values) : 0;
          const rawMax = values.length ? Math.max(...values) : 1;
          const padding = rawMax === rawMin ? Math.max(Math.abs(rawMax) * 0.1, 1) : (rawMax - rawMin) * 0.12;
          const min = rawMin - padding;
          const max = rawMax + padding;
          const x = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
          const y = (value: number) => top + ((max - value) / (max - min)) * plotHeight;
          const makePath = (getValue: (point: DataPoint) => number | null | undefined) => {
            let drawing = false;
            return points.map((point, index) => {
              const value = getValue(point);
              if (value == null || !Number.isFinite(value)) {
                drawing = false;
                return "";
              }
              const command = `${drawing ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
              drawing = true;
              return command;
            }).filter(Boolean).join(" ");
          };
          const resultPath = makePath((point) => point.value);
          const lowPath = makePath((point) => point.reference_low);
          const highPath = makePath((point) => point.reference_high);
          const hasLow = points.some((point) => point.reference_low != null);
          const hasHigh = points.some((point) => point.reference_high != null);
          const formatTick = (value: number) => Number(value.toPrecision(3)).toString();

          const hoveredPoint = hoveredIndex == null ? null : points[hoveredIndex];
          const tooltipLeft = hoveredIndex == null
            ? 0
            : (x(hoveredIndex) / width) * 100;
          const tooltipTop = hoveredIndex == null || !hoveredPoint
            ? 0
            : (y(hoveredPoint.value) / height) * 100;

          return (
            <>
              <svg
                className="lab-chart-svg"
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${test.test_name} results over time. Hover or focus a point for its value.`}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {[0, 1, 2, 3].map((step) => {
                  const value = max - ((max - min) * step) / 3;
                  const gridY = top + (plotHeight * step) / 3;
                  return (
                    <g key={step}>
                      <line x1={left} y1={gridY} x2={width - right} y2={gridY} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                      <text x={left - 5} y={gridY + 3} textAnchor="end" fill="var(--muted)" fontSize="9">{formatTick(value)}</text>
                    </g>
                  );
                })}
                {hasLow && <path d={lowPath} fill="none" stroke="var(--reference-line)" strokeWidth="1" strokeDasharray="4 4" />}
                {hasHigh && <path d={highPath} fill="none" stroke="var(--reference-line)" strokeWidth="1" strokeDasharray="4 4" />}
                <path d={resultPath} fill="none" stroke={status === "attention" ? "var(--status-danger)" : "var(--accent)"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                {points.map((point, index) => (
                  <g key={`${point.date}-${index}`}>
                    {hoveredIndex === index && (
                      <line
                        x1={x(index)}
                        y1={top}
                        x2={x(index)}
                        y2={height - bottom}
                        stroke="var(--muted)"
                        strokeOpacity="0.45"
                        strokeDasharray="3 3"
                        pointerEvents="none"
                      />
                    )}
                    <circle
                      cx={x(index)}
                      cy={y(point.value)}
                      r={hoveredIndex === index ? 5 : 3}
                      fill={status === "attention" ? "var(--status-danger)" : "var(--accent)"}
                      stroke={hoveredIndex === index ? "var(--text)" : "none"}
                      strokeWidth="1.5"
                      pointerEvents="none"
                    />
                    <circle
                      className="lab-chart-hit-area"
                      cx={x(index)}
                      cy={y(point.value)}
                      r="10"
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={`${point.date}: ${point.value} ${test.unit || ""}`}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onFocus={() => setHoveredIndex(index)}
                      onBlur={() => setHoveredIndex(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setHoveredIndex(null);
                        if (event.key === "ArrowRight") setHoveredIndex(Math.min(index + 1, points.length - 1));
                        if (event.key === "ArrowLeft") setHoveredIndex(Math.max(index - 1, 0));
                      }}
                    />
                  </g>
                ))}
                {points.map((point, index) => (index === 0 || index === points.length - 1 || (points.length > 4 && index === Math.floor((points.length - 1) / 2))) && (
                  <text key={`date-${point.date}-${index}`} x={x(index)} y={height - 7} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fill="var(--muted)" fontSize="9">{point.displayDate}</text>
                ))}
              </svg>
              {hoveredPoint && (
                <div
                  className={`lab-chart-tooltip${hoveredIndex === 0 ? " at-start" : hoveredIndex === points.length - 1 ? " at-end" : ""}`}
                  style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
                  role="status"
                  aria-live="polite"
                >
                  <strong>{hoveredPoint.value} <span>{test.unit}</span></strong>
                  <span className="lab-chart-tooltip-date">{hoveredPoint.date}</span>
                  {(hoveredPoint.reference_low != null || hoveredPoint.reference_high != null) && (
                    <span className="lab-chart-tooltip-range">
                      Reference: {hoveredPoint.reference_low ?? "—"}–{hoveredPoint.reference_high ?? "—"}
                    </span>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>

      <div className="lab-card-footer">
        <span>
          {points.length} result{points.length === 1 ? "" : "s"}
        </span>
        <span>{test.trend || "Trend unavailable"}</span>
      </div>
    </article>
  );
});

function readUsers(): LabUser[] {
  try {
    const saved = localStorage.getItem(USERS_KEY);
    return saved ? (JSON.parse(saved) as LabUser[]) : [];
  } catch {
    return [];
  }
}

function makeUserId(): string {
  return `patient-${crypto.randomUUID().slice(0, 8)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [users, setUsers] = useState<LabUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);

  const [analysis, setAnalysis] = useState<PatientAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");

  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! Ask me general questions about cholesterol, blood pressure, blood glucose, and healthy lifestyle habits using the LabStory Health Advice Guide.",
    },
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [demoAnalysis, setDemoAnalysis] =
    useState<PatientAnalysis | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState("");

  useEffect(() => {
    const savedUsers = readUsers();
    setUsers(savedUsers);
    setSelectedUserId(savedUsers[0]?.id ?? "");
  }, []);

  function saveUsers(updated: LabUser[]) {
    setUsers(updated);
    localStorage.setItem(USERS_KEY, JSON.stringify(updated));
  }

  async function fetchAnalysis(patientId: string) {
    setLoadingAnalysis(true);
    setAnalysisError("");
    setAnalysis(null);

    try {
      const response = await fetch(
        `${API}/patients/${encodeURIComponent(patientId)}/analysis`
      );

      if (response.status === 404) {
        throw new Error(
          "No saved analysis was found yet. Upload reports and try again after processing finishes."
        );
      }

      if (!response.ok) {
        throw new Error(`Could not load analysis (HTTP ${response.status}).`);
      }

      const result: PatientAnalysis = await response.json();

      if (result.status !== "completed") {
        throw new Error(
          `Analysis is currently "${result.status}". Try again when processing finishes.`
        );
      }

      setAnalysis(result);
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : "Unable to load analysis."
      );
    } finally {
      setLoadingAnalysis(false);
    }
  }

  async function openDemo() {
    setActiveTab("demo");
    setDemoLoading(true);
    setDemoError("");
    setDemoAnalysis(null);

    try {
      const response = await fetch(`${API}/patients/${DEMO_ID}/analysis`);

      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? `Demo analysis not found. Check that patient ${DEMO_ID} has completed analysis.`
            : `Could not load demo analysis (HTTP ${response.status}).`
        );
      }

      const result: PatientAnalysis = await response.json();

      if (result.status !== "completed") {
        throw new Error(`Demo analysis status: ${result.status}.`);
      }

      setDemoAnalysis(result);
    } catch (error) {
      setDemoError(
        error instanceof Error ? error.message : "Unable to load demo graphs."
      );
    } finally {
      setDemoLoading(false);
    }
  }

  function createUser() {
    const name = newUserName.trim();
    if (!name) return;

    const newUser: LabUser = {
      id: makeUserId(),
      name,
    };

    saveUsers([...users, newUser]);
    setSelectedUserId(newUser.id);
    setNewUserName("");
    setShowCreateUser(false);
    setFiles([]);
    setAnalysis(null);
    setAnalysisError("");
    setUploadMessage("");
    setUploadError("");
  }

  const selectedUser = users.find((user) => user.id === selectedUserId);


  async function uploadReports() {
    if (!selectedUser) {
      setUploadError("Create or select a user first.");
      return;
    }

    if (files.length === 0) {
      setUploadError("Choose at least one report.");
      return;
    }

    if (files.length > 30) {
      setUploadError("You can upload up to 30 files at once.");
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadMessage("");

    const formData = new FormData();

    // Field name must match FastAPI's `files` parameter.
    files.forEach((file) => {
      formData.append("files", file);
    });

    formData.append("patient_name", selectedUser.name);

    try {
      const response = await fetch(
        `${API}/patients/${encodeURIComponent(selectedUser.id)}/reports/batch`,
        {
          method: "POST",
          body: formData,
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail ?? `Upload failed (HTTP ${response.status})`
        );
      }

      setUploadMessage(
        `${result.report_ids.length} files uploaded successfully. ` +
        "Background processing has started. Load your analysis when it completes."
      );

      setFiles([]);
      setAnalysis(null);
      setAnalysisError("");
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Upload failed."
      );
    } finally {
      setUploading(false);
    }
  }


  async function sendChatQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = chatQuestion.trim();
    if (!question || chatLoading) return;

    setChatMessages((current) => [...current, { role: "user", content: question }]);
    setChatQuestion("");
    setChatError("");
    setChatLoading(true);

    try {
      const response = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : `The assistant request failed (HTTP ${response.status}).`
        );
      }
      if (typeof result.answer !== "string") {
        throw new Error("The assistant returned an unexpected response.");
      }

      const sources: AskSource[] = Array.isArray(result.sources)
        ? result.sources.map((source: AskSource) => ({
          title: source.title,
          url: source.url,
        }))
        : [];

      setChatMessages((current) => [
        ...current,
        { role: "assistant", content: result.answer, sources },
      ]);
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Couldn't get an answer. Please try again."
      );
    } finally {
      setChatLoading(false);
    }
  }

  function deleteUser(userId: string) {
    const updated = users.filter((user) => user.id !== userId);
    saveUsers(updated);

    if (selectedUserId === userId) {
      setSelectedUserId(updated[0]?.id ?? "");
      setAnalysis(null);
      setAnalysisError("");
    }
  }

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setUploadError("");
    setAnalysisError("");

    if (tab === "demo" && !demoAnalysis && !demoLoading) {
      void openDemo();
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="sidebar-brand"
          onClick={() => selectTab("home")}
          aria-label="LabStory home"
        >
          <span className="brand-symbol"><Activity size={25} /></span>
          <span className="brand-name-vertical">LabStory</span>
        </button>

        <nav className="side-nav" aria-label="Main navigation">
          <button
            className={`nav-item ${activeTab === "home" ? "active" : ""}`}
            onClick={() => selectTab("home")}
          >
            <House size={21} /><span>Home</span>
          </button>
          <button
            className={`nav-item ${activeTab === "demo" ? "active" : ""}`}
            onClick={() => selectTab("demo")}
          >
            <ChartNoAxesCombined size={21} /><span>Demo Duck</span>
          </button>
          <button
            className={`nav-item ${activeTab === "yours" ? "active" : ""}`}
            onClick={() => selectTab("yours")}
          >
            <UserRound size={21} /><span>Try Yours</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <span className="sidebar-mini-mark"><Sparkles size={17} /></span>
          <span onClick={() =>
            navigator.clipboard.writeText("anjd137@gmail.com")
          }>Created by Anjitha</span>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === "home" && (
          <section className="home-page">
            <div className="home-hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <Sparkles size={15} /> YOUR PERSONAL LAB INSIGHTS
                </div>

                <h1>Your reports.<br /><span>Your health story.</span></h1>

                <p className="hero-description">
                  Bring your laboratory reports together. Visualize changes
                  over time and get a clearer picture of your health journey.
                </p>

                <div className="hero-actions">
                  <button className="primary-button" onClick={() => void openDemo()}>
                    Explore demo graphs <ArrowRight size={17} />
                  </button>
                  <button className="secondary-button" onClick={() => selectTab("yours")}>
                    Try yours <ChevronRight size={17} />
                  </button>
                </div>

                <div className="hero-note">
                  <Check size={15} /> PDF reports · Visual trends · One timeline
                </div>
              </div>

              <div className="hero-visual" aria-label="Decorative lab report illustration">
                <div className="visual-orbit orbit-one" />
                <div className="visual-orbit orbit-two" />
                <div className="visual-decoration decoration-one" />
                <div className="visual-decoration decoration-two" />

                <div className="visual-report report-back">
                  <div className="report-line long" />
                  <div className="report-line" />
                  <div className="report-line short" />
                  <div className="report-bars">
                    <span /><span /><span /><span /><span />
                  </div>
                </div>

                <div className="visual-report report-front">
                  <div className="report-topline">
                    <span className="report-icon"><Activity size={18} /></span>
                    <span>LAB REPORT</span>
                    <span className="report-check"><Check size={14} /></span>
                  </div>
                  <h3>Health overview</h3>
                  <p>Track your results over time</p>
                  <div className="illustration-chart">
                    <div className="illustration-chart-labels">
                      <span>Result</span><span>Trend</span>
                    </div>
                    <svg viewBox="0 0 280 105" role="img" aria-label="Decorative trend line">
                      <path d="M0 20 H280 M0 52 H280 M0 84 H280" stroke="var(--chart-grid)" strokeWidth="1" />
                      <path
                        d="M5 78 C35 72,40 40,70 53 S110 67,140 36 S190 57,218 25 S255 39,275 12"
                        fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                      />
                      <circle cx="275" cy="12" r="5" fill="var(--accent)" />
                    </svg>
                  </div>
                  <div className="report-bottom">
                    <span><span className="green-dot" /> Trends at a glance</span>
                    <span>•••</span>
                  </div>
                </div>

                <div className="floating-chip chip-top">
                  <span className="chip-icon green"><Check size={15} /></span>
                  Results organized
                </div>
                <div className="floating-chip chip-bottom">
                  <span className="chip-icon purple"><ChartNoAxesCombined size={15} /></span>
                  <span><strong>One health story</strong><small>Across your reports</small></span>
                </div>
              </div>
            </div>

            <div className="home-bottom">
              <div className="home-feature">
                <span className="feature-icon"><Files size={20} /></span>
                <div><strong>Bring reports together</strong><p>Upload PDFs from different dates.</p></div>
              </div>
              <div className="home-feature">
                <span className="feature-icon"><ChartNoAxesCombined size={20} /></span>
                <div><strong>See what changes</strong><p>Explore trends in your lab results.</p></div>
              </div>
              <div className="home-feature">
                <span className="feature-icon"><Sparkles size={20} /></span>
                <div><strong>Understand your timeline</strong><p>Keep results in one workspace.</p></div>
              </div>
            </div>

            {/* <footer className="home-footer">
              LabStory · Your reports, connected over time.
              <span>Created by Anjitha</span>
            </footer> */}

            <footer className="home-footer">
              LabStory · Your reports, connected over time.
              <div className="home-footer-email">
                <div>Created by Anjitha</div>
                <div>
                  <a href="mailto:anjd137@gmail.com">
                    anjd137@gmail.com
                  </a>
                  <button
                    type="button"
                    title="Copy email"
                    aria-label="Copy email address"
                    onClick={() =>
                      navigator.clipboard.writeText("anjd137@gmail.com")
                    }
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            </footer>

          </section>
        )}

        {activeTab === "demo" && (
          <section className="workspace">
            <header className="workspace-header">
              <div>
                <div className="eyebrow">EXPLORE LABSTORY</div>
                <h1>Demo Duck's health story</h1>
                <p>Explore laboratory trends using our demo patient's reports.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => void openDemo()}
                disabled={demoLoading}
                aria-label="Refresh demo graphs"
              >
                <RefreshCw size={18} />
              </button>
            </header>

            <div className="workspace-meta">
              <span className="patient-pill"><UserRound size={15} /> Demo patient</span>
              <span>Patient ID: {DEMO_ID}</span>
              {demoAnalysis?.report_count != null && (
                <span>{demoAnalysis.report_count} reports analyzed</span>
              )}
            </div>

            {demoLoading && (
              <div className="state-panel">
                <LoaderCircle className="spinner" size={25} />
                <strong>Preparing your graphs...</strong>
                <p>Loading saved laboratory analysis.</p>
              </div>
            )}

            {demoError && !demoLoading && (
              <div className="error-panel" role="alert">
                <strong>Couldn't load demo graphs</strong>
                <p>{demoError}</p>
                <button className="secondary-button" onClick={() => void openDemo()}>
                  Try again <RefreshCw size={15} />
                </button>
              </div>
            )}

            {demoAnalysis && !demoLoading && (
              <>
                <div className="results-heading">
                  <div>
                    <h2>Laboratory trends</h2>
                    <p>Latest results and available reference ranges.</p>
                  </div>
                  <span className="results-count">{demoAnalysis.analysis?.length ?? 0} tests</span>
                </div>

                <div className="results-grid">
                  {(demoAnalysis.analysis ?? []).map((test, index) => (
                    <LabChart key={`${test.test_name}-${test.unit}-${index}`} test={test} />
                  ))}
                </div>

                {(!demoAnalysis.analysis || demoAnalysis.analysis.length === 0) && (
                  <div className="empty-panel">No graphable results were found.</div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "yours" && (
          <section className="workspace">
            <header className="workspace-header">
              <div>
                <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
                <h1>Your health, your timeline.</h1>
                <p>Create a user, upload laboratory reports, and view your results together.</p>
              </div>
              <button className="primary-button" onClick={() => setShowCreateUser(true)}>
                <Plus size={17} /> Add new user
              </button>
            </header>

            <div className="privacy-note">
              <span className="privacy-note-icon"><UserRound size={18} /></span>
              <div>
                <strong>Each user has their own random ID</strong>
                <p>
                  Names and IDs are saved in this browser. Uploaded PDFs are sent
                  to the backend under the selected ID.
                </p>
              </div>
            </div>

            {showCreateUser && (
              <form
                className="create-user-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  createUser();
                }}
              >
                <div className="panel-title-row">
                  <div>
                    <h2>Create a user</h2>
                    <p>Choose a name to identify this person's reports.</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowCreateUser(false)}
                    aria-label="Close create user form"
                  >
                    <X size={17} />
                  </button>
                </div>
                <label htmlFor="new-user-name">User name</label>
                <div className="create-user-controls">
                  <input
                    id="new-user-name"
                    value={newUserName}
                    onChange={(event) => setNewUserName(event.target.value)}
                    placeholder="e.g. My health"
                    autoFocus
                    required
                  />
                  <button className="primary-button" type="submit">
                    Create user <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}

            <div className="your-layout panel-yours">
              <section className="upload-column">
                <div className="section-heading">
                  <span className="section-icon"><Upload size={18} /></span>
                  <div><h2>Upload lab reports</h2><p>PDF and images files supported</p></div>
                </div>

                <label className="field-label" htmlFor="user-select">Select user</label>
                <select
                  id="user-select"
                  className="user-select"
                  value={selectedUserId}
                  onChange={(event) => {
                    setSelectedUserId(event.target.value);
                    setFiles([]);
                    setAnalysis(null);
                    setAnalysisError("");
                    setUploadMessage("");
                    setUploadError("");
                  }}
                >
                  <option value="">Choose a user</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>

                {selectedUser && (
                  <div className="user-id-box">
                    <div>
                      <span>YOUR RANDOM PATIENT ID</span>
                      <strong>{selectedUser.id}</strong>
                    </div>
                    <button
                      className="text-button danger-text"
                      onClick={() => deleteUser(selectedUser.id)}
                      type="button"
                      title="Remove user from this browser"
                    >
                      <Trash2 size={15} /> Remove
                    </button>
                  </div>
                )}

                <label className="upload-dropzone" htmlFor="pdf-upload">
                  <span className="upload-illustration"><FilePlus2 size={27} /></span>
                  <strong>Choose your lab reports</strong>
                  <span>Click to browse. Select up to 30 files.</span>
                  <span className="upload-file-types">PDF · JPG · JPEG · PNG</span>
                </label>

                <input
                  id="pdf-upload"
                  className="visually-hidden"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  multiple
                  onChange={(event) => {
                    const chosen = Array.from(event.target.files ?? []);
                    const allowed = /\.(pdf|jpe?g|png)$/i;

                    const valid = chosen.filter((file) => allowed.test(file.name));

                    setFiles(valid);
                    setUploadError(
                      valid.length !== chosen.length
                        ? "Only PDF, JPG, JPEG and PNG files are supported."
                        : ""
                    );
                    setUploadMessage("");
                    event.target.value = "";
                  }}
                />

                {files.length > 0 && (
                  <div className="selected-files">
                    <div className="selected-files-heading">
                      <strong>{files.length} selected</strong>
                      <button className="text-button" onClick={() => setFiles([])} type="button">
                        Clear
                      </button>
                    </div>
                    {files.map((file, index) => (
                      <div className="file-row" key={`${file.name}-${index}`}>
                        <FileChartColumn size={17} />
                        <span>{file.name}</span>
                        <button
                          type="button"
                          className="remove-file"
                          onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  className="primary-button upload-button"
                  onClick={() => void uploadReports()}
                  disabled={uploading || !selectedUser || files.length === 0}
                >
                  {uploading ? (
                    <><LoaderCircle className="spinner" size={17} /> Uploading...</>
                  ) : (
                    <><Upload size={17} /> Upload reports</>
                  )}
                </button>

                {uploadMessage && (
                  <div className="success-message" role="status">
                    <Check size={17} /> {uploadMessage}
                  </div>
                )}
                {uploadError && <div className="inline-error" role="alert">{uploadError}</div>}

                <div className="upload-footnote">
                  The user list is stored locally in this browser. This prototype
                  does not provide account authentication.
                </div>
              </section>

              <section className="personal-results">
                <div className="section-heading">
                  <span className="section-icon"><ChartNoAxesCombined size={18} /></span>
                  <div><h2>Your analysis</h2><p>Graphs for the selected user</p></div>
                </div>

                {!selectedUser && (
                  <div className="empty-workspace">
                    <span><UserRound size={27} /></span>
                    <h3>Start with a user</h3>
                    <p>Create a user first, then upload reports to their ID.</p>
                    <button className="secondary-button" onClick={() => setShowCreateUser(true)}>
                      <Plus size={16} /> Add new user
                    </button>
                  </div>
                )}

                {selectedUser && (
                  <>
                    <div className="selected-user-heading">
                      <div><strong>{selectedUser.name}</strong><span>{selectedUser.id}</span></div>
                      <button
                        className="icon-button"
                        onClick={() => void fetchAnalysis(selectedUser.id)}
                        disabled={loadingAnalysis}
                        title="Refresh analysis"
                        aria-label="Refresh analysis"
                      >
                        <RefreshCw size={17} />
                      </button>
                    </div>

                    {!analysis && !loadingAnalysis && !analysisError && (
                      <div className="empty-workspace compact">
                        <span><Files size={25} /></span>
                        <h3>Your graphs will appear here</h3>
                        <p>Upload PDFs, then load analysis once processing finishes.</p>
                        <button className="secondary-button" onClick={() => void fetchAnalysis(selectedUser.id)}>
                          Load analysis <ArrowRight size={16} />
                        </button>
                      </div>
                    )}

                    {loadingAnalysis && (
                      <div className="state-panel">
                        <LoaderCircle className="spinner" size={23} />
                        <strong>Loading your graphs...</strong>
                      </div>
                    )}

                    {analysisError && !loadingAnalysis && (
                      <div className="error-panel" role="alert">
                        <p>{analysisError}</p>
                        <button className="secondary-button" onClick={() => void fetchAnalysis(selectedUser.id)}>
                          Try again <RefreshCw size={15} />
                        </button>
                      </div>
                    )}

                    {analysis && !loadingAnalysis && (
                      <>
                        <div className="personal-analysis-meta">
                          {analysis.report_count ?? 0} reports analyzed
                          <button className="text-button" onClick={() => void fetchAnalysis(selectedUser.id)}>
                            <RefreshCw size={13} /> Refresh
                          </button>
                        </div>
                        <div className="personal-results-grid">
                          {(analysis.analysis ?? []).map((test, index) => (
                            <LabChart key={`${test.test_name}-${test.unit}-${index}`} test={test} />
                          ))}
                        </div>
                        {(!analysis.analysis || analysis.analysis.length === 0) && (
                          <div className="empty-panel">No graphable results were found.</div>
                        )}
                      </>
                    )}
                  </>
                )}
              </section>
            </div>
          </section>
        )}
      </main>

      <button
        type="button"
        className="chat-fab"
        onClick={() => setIsChatOpen((open) => !open)}
        aria-label={isChatOpen ? "Close Ask LabStory" : "Open Ask LabStory"}
        aria-expanded={isChatOpen}
      >
        {isChatOpen ? <X size={22} /> : <Sparkles size={22} />}
        <span>{isChatOpen ? "Close" : "Ask LabStory"}</span>
      </button>

      {isChatOpen && (
        <section className="chat-widget" aria-label="LabStory health assistant">
          <header className="chat-widget-header">
            <div>
              <strong><Sparkles size={17} /> Ask LabStory</strong>
              <p>Answers from the health advice guide</p>
            </div>
            <button type="button" className="icon-button" onClick={() => setIsChatOpen(false)} aria-label="Close chat">
              <X size={17} />
            </button>
          </header>

          <p className="chat-disclaimer">
            Educational information only — not a diagnosis or a substitute for a clinician.
          </p>

          <div className="chat-messages" aria-live="polite" aria-relevant="additions">
            {chatMessages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="chat-message-role">
                  {message.role === "assistant" ? "LabStory AI" : "You"}
                </div>
                <p>{message.content}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="chat-sources">
                    <strong>Sources</strong>
                    {[...new Map(
                      message.sources.map((source) => [
                        `${source.title ?? "Health guide"}|${source.url ?? ""}`,
                        source,
                      ])
                    ).values()].map((source, sourceIndex) => (
                      <div className="chat-source" key={`${source.title}-${sourceIndex}`}>
                        <Files size={14} />
                        <span>{source.title || "Health advice guide"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {chatLoading && (
              <div className="chat-thinking" role="status">
                <LoaderCircle className="spinner" size={16} />
                <span>Finding relevant guidance...</span>
              </div>
            )}
          </div>

          {chatError && <div className="inline-error" role="alert">{chatError}</div>}

          <form className="chat-form" onSubmit={sendChatQuestion}>
            <label className="visually-hidden" htmlFor="labstory-chat-question">Ask a health question</label>
            <textarea
              id="labstory-chat-question"
              value={chatQuestion}
              onChange={(event) => setChatQuestion(event.target.value)}
              placeholder="Ask a health question..."
              rows={2}
              maxLength={1000}
              disabled={chatLoading}
            />
            <button
              className="primary-button chat-send-button"
              type="submit"
              disabled={chatLoading || !chatQuestion.trim()}
              aria-label="Send question"
            >
              {chatLoading ? <LoaderCircle className="spinner" size={17} /> : <Send size={17} />}
              Ask
            </button>
          </form>

          <p className="chat-footnote">Avoid entering names or other personal details.</p>
        </section>
      )}
    </div>
  );
}
