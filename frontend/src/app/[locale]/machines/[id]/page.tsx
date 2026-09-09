import MachineDetailPage from '@/components/machine-timeline/MachineDetailPage';

export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}>) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  return <MachineDetailPage machineId={id} returnTo={returnTo} />;
}
