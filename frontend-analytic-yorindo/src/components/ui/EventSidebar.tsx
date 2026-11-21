import type { Dispatch, SetStateAction } from "react";
import {
  BarChart3,
  ClipboardList,
  Info,
  MessageSquareText,
  ScanLine,
  Users,
  type LucideIcon,
} from "lucide-react";
import WorkspaceSidebar from "@/components/ui/WorkspaceSidebar";
import { usePermission } from "@/hooks/usePermission";

type SidebarProps = {
  eventId: string;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
};

type EventWorkspaceItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
};

export default function EventSidebar({
  eventId,
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
}: SidebarProps) {
  const resolvedEventId = eventId || "unknown";
  const canViewParticipants = usePermission("registrations:view");
  const canCheckIn = usePermission("registrations:checkin");

  const items: EventWorkspaceItem[] = [
    {
      label: "Event Detail",
      to: `/events/${resolvedEventId}`,
      icon: Info,
      end: true,
    },
    ...(canViewParticipants
      ? [
          {
            label: "Participants",
            to: `/events/${resolvedEventId}/participants`,
            icon: Users,
          },
        ]
      : []),
    ...(canCheckIn
      ? [
          {
            label: "Check-In Desk",
            to: `/events/${resolvedEventId}/check-in`,
            icon: ScanLine,
          },
        ]
      : []),
    {
      label: "Event Analytics",
      to: `/events/${resolvedEventId}/analytics`,
      icon: BarChart3,
    },
    {
      label: "Survey Analytics",
      to: `/events/${resolvedEventId}/survey-analytics`,
      icon: ClipboardList,
    },
    {
      label: "Feedback Analytics",
      to: `/events/${resolvedEventId}/feedback-analytics`,
      icon: MessageSquareText,
    },
  ];

  return (
    <WorkspaceSidebar
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      mobileOpen={mobileOpen}
      setMobileOpen={setMobileOpen}
      title="Event Workspace"
      eyebrow="Detail & Analytics"
      items={items}
    />
  );
}
