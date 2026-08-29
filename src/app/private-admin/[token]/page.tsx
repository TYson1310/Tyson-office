import { BRAND } from "@/lib/brand";
import { notFound } from "next/navigation";
import {
  hasPrivateAdminSession,
  matchesPrivateAdminLinkToken,
} from "@/lib/private-admin-portal";
import { PrivateAdminPortal } from "./private-admin-portal";

type Params = Promise<{ token: string }>;

export const dynamic = "force-dynamic";

export const metadata = {
  title: BRAND.controlRoomLabel,
  robots: {
    index: false,
    follow: false,
  },
};

export default async function PrivateAdminPortalPage({
  params,
}: {
  params: Params;
}) {
  const { token } = await params;

  if (!matchesPrivateAdminLinkToken(token)) {
    notFound();
  }

  const isAuthorized = await hasPrivateAdminSession(token);

  return <PrivateAdminPortal routeToken={token} isAuthorized={isAuthorized} />;
}
