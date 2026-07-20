import type { ReactNode } from "react";
import { FinDexApp } from "@/components/dashboard/findex-app";
import { demoData, getFinancialSnapshot } from "@/lib/finance/engine";

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <FinDexApp dataset={demoData} snapshot={getFinancialSnapshot()} />
      {children}
    </>
  );
}
