import Dashboard from "../Dashboard";

export default async function RootPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  return <Dashboard locale={locale} />;
}
