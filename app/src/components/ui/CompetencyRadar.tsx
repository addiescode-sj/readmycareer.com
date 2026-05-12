"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Legend,
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

export interface RadarPoint {
  name: string;
  // Legacy single-score format (backward compat with old data)
  score?: number;
  // Dual-score format for required vs preferred distinction
  requiredScore?: number;
  preferredScore?: number;
}

interface Props {
  data: RadarPoint[];
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

  // Normalize data: if only `score` is present, project it to both axes
  const normalizedData = data.map(d => ({
    name: d.name,
    requiredScore: d.requiredScore ?? d.score ?? 0,
    preferredScore: d.preferredScore ?? d.score ?? 0,
  }));

  const isDual = data.some(d => d.requiredScore !== undefined || d.preferredScore !== undefined);

  return (
    <div className="relative w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius={outerRadius} data={normalizedData} margin={margin}>
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
          {/* Preferred (bonus) — dashed, lighter, rendered first so it sits behind */}
          {isDual && (
            <Radar
              name={t("radarLegendPreferred")}
              dataKey="preferredScore"
              stroke="hsl(var(--secondary))"
              fill="hsl(var(--secondary))"
              fillOpacity={0.08}
              strokeDasharray="4 3"
              strokeWidth={1.5}
            />
          )}
          {/* Required (must-have) — solid, primary color, rendered on top */}
          <Radar
            name={isDual ? t("radarLegendRequired") : t("radarLegendScore")}
            dataKey="requiredScore"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.15}
            strokeWidth={2}
          />
          {isDual && (
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }}
            />
          )}
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
