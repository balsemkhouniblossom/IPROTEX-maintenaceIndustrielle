import { redirect } from "next/navigation";

export default async function PanneSolutionsRedirect({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  redirect(`/${locale}/pannes`);
}
