"use client";

import { useMemo } from "react";

// ── Types ──────────────────────────────────────────────────
export interface DiagramNode {
    id: string;
    label: string;
    type?: string;
}

export interface DiagramEdge {
    from: string;
    to: string;
    label?: string;
}

export interface DiagramData {
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    notes?: string[];
}

interface Props {
    diagram: DiagramData;
}

// ── Style per node-type ────────────────────────────────────
const TYPE_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    client: { bg: "#eff6ff", border: "#60a5fa", text: "#1e40af", icon: "person" },
    service: { bg: "#ecfdf5", border: "#34d399", text: "#065f46", icon: "memory" },
    cache: { bg: "#fff7ed", border: "#fb923c", text: "#9a3412", icon: "bolt" },
    db: { bg: "#fef2f2", border: "#f87171", text: "#991b1b", icon: "database" },
    database: { bg: "#fef2f2", border: "#f87171", text: "#991b1b", icon: "database" },
    queue: { bg: "#faf5ff", border: "#c084fc", text: "#6b21a8", icon: "queue" },
    storage: { bg: "#f0f9ff", border: "#38bdf8", text: "#0c4a6e", icon: "save" },
    cdn: { bg: "#f5f3ff", border: "#a78bfa", text: "#5b21b6", icon: "public" },
    default: { bg: "#f8fafc", border: "#94a3b8", text: "#0f172a", icon: "widgets" },
};

const DARK_TYPE_STYLES: Record<string, { bg: string; border: string; text: string }> = {
    client: { bg: "#1e3a5f33", border: "#60a5fa", text: "#bfdbfe" },
    service: { bg: "#04482733", border: "#34d399", text: "#a7f3d0" },
    cache: { bg: "#7c2d1233", border: "#fb923c", text: "#fed7aa" },
    db: { bg: "#7f1d1d33", border: "#f87171", text: "#fecaca" },
    database: { bg: "#7f1d1d33", border: "#f87171", text: "#fecaca" },
    queue: { bg: "#581c8733", border: "#c084fc", text: "#e9d5ff" },
    storage: { bg: "#0c4a6e33", border: "#38bdf8", text: "#bae6fd" },
    cdn: { bg: "#4c1d9533", border: "#a78bfa", text: "#ddd6fe" },
    default: { bg: "#33333333", border: "#64748b", text: "#e2e8f0" },
};

function getStyle(type: string | undefined, isDark: boolean) {
    const key = (type || "default").toLowerCase();
    const light = TYPE_STYLES[key] || TYPE_STYLES.default;
    if (!isDark) return light;
    const dark = DARK_TYPE_STYLES[key] || DARK_TYPE_STYLES.default;
    return { ...light, bg: dark.bg, border: dark.border, text: dark.text };
}

// ── Layered layout (Sugiyama-lite) ─────────────────────────
function layoutNodes(nodes: DiagramNode[], edges: DiagramEdge[]) {
    const idToNode = new Map(nodes.map((n) => [n.id, n]));
    const incoming = new Map<string, Set<string>>();
    const outgoing = new Map<string, Set<string>>();
    for (const n of nodes) {
        incoming.set(n.id, new Set());
        outgoing.set(n.id, new Set());
    }
    for (const e of edges) {
        if (idToNode.has(e.from) && idToNode.has(e.to) && e.from !== e.to) {
            outgoing.get(e.from)!.add(e.to);
            incoming.get(e.to)!.add(e.from);
        }
    }

    // Layer assignment: node's layer = 1 + max(layer of upstream nodes).
    // Roots (no incoming edges) sit at layer 0. To handle cycles, cap iterations.
    const layer = new Map<string, number>();
    nodes.forEach((n) => layer.set(n.id, 0));

    let changed = true;
    let iterations = 0;
    while (changed && iterations < nodes.length + 5) {
        changed = false;
        iterations++;
        for (const n of nodes) {
            const ups = incoming.get(n.id)!;
            let maxUp = -1;
            for (const u of ups) {
                const lu = layer.get(u) ?? 0;
                if (lu > maxUp) maxUp = lu;
            }
            const desired = maxUp + 1;
            if (desired !== (layer.get(n.id) ?? 0) && desired > (layer.get(n.id) ?? 0)) {
                layer.set(n.id, desired);
                changed = true;
            }
        }
    }

    // Group by layer
    const layers: string[][] = [];
    for (const n of nodes) {
        const l = layer.get(n.id) ?? 0;
        if (!layers[l]) layers[l] = [];
        layers[l].push(n.id);
    }

    return { layers, layer };
}

