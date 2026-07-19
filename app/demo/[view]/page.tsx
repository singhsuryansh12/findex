import { notFound } from "next/navigation";
import { FinDexApp } from "@/components/dashboard/findex-app";
import { demoData, getFinancialSnapshot } from "@/lib/finance/engine";

export const dynamic = "force-static";

export function generateStaticParams() {
  return ["brain", "spending", "portfolio", "cash-flow"].map((view) => ({ view }));
}

export default async function DemoView({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!new Set(["brain", "spending", "portfolio", "cash-flow"]).has(view)) notFound();
  return <FinDexApp dataset={demoData} snapshot={getFinancialSnapshot()} />;
}
