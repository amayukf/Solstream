import { redirect } from "next/navigation";

export default async function TipRedirectPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  redirect(`/${encodeURIComponent(username.trim().toLowerCase())}`);
}
