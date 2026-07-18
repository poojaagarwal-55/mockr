interface DiagramNode {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface DiagramSummary {
    elementCount: number;
    shapeCount: number;
    arrowCount: number;
    textCount: number;
    freehandCount: number;
    keyComponents: string[];
    connections: string[];
    detachedNotes: string[];
}

const SHAPE_TYPES = new Set([
    "rectangle",
    "ellipse",
    "diamond",
    "parallelogram",
    "cylinder",
    "rounddiamond",
    "frame",
]);

const CONTROL_TYPES = new Set(["arrow", "line", "freedraw", "draw", "selection", "image"]);

function normalizeElements(snapshot: any): any[] {
    const rawElements = Array.isArray(snapshot)
        ? snapshot
        : Array.isArray(snapshot?.elements)
            ? snapshot.elements
            : [];

    return rawElements.filter((el: any) => el && typeof el === "object" && !el.isDeleted);
}

function normalizeLabel(raw: string): string {
    const compact = raw.replace(/\s+/g, " ").trim();
    if (compact.length <= 80) return compact;
    return `${compact.slice(0, 77)}...`;
}

function getNodeCenter(node: DiagramNode): { x: number; y: number } {
    return {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
    };
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function getArrowEndpoint(arrow: any, side: "start" | "end"): { x: number; y: number } | null {
    const points = Array.isArray(arrow?.points) ? arrow.points : null;
    if (!points || points.length === 0 || typeof arrow?.x !== "number" || typeof arrow?.y !== "number") {
        return null;
    }

    const point = side === "start" ? points[0] : points[points.length - 1];
    if (!Array.isArray(point) || point.length < 2) return null;

    const px = Number(point[0]);
    const py = Number(point[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

    return {
        x: arrow.x + px,
        y: arrow.y + py,
    };
}

function findClosestNode(nodes: DiagramNode[], point: { x: number; y: number }, maxDistance: number): DiagramNode | null {
    if (nodes.length === 0) return null;

    let winner: DiagramNode | null = null;
    let best = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
        const dist = squaredDistance(getNodeCenter(node), point);
        if (dist < best) {
            best = dist;
            winner = node;
        }
    }

    return best <= maxDistance * maxDistance ? winner : null;
}

function summarizeCanvasSnapshot(snapshot: any): DiagramSummary | null {
    const elements = normalizeElements(snapshot);
    if (elements.length === 0) return null;

    const textElements = elements.filter(
        (el: any) => el.type === "text" && typeof el.text === "string" && el.text.trim().length > 0
    );

    const textByContainerId = new Map<string, string[]>();
    const textCenters = new Map<string, { x: number; y: number; label: string; usedByNode: boolean }>();

    for (const textEl of textElements) {
        const label = normalizeLabel(String(textEl.text));
        if (!label) continue;

        const textId = String(textEl.id || `${textEl.x}_${textEl.y}_${label}`);
        const center = {
            x: Number(textEl.x || 0) + Number(textEl.width || 0) / 2,
            y: Number(textEl.y || 0) + Number(textEl.height || 0) / 2,
            label,
            usedByNode: false,
        };
        textCenters.set(textId, center);

        if (typeof textEl.containerId === "string" && textEl.containerId.length > 0) {
            const existing = textByContainerId.get(textEl.containerId) || [];
            existing.push(label);
            textByContainerId.set(textEl.containerId, existing);
        }
    }

    const nodes: DiagramNode[] = [];
    const nodeById = new Map<string, DiagramNode>();
    let unlabeledCounter = 1;

    for (const element of elements) {
        if (!SHAPE_TYPES.has(String(element.type))) continue;

        const id = String(element.id || `shape_${nodes.length + 1}`);
        const x = Number(element.x || 0);
        const y = Number(element.y || 0);
        const width = Math.abs(Number(element.width || 0));
        const height = Math.abs(Number(element.height || 0));

        let label: string | null = null;

        const attached = textByContainerId.get(id);
        if (attached && attached.length > 0) {
            label = attached[0] || null;
        }

        if (!label) {
            // Fallback: locate text centered inside the shape bounds.
            for (const textMeta of textCenters.values()) {
                if (textMeta.x >= x && textMeta.x <= x + width && textMeta.y >= y && textMeta.y <= y + height) {
                    label = textMeta.label;
                    textMeta.usedByNode = true;
                    break;
                }
            }
        }

        if (!label) {
            label = `${String(element.type)}_${unlabeledCounter++}`;
        }

        const node: DiagramNode = { id, label, x, y, width, height };
        nodes.push(node);
        nodeById.set(id, node);
    }

    const keyComponents = Array.from(
        new Set(
            nodes
                .map((node) => node.label)
                .filter((label) => !/_(\d+)$/.test(label))
        )
    ).slice(0, 12);

    const connections = new Set<string>();
    const arrows = elements.filter((el: any) => el.type === "arrow");
    const freehandCount = elements.filter((el: any) => (
        el.type === "freedraw" ||
        el.type === "draw" ||
        el.type === "image"
    )).length;

    for (const arrow of arrows) {
        const startBoundId = arrow?.startBinding?.elementId;
        const endBoundId = arrow?.endBinding?.elementId;

        let fromNode = typeof startBoundId === "string" ? nodeById.get(startBoundId) || null : null;
        let toNode = typeof endBoundId === "string" ? nodeById.get(endBoundId) || null : null;

        if (!fromNode) {
            const startPoint = getArrowEndpoint(arrow, "start");
            if (startPoint) {
                fromNode = findClosestNode(nodes, startPoint, 220);
            }
        }

        if (!toNode) {
            const endPoint = getArrowEndpoint(arrow, "end");
            if (endPoint) {
                toNode = findClosestNode(nodes, endPoint, 220);
            }
        }

        if (fromNode && toNode) {
            connections.add(`${fromNode.label} -> ${toNode.label}`);
        }
    }

    // Keep only note-like text that is not bound to a diagram node.
    const detachedNotes = Array.from(textCenters.values())
        .filter((meta) => {
            if (meta.usedByNode) return false;
            return !keyComponents.includes(meta.label);
        })
        .map((meta) => meta.label)
        .slice(0, 8);

    return {
        elementCount: elements.length,
        shapeCount: nodes.length,
        arrowCount: arrows.length,
        textCount: textElements.length,
        freehandCount,
        keyComponents,
        connections: Array.from(connections).slice(0, 12),
        detachedNotes,
    };
}

export function buildSystemDiagramContext(snapshot: any): string | null {
    const summary = summarizeCanvasSnapshot(snapshot);
    if (!summary) return null;

    const lines: string[] = [];
    lines.push("## Candidate's Current Diagram");
    lines.push("The candidate has drawn the following on their whiteboard:");
    lines.push(`- **Elements**: ${summary.elementCount} total (${summary.shapeCount} shapes, ${summary.arrowCount} arrows, ${summary.textCount} text labels, ${summary.freehandCount} freehand/image elements)`);
    lines.push(`- **Key components**: ${summary.keyComponents.length > 0 ? summary.keyComponents.join(", ") : "(no labeled components yet)"}`);

    if (summary.connections.length > 0) {
        lines.push("- **Detected flows**:");
        for (const edge of summary.connections.slice(0, 8)) {
            lines.push(`  - ${edge}`);
        }
    }

    if (summary.detachedNotes.length > 0) {
        lines.push(`- **Additional notes/text**: ${summary.detachedNotes.join(", ")}`);
    }

    if (summary.freehandCount > 0 && summary.textCount === 0 && summary.keyComponents.length === 0) {
        lines.push("- **Freehand content**: visible freehand strokes are present, but there are no machine-readable text labels. Do not claim exact written words unless text labels are listed above.");
    }

    lines.push("");
    lines.push("Use this to ask informed follow-up questions about architecture, data flow, bottlenecks, and tradeoffs.");
    lines.push("Do NOT read the entire diagram back to the candidate.");

    return lines.join("\n");
}

export function buildVoiceDiagramContext(snapshot: any): string | null {
    const summary = summarizeCanvasSnapshot(snapshot);
    if (!summary) return null;

    const parts: string[] = [
        `Diagram context: ${summary.shapeCount} shapes, ${summary.arrowCount} arrows, ${summary.textCount} text labels, ${summary.freehandCount} freehand/image elements.`,
        `Key components: ${summary.keyComponents.length > 0 ? summary.keyComponents.join(", ") : "(none yet)"}.`,
    ];

    if (summary.connections.length > 0) {
        parts.push(`Detected flows: ${summary.connections.slice(0, 4).join("; ")}.`);
    }

    if (summary.detachedNotes.length > 0) {
        parts.push(`Additional notes: ${summary.detachedNotes.slice(0, 4).join(", ")}.`);
    }

    if (summary.freehandCount > 0 && summary.textCount === 0 && summary.keyComponents.length === 0) {
        parts.push("Freehand strokes are visible, but there are no machine-readable text labels. Do not claim exact written words unless text labels are listed above.");
    }

    return parts.join(" ");
}

export function hasMeaningfulDiagram(snapshot: any): boolean {
    const summary = summarizeCanvasSnapshot(snapshot);
    if (!summary) return false;

    return (
        summary.shapeCount > 0 ||
        summary.arrowCount > 0 ||
        summary.textCount > 0 ||
        summary.freehandCount > 0 ||
        summary.connections.length > 0
    );
}
