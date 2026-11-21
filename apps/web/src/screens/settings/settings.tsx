import {
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
} from "@cota/ui/components/page";
import { Tabs, TabsItem } from "@cota/ui/components/tabs";
import { Link, Outlet, useLocation } from "@tanstack/react-router";

const parts = [
  { to: "/settings/names", label: "Display names" },
  { to: "/settings/sign-ins", label: "Sign-ins" },
  { to: "/settings/quota-logins", label: "Quota logins" },
  { to: "/settings/routes", label: "Routes" },
] as const;

/** Settings: its header, its four parts as tabs kept in the path, and the part open. */
export function Settings() {
  const { pathname } = useLocation();
  return (
    <Page className="@container">
      <PageHeader>
        <div>
          <PageTitle>Settings</PageTitle>
          <PageDescription>
            What the hub store keeps: display names, the owner's sign-ins, the
            pools' quota logins and the routes.
          </PageDescription>
        </div>
      </PageHeader>
      <Tabs aria-label="Settings" className="mb-5">
        {parts.map((part) => (
          <TabsItem
            key={part.to}
            current={pathname === part.to}
            render={<Link to={part.to} />}
          >
            {part.label}
          </TabsItem>
        ))}
      </Tabs>
      <Outlet />
    </Page>
  );
}
