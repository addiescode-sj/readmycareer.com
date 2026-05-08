"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import AppSidebar from "./AppSidebar";
import { Logo } from "../ui/Logo";

const MOBILE_BREAKPOINT = 1024;

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setOpen(false);
      } else {
        setOpen(true);
      }
    };

    handleChange(mq);
    mq.addEventListener("change", handleChange);

    const handleChatState = (e: Event) => {
      const customEvent = e as CustomEvent<{ open: boolean }>;
      if (customEvent.detail.open && window.innerWidth < MOBILE_BREAKPOINT) {
        setOpen(false);
      }
    };
    window.addEventListener("mobile-chat-state", handleChatState);

    return () => {
      mq.removeEventListener("change", handleChange);
      window.removeEventListener("mobile-chat-state", handleChatState);
    };
  }, []);

  useEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT) {
      setOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mobile-sidebar-state", { detail: { open } }));
  }, [open]);

  return (
    <div className="flex h-screen w-full min-w-0 overflow-hidden bg-background">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <AppSidebar open={open} onToggle={() => setOpen((v) => !v)} />

      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-muted/30 no-scrollbar">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-border/50 bg-white/80 backdrop-blur-xl sticky top-0 z-30">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-xl hover:bg-muted transition-colors text-foreground"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Logo size={28} className="rounded-xl shadow-sm" />
          <span className="font-black text-sm tracking-tight text-foreground">readmycareer</span>
        </div>

        <div className="min-h-full p-6 lg:p-12">
          <div className="max-w-[1400px] mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
