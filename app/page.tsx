import Script from "next/script";
import DashboardClient from "./dashboard-client";

export default function Page() {
  return (
    <>
      <Script src="/vendor/xlsx.full.min.js" strategy="afterInteractive" />
      <DashboardClient />
    </>
  );
}
