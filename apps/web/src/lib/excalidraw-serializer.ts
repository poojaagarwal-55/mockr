/**
 * Serializes Excalidraw elements into a structured text description
 * that gives an LLM a clear understanding of the diagram topology:
 * what components exist, what connects to what, and with what labels.
 */

interface ExcalidrawElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    label?: { text?: string };
    containerId?: string | null;
    startBinding?: { elementId: string } | null;
    endBinding?: { elementId: string } | null;
    boundElements?: Array<{ id: string; type: string }> | null;
    groupIds?: string[];
    frameId?: string | null;
    name?: string; // frames have a name
}

interface Node {
    id: string;
    label: string;
    shapeType: string;
}

interface Edge {
    id: string;
    from: string | null; // node label or null if unresolved
    to: string | null;
    label: string;
}

function normalizeShapeType(type: string): string {
    switch (type) {
        case "rectangle": return "box";
        case "ellipse": return "circle";
        case "diamond": return "decision";
        case "triangle": return "triangle";
        case "cylinder": return "database";
        default: return type;
    }
}

/** Find the label for a shape element */
function getNodeLabel(
    el: ExcalidrawElement,
    allElements: ExcalidrawElement[]
): string {
    // Excalidraw v2: bound text element with containerId === el.id
    const boundText = allElements.find(
        (e) => e.type === "text" && e.containerId === el.id && e.text?.trim()
    );
    if (boundText?.text?.trim()) return boundText.text.trim();

    // Excalidraw v2 inline label object
    if (el.label?.text?.trim()) return el.label.text.trim();

    // Shape itself has text (older versions)
    if (el.text?.trim()) return el.text.trim();

    return `(unlabeled ${normalizeShapeType(el.type)})`;
}

/** Find the label on an arrow element */
function getEdgeLabel(
    arrow: ExcalidrawElement,
    allElements: ExcalidrawElement[]
): string {
    const boundText = allElements.find(
        (e) => e.type === "text" && e.containerId === arrow.id && e.text?.trim()
    );
    if (boundText?.text?.trim()) return boundText.text.trim();
    if (arrow.label?.text?.trim()) return arrow.label.text.trim();
    if (arrow.text?.trim()) return arrow.text.trim();
    return "";
}

/** Spatial proximity fallback: find nearest shape to a point */
function findNearestShape(
    x: number,
    y: number,
    shapes: ExcalidrawElement[],
    threshold = 80
): ExcalidrawElement | null {
    let best: ExcalidrawElement | null = null;
    let bestDist = threshold;

    for (const s of shapes) {
        // Center of the shape
        const cx = s.x + (s.width || 0) / 2;
        const cy = s.y + (s.height || 0) / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < bestDist) {
            bestDist = dist;
            best = s;
        }
    }
    return best;
}

