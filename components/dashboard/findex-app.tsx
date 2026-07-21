"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bot, BriefcaseBusiness, CalendarDays, ChevronRight, ReceiptText, Settings, Sparkles, WalletCards } from "lucide-react";
import type { DemoDataset } from "@/lib/finance/types";
import { formatMoney, getCashFlowForecast } from "@/lib/finance/engine";
import type { WorkspaceArtifactV2, WorkspaceProject } from "@/lib/workspaces/contracts";
import {
  deleteWorkspaceProject,
  getWorkspaceArtifact,
  listWorkspaceProjects,
  listWorkspaceVersions,
  renameWorkspaceProject,
  saveWorkspaceArtifact,
  workspaceStorageUsage,
} from "@/lib/workspaces/persistence";
import { BrainGuidance } from "@/components/brain/brain-guidance";
import { BrainHandoffBanner } from "@/components/brain/brain-handoff-banner";
import { BrainPanel } from "@/components/brain/brain-panel";
import { BrandLogo } from "@/components/brand/brand-logo";
import { WorkspaceLibrary } from "@/components/workspaces/workspace-library";
import { WorkspaceArtifactCard } from "@/components/workspaces/workspace-artifact-card";
import { createHandoff, type BrainHandoff } from "@/lib/brain/guidance";
import { navigateWithTransition, viewFromPath, type DemoView } from "@/lib/brain/navigation";
import { CashFlowView } from "./cash-flow-view";
import { Landing } from "./landing";
import { PortfolioView } from "./portfolio-view";
import { SpendingView } from "./spending-view";

type Snapshot = ReturnType<typeof import("@/lib/finance/engine").getFinancialSnapshot>;

const SESSION_KEY = "findex-demo-entered-v1";
const ACTIVE_WORKSPACE_KEY = "findex-active-workspace-v2";

const navItems: Array<{ view: DemoView; label: string; description: string; icon: typeof Bot }> = [
  { view: "brain", label: "Financial Brain", description: "Ask and decide", icon: Bot },
  { view: "spending", label: "Spending", description: "Activity & recurring", icon: ReceiptText },
  { view: "portfolio", label: "Portfolio", description: "Holdings & net worth", icon: BriefcaseBusiness },
  { view: "cash-flow", label: "Cash flow", description: "Income & outlook", icon: BarChart3 },
];

