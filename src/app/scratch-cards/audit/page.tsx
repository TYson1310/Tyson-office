import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { ScratchCardBinManager } from "@/components/scratch-cards/audit-screen";
import { loadScratchAuditScreenData } from "@/lib/scratch-cards/data";

export const metadata: Metadata = {
  title: "Scratch Cards",
};

export default async function ScratchCardAuditPage() {
  const auditData = await loadScratchAuditScreenData();

  return (
    <>
      <Breadcrumb pageName="Scratch Cards" />
      <ScratchCardBinManager
        backstockPacks={auditData.backstockPacks}
        bins={auditData.bins}
        binCount={auditData.binCount}
        source={auditData.source}
        errorMessage={auditData.errorMessage}
      />
    </>
  );
}
