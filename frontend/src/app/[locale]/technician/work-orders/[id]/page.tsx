import TechnicianWorkOrderDetail from "@/components/technician/TechnicianWorkOrderDetail";
export default async function Page({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  return <TechnicianWorkOrderDetail id={id} />;
}
