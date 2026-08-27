"use client";

import DashboardLayout from "@/components/DashboardLayout";
import FactoryTwinScene from "@/components/digital-twin/FactoryTwinScene";

export default function DigitalTwinPage() {
  return (
    <DashboardLayout title="Digital Twin">
      <FactoryTwinScene />
    </DashboardLayout>
  );
}
