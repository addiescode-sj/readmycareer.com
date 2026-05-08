"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";

interface RadarAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  onHover: (name: string | null, x: number, y: number) => void;
  descriptions: Record<string, string>;
}

function RadarAxisTick({ x = 0, y = 0, payload, onHover, descriptions }: RadarAxisTickProps) {
  const name = payload?.value ?? "";
  const hasDesc = Boolean(descriptions[name]);
  return (
    <g
      onMouseEnter={() => hasDesc && onHover(name, x, y)}
      onMouseLeave={() => onHover(null, 0, 0)}
      style={{ cursor: hasDesc ? "help" : "default" }}
    >
      <text
        x={x}
        y={y}
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
        fontWeight={600}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {name}
      </text>
    </g>
  );
}

interface Props {
  data: Array<{ name: string; score: number }>;
  height?: number;
  outerRadius?: string;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
}

export function CompetencyRadar({ data, height = 240, outerRadius = "75%", margin }: Props) {
  const t = useTranslations("CareerProfile");

  const [radarTooltip, setRadarTooltip] = useState<{
    name: string; x: number; y: number;
  } | null>(null);

  const radarDescriptions = useMemo<Record<string, string>>(() => ({
    Skill: t("radarTooltipSkill"),
    Experience: t("radarTooltipExperience"),
    Keyword: t("radarTooltipKeyword"),
    Portfolio: t("radarTooltipPortfolio"),
    Cert: t("radarTooltipCert"),
  }), [t]);

  const handleAxisHover = useCallback(
    (name: string | null, x: number, y: number) => {
      setRadarTooltip(name ? { name, x, y } : null);
    },
    []
  );

  return (
    <div className="relative w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius={outerRadius} data={data} margin={margin}>
          <PolarGrid stroke="rgba(139,92,246,0.1)" />
          <PolarAngleAxis
            dataKey="name"
            tick={
              <RadarAxisTick
                onHover={handleAxisHover}
                descriptions={radarDescriptions}
              />
            }
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.15}
          />
        </RadarChart>
      </ResponsiveContainer>
      {radarTooltip && (
        <div
          className="absolute z-10 pointer-events-none w-44 text-xs bg-popover text-popover-foreground border border-border rounded-lg px-3 py-2 shadow-md"
          style={{
            left: radarTooltip.x,
            top: radarTooltip.y,
            transform: "translate(-50%, -115%)",
          }}
        >
          <p className="font-semibold text-foreground mb-0.5">{radarTooltip.name}</p>
          <p className="text-muted-foreground leading-snug">{radarDescriptions[radarTooltip.name]}</p>
        </div>
      )}
    </div>
  );
}
