"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Map,
  User,
  MessageSquare,
  PlusCircle,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { Logo } from "@/components/ui/Logo";
import { clearPlanSaveState } from "@/lib/plan-save-session";

interface Props {
  open: boolean;
  onToggle: () => void;
}

export default function AppSidebar({ open, onToggle }: Props) {
  const t = useTranslations("AppSidebar");
  const pathname = usePathname();

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard },
    { href: "/dashboard/roadmap", label: t("roadmap"), icon: Map },
    { href: "/dashboard/profile", label: t("profile"), icon: User },
    { href: "/dashboard/history", label: t("history"), icon: MessageSquare },
  ];

  return (
    <aside
      className={cn(
        "h-screen border-r border-border/50 bg-background lg:bg-white/50 backdrop-blur-xl flex flex-col shrink-0 transition-transform duration-300 overflow-hidden z-50",
        // Mobile: fixed overlay; Desktop: sticky in flow
        "fixed top-0 left-0 lg:sticky",
        // Mobile: slide in/out; Desktop: always translated to 0
        open ? "translate-x-0 shadow-2xl lg:shadow-none" : "-translate-x-full lg:translate-x-0",
        // Width: mobile always full, desktop collapses to icon-only
        "w-72",
        !open && "lg:w-[72px]",
      )}
    >
      {/* Logo + collapse toggle */}
      <div
        className={cn(
          "flex items-center justify-between px-6 py-6 shrink-0",
          !open && "lg:flex-col lg:items-center lg:gap-3 lg:px-3 lg:py-5",
        )}
      >
        <Link href="/" className={cn("flex items-center gap-3 group min-w-0", !open && "lg:gap-0")}>
          <Logo size={40} className="group-hover:scale-105" />
          <div
            className={cn(
              "overflow-hidden transition-all duration-300",
              !open ? "lg:w-0 lg:opacity-0 lg:pointer-events-none" : "opacity-100",
            )}
          >
            <h1 className="font-black text-foreground text-sm leading-none tracking-tight whitespace-nowrap">readmycareer</h1>
          </div>
        </Link>

        {/* Desktop collapse toggle */}
        <button
          onClick={onToggle}
          className="hidden lg:flex w-6 h-6 rounded-full border border-border/70 bg-background items-center justify-center hover:bg-muted hover:border-primary/30 transition-all shrink-0"
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          {open
            ? <ChevronLeft className="w-3 h-3 text-muted-foreground" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        </button>

        {/* Mobile close button */}
        <button
          onClick={onToggle}
          className="lg:hidden flex w-8 h-8 rounded-xl items-center justify-center hover:bg-muted transition-all shrink-0"
          aria-label="Close sidebar"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {/* New Plan button */}
      <div className={cn("px-4 mb-6 shrink-0", !open && "lg:px-3")}>
        <button
          onClick={() => {
            sessionStorage.removeItem("rmc_session");
            clearPlanSaveState();
            window.location.href = "/?new=true";
          }}
          title={!open ? t("newPlan") : undefined}
          className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl bg-foreground text-background text-sm font-black uppercase tracking-widest shadow-xl shadow-foreground/10 hover:opacity-90 transition-all"
        >
          <PlusCircle className="w-4 h-4 shrink-0" />
          <span className={cn("whitespace-nowrap transition-all duration-300", !open && "lg:hidden")}>
            {t("newPlan")}
          </span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        <p
          className={cn(
            "text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-4 mb-3 whitespace-nowrap",
            !open && "lg:hidden",
          )}
        >
          Core Systems
        </p>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={!open ? item.label : undefined}
              className={cn(
                "flex items-center gap-4 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all group",
                isActive
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-primary/5 hover:text-primary",
                !open && "lg:justify-center lg:px-0",
              )}
            >
              <Icon
                className={cn(
                  "w-5 h-5 shrink-0 transition-transform group-hover:scale-110",
                  isActive ? "text-primary-foreground" : "text-muted-foreground/50",
                )}
              />
              <span className={cn("whitespace-nowrap", !open && "lg:hidden")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn("p-6 mt-auto space-y-2 shrink-0", !open && "lg:px-3 lg:py-4")}>
        <div className="pt-4 border-t border-border/50">
          <SignOutButton
            showLabel={open}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-sm font-bold text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all",
              !open && "lg:justify-center lg:px-0",
            )}
          />
        </div>
      </div>
    </aside>
  );
}
