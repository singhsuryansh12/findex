import type { ReactNode } from "react";
export function Panel({ children }: { children: ReactNode }) { return <section>{children}</section>; }
export function Stat({ label, value }: { label: string; value: string; tone?: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
export function Field({ label, value, children }: { label: string; value: string; children: ReactNode }) { return <label><span>{label}</span><output>{value}</output>{children}</label>; }
export function Slider({ value, onChange, ...props }: { value: number; onChange: (value: number) => void; min: number; max: number; step: number }) { return <input aria-label="Adjust value" type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} {...props}/>; }
export function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) { return <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>; }
export function Progress({ value, label }: { value: number; label: string }) { return <div role="progressbar" aria-valuenow={value}>{label}</div>; }