export function serializeExcalidrawForLLM(elements: any[]): string {
    if (!Array.isArray(elements) || elements.length === 0) {
        return "(No diagram drawn — candidate left whiteboard empty.)";
    }

    const els = elements as ExcalidrawElement[];

    // Separate element types
    const shapeTypes = new Set(["rectangle", "ellipse", "diamond", "triangle", "cylinder", "image"]);
    const shapes = els.filter((e) => shapeTypes.has(e.type));
    const arrows = els.filter((e) => e.type === "arrow" || e.type === "line");
    const frames = els.filter((e) => e.type === "frame");
    // Standalone text = text with no containerId
    const standaloneText = els.filter(
        (e) => e.type === "text" && !e.containerId && e.text?.trim()
    );

    // Build node map: id → Node
    const nodeMap = new Map<string, Node>();
    for (const s of shapes) {
        nodeMap.set(s.id, {
            id: s.id,
            label: getNodeLabel(s, els),
            shapeType: normalizeShapeType(s.type),
        });
    }

    // Build edges
    const edges: Edge[] = [];
    for (const arrow of arrows) {
        const edgeLabel = getEdgeLabel(arrow, els);

        let fromLabel: string | null = null;
        let toLabel: string | null = null;

        // Explicit bindings (snapped arrows)
        if (arrow.startBinding?.elementId) {
            fromLabel = nodeMap.get(arrow.startBinding.elementId)?.label ?? null;
        }
        if (arrow.endBinding?.elementId) {
            toLabel = nodeMap.get(arrow.endBinding.elementId)?.label ?? null;
        }

        // Spatial proximity fallback for unsnapped arrows
        // Excalidraw stores arrow points; we approximate using x/y as start
        if (!fromLabel) {
            const nearest = findNearestShape(arrow.x, arrow.y, shapes);
            if (nearest) fromLabel = nodeMap.get(nearest.id)?.label ?? null;
        }
        if (!toLabel) {
            // End point approximation: x + width, y + height
            const ex = arrow.x + (arrow.width || 0);
            const ey = arrow.y + (arrow.height || 0);
            const nearest = findNearestShape(ex, ey, shapes);
            if (nearest) toLabel = nodeMap.get(nearest.id)?.label ?? null;
        }

        // Only include edges where at least one endpoint is resolved
        if (fromLabel || toLabel) {
            edges.push({ id: arrow.id, from: fromLabel, to: toLabel, label: edgeLabel });
        }
    }

    // Build frame membership
    const frameMap = new Map<string, string>(); // frameId → frame name
    for (const f of frames) {
        frameMap.set(f.id, f.name || f.text || `Frame ${frameMap.size + 1}`);
    }
    const frameContents = new Map<string, string[]>(); // frameName → node labels
    for (const s of shapes) {
        if (s.frameId && frameMap.has(s.frameId)) {
            const fname = frameMap.get(s.frameId)!;
            const node = nodeMap.get(s.id);
            if (node) {
                if (!frameContents.has(fname)) frameContents.set(fname, []);
                frameContents.get(fname)!.push(node.label);
            }
        }
    }

    // Find unconnected nodes
    const connectedIds = new Set<string>();
    for (const e of edges) {
        // find node id by label
        for (const [id, node] of nodeMap) {
            if (node.label === e.from || node.label === e.to) connectedIds.add(id);
        }
    }
    const unconnected = shapes.filter((s) => !connectedIds.has(s.id));

    // ── Build output string ──────────────────────────────────────

    const lines: string[] = [];

    // Components
    const componentList = Array.from(nodeMap.values())
        .map((n) => `${n.label} (${n.shapeType})`)
        .join(", ");
    lines.push(`COMPONENTS: ${componentList || "(none)"}`);
    lines.push("");

    // Connections
    if (edges.length > 0) {
        lines.push("CONNECTIONS:");
        for (const e of edges) {
            const from = e.from ?? "?";
            const to = e.to ?? "?";
            const lbl = e.label ? ` [${e.label}]` : "";
            lines.push(`  - ${from} → ${to}${lbl}`);
        }
    } else {
        lines.push("CONNECTIONS: (none — no arrows drawn or arrows not connected to shapes)");
    }

    // Zones / Frames
    if (frameContents.size > 0) {
        lines.push("");
        lines.push("ZONES / LAYERS:");
        for (const [fname, members] of frameContents) {
            lines.push(`  - [${fname}]: ${members.join(", ")}`);
        }
    }

    // Unconnected nodes
    if (unconnected.length > 0) {
        lines.push("");
        const ulabels = unconnected.map((s) => nodeMap.get(s.id)?.label ?? "?").join(", ");
        lines.push(`ISOLATED COMPONENTS (drawn but not connected): ${ulabels}`);
    }

    // Standalone text annotations
    if (standaloneText.length > 0) {
        lines.push("");
        const annotations = standaloneText.map((t) => `"${t.text!.trim()}"`).join(", ");
        lines.push(`ANNOTATIONS / LABELS: ${annotations}`);
    }

    lines.push("");
    lines.push(`TOTAL ELEMENTS: ${els.length} (${shapes.length} shapes, ${arrows.length} arrows, ${frames.length} frames, ${standaloneText.length} text annotations)`);

    return lines.join("\n");
}
