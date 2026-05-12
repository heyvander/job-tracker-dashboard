"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ResponsiveSankey } from "@nivo/sankey";

export type TransitionRow = { from: string; to: string; count: number };

type Props = {
  rows: TransitionRow[];
  /** Jobs touching each stage (same semantics as node click inspect). */
  nodeJobCounts?: Record<string, number>;
  stageRank: (name: string) => number;
  stageColors: Record<string, string>;
  /** Tap a bundle (stage) — list jobs touching that stage. */
  onInspectNode?: (nodeId: string) => void;
  /** Tap a flow between two stages. */
  onInspectLink?: (from: string, to: string) => void;
};

function subscribePrefersDark(callback: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getPrefersDarkSnapshot() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getPrefersDarkServerSnapshot() {
  return false;
}

function usePrefersDark() {
  return useSyncExternalStore(
    subscribePrefersDark,
    getPrefersDarkSnapshot,
    getPrefersDarkServerSnapshot,
  );
}

export function JourneySankey({
  rows,
  nodeJobCounts,
  stageRank,
  stageColors,
  onInspectNode,
  onInspectLink,
}: Props) {
  const prefersDark = usePrefersDark();

  const data = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.from);
      ids.add(r.to);
    }
    const sorted = [...ids].sort((a, b) => {
      const d = stageRank(a) - stageRank(b);
      if (d !== 0) return d;
      return a.localeCompare(b);
    });

    const nodes = sorted.map((id) => ({ id }));
    const links = rows.map((r) => ({
      source: r.from,
      target: r.to,
      value: r.count,
    }));
    return { nodes, links };
  }, [rows, stageRank]);

  const nodeColorFn = useMemo(() => {
    return (node: { id?: string }) =>
      stageColors[node.id ?? ""] ?? stageColors.Unknown ?? "#64748b";
  }, [stageColors]);

  const theme = useMemo(
    () => ({
      tooltip: prefersDark
        ? {
            container: {
              background: "#fafafa",
              color: "#18181b",
              fontSize: 12,
              borderRadius: 8,
              boxShadow:
                "0 4px 6px -1px rgb(0 0 0 / 0.25), 0 2px 4px -2px rgb(0 0 0 / 0.2)",
            },
          }
        : {
            container: {
              background: "#18181b",
              color: "#fafafa",
              fontSize: 12,
              borderRadius: 8,
            },
          },
      labels: {
        text: {
          fontSize: 11,
          fontWeight: 500 as const,
          fill: prefersDark ? "#e4e4e7" : "#3f3f46",
          outlineWidth: 0,
          outlineColor: "transparent",
        },
      },
    }),
    [prefersDark],
  );

  const labelTextColor = prefersDark ? "#cbd5e1" : "#52525b";

  const handleInteractiveClick = (datum: unknown) => {
    if (!onInspectNode && !onInspectLink) return;
    if (
      datum &&
      typeof datum === "object" &&
      "sourceLinks" in datum &&
      "targetLinks" in datum &&
      "id" in datum
    ) {
      onInspectNode?.(String((datum as { id: string }).id));
      return;
    }
    if (datum && typeof datum === "object" && "source" in datum && "target" in datum) {
      const link = datum as { source?: { id?: string }; target?: { id?: string } };
      const from = link.source?.id;
      const to = link.target?.id;
      if (from && to) onInspectLink?.(from, to);
    }
  };

  if (!rows.length) return null;

  return (
    <div
      className={`w-full rounded-lg border px-1 py-3 ${
        prefersDark
          ? "border-zinc-700/80 bg-zinc-950/80"
          : "border-zinc-200 bg-zinc-50/90"
      }`}
      style={{ height: "clamp(340px, 50vh, 520px)" }}
    >
      <ResponsiveSankey
        data={data}
        margin={{ top: 28, right: 140, bottom: 28, left: 20 }}
        align="justify"
        sort="input"
        layout="horizontal"
        valueFormat=".0f"
        colors={nodeColorFn}
        theme={theme}
        nodeOpacity={1}
        nodeHoverOthersOpacity={0.35}
        nodeThickness={14}
        nodeInnerPadding={2}
        nodeSpacing={20}
        nodeBorderWidth={0}
        nodeBorderRadius={3}
        linkOpacity={0.45}
        linkHoverOpacity={0.85}
        linkHoverOthersOpacity={0.12}
        linkContract={2}
        linkBlendMode="normal"
        enableLinkGradient
        enableLabels
        label={(node) => {
          const id = String(node.id);
          const n = nodeJobCounts?.[id];
          return n !== undefined ? `${id} (${n})` : id;
        }}
        labelPosition="outside"
        labelOrientation="horizontal"
        labelPadding={10}
        labelTextColor={labelTextColor}
        isInteractive={Boolean(onInspectNode || onInspectLink)}
        onClick={handleInteractiveClick}
        animate
        motionConfig="gentle"
      />
    </div>
  );
}
