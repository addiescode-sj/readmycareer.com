import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: number;
  animate?: boolean;
}

export function Logo({ className, size = 40, animate = false }: LogoProps) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-2xl overflow-hidden transition-all duration-300 bg-white shadow-sm",
        animate && "animate-pulse",
        className
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src="/logo.svg"
        alt="readmycareer logo"
        width={size}
        height={size}
        className="w-full h-full object-cover"
        priority
      />
    </div>
  );
}