export function FinDexApp({ dataset, snapshot }: { dataset: DemoDataset; snapshot: Snapshot }) {
  const router = useRouter();
  const pathname = usePathname();
  const view = viewFromPath(pathname);
  const [entered, setEntered] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [artifact, setArtifact] = useState<WorkspaceArtifactV2 | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [versions, setVersions] = useState<WorkspaceArtifactV2[]>([]);
  const [storageWarning, setStorageWarning] = useState(false);
  const [widgetPrompt, setWidgetPrompt] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<BrainHandoff | null>(null);
  const [prevView, setPrevView] = useState(view);
  const generatedRef = useRef<HTMLDetailsElement>(null);
  const cashFlow = useMemo(() => getCashFlowForecast({ days: 90 }), []);

  // Clear handoff when navigating away from Brain (adjust during render — not an effect).
  if (view !== prevView) {
    setPrevView(view);
    if (view !== "brain") {
      setHandoff(null);
    }
  }

  const loadLibrary = useCallback(async (preferredProjectId?: string | null) => {
    const nextProjects = await listWorkspaceProjects();
    setProjects(nextProjects);
    const requested = preferredProjectId ?? window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const activeProject = nextProjects.find((project) => project.id === requested) ?? nextProjects[0];
    if (!activeProject) {
      setArtifact(null);
      setVersions([]);
      window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      return;
    }
    const nextArtifact = await getWorkspaceArtifact(activeProject.activeVersionId);
    setArtifact(nextArtifact ?? null);
    setVersions(await listWorkspaceVersions(activeProject.id));
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeProject.id);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const hasEntered = window.sessionStorage.getItem(SESSION_KEY) === "true";
      if (active) setEntered(hasEntered);
      try { await loadLibrary(); } catch (error) { console.warn("Workspace library could not be loaded.", error); }
      const usage = await workspaceStorageUsage();
      if (active) setStorageWarning((usage ?? 0) >= 0.8);
      if (active) setHydrated(true);
      if (hasEntered && pathname === "/") router.replace("/demo/brain");
    })();
    return () => { active = false; };
  }, [loadLibrary, pathname, router]);

  const enterDemo = () => {
    window.sessionStorage.setItem(SESSION_KEY, "true");
    setEntered(true);
    router.push("/demo/brain");
  };

  const handleWorkspace = async (nextArtifact: WorkspaceArtifactV2) => {
    await saveWorkspaceArtifact(nextArtifact);
    setArtifact(nextArtifact);
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, nextArtifact.projectId);
    await loadLibrary(nextArtifact.projectId);
    const usage = await workspaceStorageUsage();
    setStorageWarning((usage ?? 0) >= 0.8);
    window.setTimeout(() => generatedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  };

  const selectWorkspace = async (projectId: string) => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, projectId);
    await loadLibrary(projectId);
  };
  const newWorkspace = () => {
    setArtifact(null);
    setVersions([]);
    window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  };
  const refreshArtifactToken = async (source: WorkspaceArtifactV2, artifactId: string) => {
    const response = await fetch("/api/workspace/artifact-token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceToken: source.capabilityToken, artifactId, artifactHash: source.bundle.sha256 }),
    });
    const payload = await response.json() as { token?: string; signature?: string; error?: string };
    if (!response.ok || !payload.token || !payload.signature) throw new Error(payload.error || "Could not refresh the workspace grant.");
    return { capabilityToken: payload.token, artifactSignature: payload.signature };
  };
  const duplicateWorkspace = async () => {
    if (!artifact) return;
    const id = crypto.randomUUID(); const projectId = crypto.randomUUID();
    const signed = await refreshArtifactToken(artifact, id);
    await handleWorkspace({ ...artifact, id, projectId, version: 1, parentVersionId: null, restoredFromVersionId: artifact.id, title: `${artifact.title} copy`.slice(0, 80), generatedAt: new Date().toISOString(), ...signed });
  };
  const restoreVersion = async (selected: WorkspaceArtifactV2) => {
    if (!artifact || selected.id === artifact.id) return;
    const id = crypto.randomUUID(); const signed = await refreshArtifactToken(selected, id);
    await handleWorkspace({ ...selected, id, projectId: artifact.projectId, version: Math.max(...versions.map((version) => version.version)) + 1, parentVersionId: artifact.id, restoredFromVersionId: selected.id, generatedAt: new Date().toISOString(), ...signed });
  };
  const resetDemo = async () => {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    await Promise.all(projects.map((project) => deleteWorkspaceProject(project.id)));
    setProjects([]); setVersions([]); setArtifact(null); setEntered(false);
    router.push("/");
  };
  const navigate = (next: DemoView) => navigateWithTransition(router, `/demo/${next}`);
  const askBrain = (prompt: string, source?: Exclude<DemoView, "brain">) => {
    setWidgetPrompt(prompt);
    if (source) setHandoff(createHandoff(source, prompt));
    else setHandoff(null);
    navigate("brain");
  };

  if (!hydrated || !entered || pathname === "/") return <Landing forecast={snapshot.forecast} onEnter={enterDemo} />;

  const current = navItems.find((item) => item.view === view)!;
  return (
    <div className="fd-app-shell">
      <aside className="fd-sidebar" aria-label="Primary navigation">
        <BrandLogo small />
        <nav>{navItems.map((item) => { const Icon = item.icon; return <button key={item.view} className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined} onClick={() => navigate(item.view)}><Icon size={19} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}</nav>
        <div className="fd-sidebar-foot"><button onClick={() => void resetDemo()} title="Reset demo"><Settings size={18} /><span><strong>Reset demo</strong><small>Clear local tools</small></span></button><span className="fd-avatar" title={dataset.persona.name}>{dataset.persona.initials}</span></div>
      </aside>

      <div className="fd-app-content">
        <header className="fd-topbar">
          <BrandLogo small className="fd-mobile-brand" />
          <div><span>{current.label}</span><small>{current.description}</small></div>
          <span className="fd-as-of"><CalendarDays size={13} />As of Jul 19 · Demo data</span>
        </header>

        <div className="fd-view-stage">
          {view === "brain" && (
            <main className="fd-brain-home">
              <header className="fd-brain-hero"><span className="fd-eyebrow"><Sparkles size={12} />Your financial starting point</span><h1 className="serif">Ask about your money,<br /><em>or test a decision.</em></h1><p>One place to connect spending, income, cash flow, and investments—then understand what to do next.</p></header>

              <section className="fd-brain-stage">
                {handoff && (
                  <BrainHandoffBanner handoff={handoff} onDismiss={() => setHandoff(null)} />
                )}
                <BrainGuidance
                  view="brain"
                  showChips={false}
                  disabled={false}
                  onSelectChip={(prompt) => {
                    setHandoff(null);
                    setWidgetPrompt(prompt);
                  }}
                />
                <BrainPanel
                  onWorkspace={handleWorkspace}
                  activeWorkspace={artifact}
                  initialPrompt={widgetPrompt}
                  onPromptConsumed={() => setWidgetPrompt(null)}
                  onUserSend={() => setHandoff(null)}
                  preserveHandoffBanner={Boolean(handoff)}
                />
              </section>

              <section className="fd-glance-grid" aria-label="Financial glances">
                <button onClick={() => navigate("cash-flow")}><span className="fd-glance-icon"><WalletCards size={17} /></span><small>Safe to spend</small><strong>{formatMoney(snapshot.forecast.safeToSpendNowCents)}</strong><p>Protected through Aug 18</p><ChevronRight size={15} /></button>
                <button onClick={() => navigate("portfolio")}><span className="fd-glance-icon"><BriefcaseBusiness size={17} /></span><small>Complete net worth</small><strong>{formatMoney(snapshot.netWorthCents)}</strong><p>{formatMoney(snapshot.investmentAssetsCents)} invested</p><ChevronRight size={15} /></button>
                <button onClick={() => navigate("cash-flow")}><span className="fd-glance-icon"><BarChart3 size={17} /></span><small>90-day outlook</small><strong>{cashFlow.expectedMonthlySurplusCents >= 0 ? "+" : "−"}{formatMoney(Math.abs(cashFlow.expectedMonthlySurplusCents))}</strong><p>Expected monthly surplus</p><ChevronRight size={15} /></button>
              </section>

              <section className="fd-today-brief"><div className="fd-brief-heading"><span className="fd-eyebrow">Today’s brief</span><h2>Two things worth knowing.</h2></div><article><span>01</span><div><strong>Your lowest cash point is covered.</strong><p>Checking bottoms at {formatMoney(snapshot.forecast.lowestBalanceCents)} on Jul 24, above the protected buffer.</p><button onClick={() => navigate("cash-flow")}>See the forecast</button></div></article><article><span>02</span><div><strong>Your portfolio is close to its saved target.</strong><p>The largest allocation drift is only 2.6 percentage points, in bonds.</p><button onClick={() => navigate("portfolio")}>Review allocation</button></div></article></section>

              <details className="fd-tools-drawer" ref={generatedRef} open={Boolean(artifact)}>
                <summary><span><Bot size={17} /><span><strong>My tools</strong><small>{projects.length ? `${projects.length} saved workspace${projects.length === 1 ? "" : "s"}` : "Build and save a custom financial workspace"}</small></span></span><ChevronRight size={16} /></summary>
                <div className="fd-tools-content"><WorkspaceLibrary projects={projects} activeProjectId={artifact?.projectId ?? null} versions={versions} storageWarning={storageWarning} onNew={newWorkspace} onSelect={(projectId) => void selectWorkspace(projectId)} onRename={(name) => { if (artifact) void renameWorkspaceProject(artifact.projectId, name).then(() => loadLibrary(artifact.projectId)); }} onDuplicate={() => void duplicateWorkspace()} onDelete={() => { if (!artifact || !window.confirm(`Delete ${artifact.title} and all of its versions?`)) return; void deleteWorkspaceProject(artifact.projectId).then(() => loadLibrary(null)); }} onRestore={(version) => void restoreVersion(version)} />{artifact ? <WorkspaceArtifactCard artifact={artifact} /> : <div className="fd-empty-tools"><Sparkles size={18} /><div><strong>Describe the tool you need in the Brain.</strong><p>Findex can build, test, save, and revise a custom planner or visualization.</p></div></div>}</div>
              </details>
            </main>
          )}
          {view === "spending" && <main><SpendingView dataset={dataset} onAskBrain={(prompt) => askBrain(prompt, "spending")} /></main>}
          {view === "portfolio" && <main><PortfolioView dataset={dataset} onAskBrain={(prompt) => askBrain(prompt, "portfolio")} /></main>}
          {view === "cash-flow" && <main><CashFlowView dataset={dataset} onAskBrain={(prompt) => askBrain(prompt, "cash-flow")} /></main>}
        </div>
      </div>

      <nav className="fd-mobile-nav" aria-label="Mobile navigation">{navItems.map((item) => { const Icon = item.icon; return <button key={item.view} className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined} onClick={() => navigate(item.view)}><Icon size={18} /><span>{item.label === "Financial Brain" ? "Brain" : item.label}</span></button>; })}</nav>
    </div>
  );
}
