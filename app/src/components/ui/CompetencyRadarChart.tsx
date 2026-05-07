"use client";

import React from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip
} from "recharts";
import { AlertCircle, CheckCircle2, ChevronRight, Info } from "lucide-react";

export interface CompetencyData {
  subject: string;
  userScore: number;
  requiredScore: number;
  fullMark: number;
}

export interface Finding {
  id: string;
  category: string;
  priority: "High" | "Medium" | "Low";
  message: string;
  evidence: string;
}

interface Props {
  data: CompetencyData[];
  findings: Finding[];
}

export const CompetencyRadarChart: React.FC<Props> = ({ data, findings }) => {
  const priorityColor = (priority: string) => {
    switch (priority) {
      case "High": return "text-destructive bg-destructive/10 border-destructive/20";
      case "Medium": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
      case "Low": return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
      default: return "text-primary bg-primary/10 border-primary/20";
    }
  };

  const priorityIcon = (priority: string) => {
    switch (priority) {
      case "High": return <AlertCircle className="w-4 h-4 text-destructive" />;
      case "Medium": return <Info className="w-4 h-4 text-amber-500" />;
      case "Low": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      default: return null;
    }
  };

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
      {/* Radar Chart */}
      <div className="w-full aspect-square md:aspect-auto md:h-[400px] flex items-center justify-center p-6 bg-card border rounded-2xl shadow-sm">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis 
              dataKey="subject" 
              tick={{ fill: "hsl(var(--foreground))", fontSize: 12, fontWeight: 500 }} 
            />
            <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
            <Radar
              name="Required (JD)"
              dataKey="requiredScore"
              stroke="hsl(var(--muted-foreground))"
              fill="hsl(var(--muted-foreground))"
              fillOpacity={0.1}
              strokeDasharray="4 4"
            />
            <Radar
              name="Current (You)"
              dataKey="userScore"
              stroke="#8B5CF6"
              fill="#8B5CF6"
              fillOpacity={0.4}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Evidence-Based Findings */}
      <div className="flex flex-col space-y-4">
        <h3 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          Evidence-Based Findings
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Priority-coded gaps identified directly from the Job Description.
        </p>

        <div className="space-y-3">
          {findings.map((finding) => (
            <div 
              key={finding.id} 
              className="p-4 bg-card border rounded-xl flex flex-col gap-2 shadow-sm transition-all hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{finding.category}</span>
                <span className={`text-xs px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${priorityColor(finding.priority)}`}>
                  {priorityIcon(finding.priority)}
                  {finding.priority} Priority
                </span>
              </div>
              <p className="text-sm text-foreground/90 mt-1">{finding.message}</p>
              
              <div className="mt-2 p-3 bg-muted/50 rounded-lg border border-border/50 text-xs text-muted-foreground flex items-start gap-2">
                <ChevronRight className="w-3 h-3 mt-0.5 text-primary flex-shrink-0" />
                <span className="italic leading-relaxed">"{finding.evidence}"</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
