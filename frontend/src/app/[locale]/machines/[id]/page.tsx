import MachineDetailPage from '@/components/machine-timeline/MachineDetailPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MachineDetailPage machineId={id} />;
}
