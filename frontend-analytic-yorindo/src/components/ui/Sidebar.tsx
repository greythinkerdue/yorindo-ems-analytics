import type { Dispatch, SetStateAction } from "react";
import {
  CalendarDays,
  Clock3,
  LayoutDashboard,
  Mail,
  UsersRound,
} from "lucide-react";
import WorkspaceSidebar from "@/components/ui/WorkspaceSidebar";
import { useAuth } from "@/hooks/useAuth";
import { usePermission } from "@/hooks/usePermission";

type SidebarProps = {
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
};

export default function Sidebar(props: SidebarProps) {
  const { user } = useAuth();
  const canCommunicate = usePermission("communication:view");
  const isSuperAdmin = user?.role === "super_admin";

  return (
    <WorkspaceSidebar
      {...props}
      title="Yorindo EMS"
      eyebrow="Exhibition Management"
      items={[
        {
          label: "Dashboard",
          to: "/dashboard",
          icon: LayoutDashboard,
          end: true,
        },
        {
          label: "Event",
          to: "/events",
          icon: CalendarDays,
          end: true,
        },
        ...(canCommunicate
          ? [
              {
                label: "Communication",
                to: "/communication",
                icon: Mail,
                end: true,
              },
              {
                label: "Campaign History",
                to: "/communication/history",
                icon: Clock3,
                end: true,
              },
            ]
          : []),
        ...(isSuperAdmin
          ? [
              {
                label: "Users",
                to: "/users",
                icon: UsersRound,
                end: true,
              },
            ]
          : []),
      ]}
    />
  );
}
