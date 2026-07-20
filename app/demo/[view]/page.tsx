import { notFound } from "next/navigation";

export const dynamic = "force-static";

export function generateStaticParams() {
  return ["brain", "spending", "portfolio", "cash-flow"].map((view) => ({ view }));
}

export default async function DemoView({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!new Set(["brain", "spending", "portfolio", "cash-flow"]).has(view)) notFound();
  return null;
}
