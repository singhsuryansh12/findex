import { FinDexApp } from "@/components/dashboard/findex-app";
import { demoData, getFinancialSnapshot } from "@/lib/finance/engine";

export const dynamic = "force-static";

export default function Home() {
  return <FinDexApp dataset={demoData} snapshot={getFinancialSnapshot()} />;
}