const NODE_W = 180;
const NODE_H = 78;
const COL_GAP = 110;
const ROW_GAP = 36;
const PAD = 24;

interface PositionedNode extends DiagramNode {
    x: number;
    y: number;
    w: number;
    h: number;
}

export default function ArchitectureDiagram({ diagram }: Props) {
    const { positioned, width, height, edges } = useMemo(() => {
        const nodes = diagram?.nodes || [];
        const edges = diagram?.edges || [];
        if (nodes.length === 0) {
            return { positioned: new Map<string, PositionedNode>(), width: 0, height: 0, edges: [] };
        }

        const { layers } = layoutNodes(nodes, edges);
        const numCols = layers.length;
        const maxRows = Math.max(...layers.map((l) => l.length));

        const width = PAD * 2 + numCols * NODE_W + (numCols - 1) * COL_GAP;
        const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

        const positioned = new Map<string, PositionedNode>();
        const idToNode = new Map(nodes.map((n) => [n.id, n]));

        for (let col = 0; col < layers.length; col++) {
            const ids = layers[col];
            const colHeight = ids.length * NODE_H + (ids.length - 1) * ROW_GAP;
            const yStart = PAD + (height - 2 * PAD - colHeight) / 2;
            for (let row = 0; row < ids.length; row++) {
                const id = ids[row];
                const node = idToNode.get(id)!;
                positioned.set(id, {
                    ...node,
                    x: PAD + col * (NODE_W + COL_GAP),
                    y: yStart + row * (NODE_H + ROW_GAP),
                    w: NODE_W,
                    h: NODE_H,
                });
            }
        }

        return { positioned, width, height, edges };
    }, [diagram]);

    if (!diagram || !diagram.nodes || diagram.nodes.length === 0) {
        return (
            <div className="text-sm text-slate-500 dark:text-slate-400 italic">
                No architecture diagram available for this question yet.
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Diagram surface */}
            <div className="rounded-xl border border-slate-200 dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] p-4 overflow-x-auto architecture-diagram-surface">
                <svg
                    width={width}
                    height={height}
                    viewBox={`0 0 ${width} ${height}`}
                    className="block"
                >
                    <defs>
                        <marker
                            id="arrow"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                        >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                        </marker>
                    </defs>

                    {/* Edges first, behind nodes */}
                    <g className="text-slate-400 dark:text-slate-500">
                        {edges.map((edge, i) => {
                            const from = positioned.get(edge.from);
                            const to = positioned.get(edge.to);
                            if (!from || !to) return null;

                            const x1 = from.x + from.w;
                            const y1 = from.y + from.h / 2;
                            const x2 = to.x;
                            const y2 = to.y + to.h / 2;

                            // For backward edges (to is left of from), route around the bottom.
                            const goingForward = x2 >= x1 - 4;
                            let pathD: string;
                            if (goingForward) {
                                const midX = (x1 + x2) / 2;
                                pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
                            } else {
                                // Loop down and around
                                const drop = Math.max(from.y, to.y) + Math.max(from.h, to.h) / 2 + 40;
                                pathD = `M ${x1} ${y1} C ${x1 + 40} ${drop}, ${x2 - 40} ${drop}, ${x2} ${y2}`;
                            }

                            // Mid point for label (rough)
                            const midX = (x1 + x2) / 2;
                            const midY = goingForward ? (y1 + y2) / 2 - 6 : Math.max(from.y, to.y) + Math.max(from.h, to.h) / 2 + 32;

                            return (
                                <g key={`edge-${i}`}>
                                    <path
                                        d={pathD}
                                        stroke="currentColor"
                                        strokeWidth={1.6}
                                        fill="none"
                                        markerEnd="url(#arrow)"
                                        opacity={0.85}
                                    />
                                    {edge.label && (
                                        <foreignObject
                                            x={midX - 90}
                                            y={midY - 12}
                                            width={180}
                                            height={28}
                                            pointerEvents="none"
                                        >
                                            <div className="flex justify-center">
                                                <span className="px-1.5 py-0.5 rounded text-[10px] leading-tight font-medium bg-white/90 dark:bg-[#1e1e1e]/90 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-[#3e3e3e]/70 max-w-[170px] text-center break-words">
                                                    {edge.label}
                                                </span>
                                            </div>
                                        </foreignObject>
                                    )}
                                </g>
                            );
                        })}
                    </g>

                    {/* Nodes */}
                    {Array.from(positioned.values()).map((n) => {
                        const lightStyle = getStyle(n.type, false);
                        const darkStyle = getStyle(n.type, true);
                        return (
                            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                                <rect
                                    width={n.w}
                                    height={n.h}
                                    rx={10}
                                    ry={10}
                                    className="diagram-node-rect"
                                    style={
                                        {
                                            // Light defaults — overridden by dark CSS below.
                                            fill: lightStyle.bg,
                                            stroke: lightStyle.border,
                                            strokeWidth: 1.5,
                                            ["--node-bg-light" as any]: lightStyle.bg,
                                            ["--node-bg-dark" as any]: darkStyle.bg,
                                            ["--node-border-light" as any]: lightStyle.border,
                                            ["--node-border-dark" as any]: darkStyle.border,
                                        } as any
                                    }
                                />
                                <foreignObject x={6} y={4} width={n.w - 12} height={n.h - 8}>
                                    <div
                                        className="diagram-node-label h-full w-full flex flex-col items-center justify-center text-center px-2"
                                        style={
                                            {
                                                color: lightStyle.text,
                                                ["--node-text-light" as any]: lightStyle.text,
                                                ["--node-text-dark" as any]: darkStyle.text,
                                            } as any
                                        }
                                    >
                                        <div className="text-[12px] font-semibold leading-tight whitespace-pre-wrap break-words">
                                            {n.label}
                                        </div>
                                        {n.type && (
                                            <div className="text-[9px] uppercase tracking-wider opacity-70 mt-1">
                                                {n.type}
                                            </div>
                                        )}
                                    </div>
                                </foreignObject>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Notes */}
            {diagram.notes && diagram.notes.length > 0 && (
                <div className="rounded-xl bg-slate-50 dark:bg-[#1c160d] border border-slate-200 dark:border-[#3e3e3e] p-4">
                    <h4 className="text-[13px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-amber-500">
                            sticky_note_2
                        </span>
                        Implementation Notes
                    </h4>
                    <ul className="space-y-2.5">
                        {diagram.notes.map((note, idx) => (
                            <li
                                key={idx}
                                className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 pl-4 border-l-2 border-amber-300 dark:border-amber-600/60"
                            >
                                {note}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <style jsx global>{`
                .architecture-diagram-surface .diagram-node-rect {
                    fill: var(--node-bg-light);
                    stroke: var(--node-border-light);
                }
                .architecture-diagram-surface .diagram-node-label {
                    color: var(--node-text-light);
                }
                .dark .architecture-diagram-surface .diagram-node-rect {
                    fill: var(--node-bg-dark) !important;
                    stroke: var(--node-border-dark) !important;
                }
                .dark .architecture-diagram-surface .diagram-node-label {
                    color: var(--node-text-dark) !important;
                }
            `}</style>
        </div>
    );
}
