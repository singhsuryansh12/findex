"use client";

import { SandpackLayout, SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import type { WidgetArtifact } from "@/lib/widgets/contracts";

const widgetKitSource = `import React from "react";
export function Panel({ children }) { return <section className="widget-panel">{children}</section>; }
export function Stat({ label, value, tone }) { return <div className={"widget-stat " + (tone || "")}><span>{label}</span><strong>{value}</strong></div>; }
export function Field({ label, value, children }) { return <label className="widget-field"><span><b>{label}</b><output>{value}</output></span>{children}</label>; }
export function Slider({ value, onChange, ...props }) { return <input aria-label="Adjust value" type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} {...props}/>; }
export function Select({ value, onChange, children }) { return <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>; }
export function Progress({ value, label }) { return <div className="widget-progress"><div><span>Projection progress</span><span>{label}</span></div><div className="progress-track"><i style={{ width: Math.max(0, Math.min(100, value)) + "%" }}/></div></div>; }
`;

const previewStyles = `
*{box-sizing:border-box} body{margin:0;background:#fbfaf6;color:#17231d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif} button,input,select{font:inherit}.widget-panel{padding:26px;min-height:410px}.widget-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}.eyebrow{text-transform:uppercase;color:#2e765d;letter-spacing:.14em;font-weight:750;font-size:10px}.widget-heading h2{font-family:Georgia,serif;font-size:34px;font-weight:400;letter-spacing:-.04em;margin:5px 0 4px}.widget-heading p{font-size:12px;color:#748078;margin:0;max-width:480px}.target-pill{white-space:nowrap;background:#e1ece6;color:#2e765d;border-radius:999px;padding:8px 11px;font-size:10px;font-weight:700}.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.widget-stat{border:1px solid #e5e6e1;border-radius:15px;background:#fff;padding:14px}.widget-stat span{display:block;color:#818b85;font-size:10px}.widget-stat strong{display:block;font-size:20px;letter-spacing:-.04em;margin-top:7px}.widget-stat.positive strong{color:#2e765d}.widget-progress{margin:17px 0}.widget-progress>div:first-child{display:flex;justify-content:space-between;color:#738078;font-size:9px;margin-bottom:7px}.progress-track{height:6px;border-radius:999px;background:#e8ebe7;overflow:hidden}.progress-track i{height:100%;display:block;border-radius:inherit;background:linear-gradient(90deg,#2e765d,#65a286)}.widget-body{display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;align-items:center}.controls{display:flex;flex-direction:column;gap:14px}.widget-field>span{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px;font-size:10px}.widget-field b{font-weight:650}.widget-field output{color:#2e765d;font-variant-numeric:tabular-nums}.widget-field input[type=range]{width:100%;accent-color:#2e765d}.chart-wrap{min-width:0}.recharts-text{font-size:9px;fill:#7f8b84}@media(max-width:600px){.widget-panel{padding:20px}.widget-heading{display:block}.target-pill{display:inline-block;margin-top:12px}.stat-grid{grid-template-columns:1fr}.widget-body{grid-template-columns:1fr}.chart-wrap{min-height:260px}}
`;

export function WidgetSandbox({ artifact }: { artifact: WidgetArtifact }) {
  const files = {
    "/App.tsx": { code: `import React from "react";\nimport GeneratedWidget from "./GeneratedWidget";\nimport { data } from "./data";\nimport "./styles.css";\nexport default function App(){return <GeneratedWidget data={data}/>;}` },
    "/GeneratedWidget.tsx": { code: artifact.source, active: true },
    "/widget-kit.tsx": { code: widgetKitSource, hidden: true },
    "/data.ts": { code: `export const data = ${JSON.stringify(artifact.props)};`, hidden: true },
    "/styles.css": { code: previewStyles, hidden: true },
  };

  return (
    <SandpackProvider
      template="react-ts"
      files={files}
      customSetup={{ entry: "/App.tsx", dependencies: { recharts: "^3.9.2" } }}
      options={{ activeFile: "/GeneratedWidget.tsx", externalResources: [], recompileMode: "delayed", recompileDelay: 300 }}
      theme="light"
    >
      <SandpackLayout style={{ border: 0, borderRadius: 0, background: "#fbfaf6" }}>
        <SandpackPreview showNavigator={false} showRefreshButton={false} showOpenInCodeSandbox={false} style={{ minHeight: 430 }} />
      </SandpackLayout>
    </SandpackProvider>
  );
}
