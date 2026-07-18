"use client";

import type React from "react";

type ExampleLike = {
    input?: unknown;
    output?: unknown;
    expected_output?: unknown;
    explanation?: string;
};

type DataTable = {
    name?: string;
    headers: string[];
    rows: string[][];
};

type SchemaTable = {
    name: string;
    rows: Array<{
        column: string;
        type: string;
        description: string;
    }>;
};

export function normalizePreviewText(value?: string) {
    return (value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\\r\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "    ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/[\u2013\u2014]/g, "-")
        .trim();
}

export function valueToText(value: unknown) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return normalizePreviewText(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return normalizePreviewText(JSON.stringify(value, null, 2));
}

function parseMaybeJson(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function scalarCell(value: unknown) {
    if (value === null) return "NULL";
    if (value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value).replace(/[\u2013\u2014]/g, "-");
    return String(value).replace(/[\u2013\u2014]/g, "-");
}

function tableFromRows(name: string | undefined, rows: unknown[]): DataTable | null {
    if (!rows.length || !rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
        return null;
    }

    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row as Record<string, unknown>))));
    if (!headers.length) return null;

    return {
        name,
        headers,
        rows: rows.map((row) => headers.map((header) => scalarCell((row as Record<string, unknown>)[header]))),
    };
}

function tablesFromValue(value: unknown, fallbackName?: string): DataTable[] {
    const parsed = parseMaybeJson(value);
    if (Array.isArray(parsed)) {
        const table = tableFromRows(fallbackName, parsed);
        return table ? [table] : [];
    }

    if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const arrayEntries = Object.entries(record).filter(([, item]) => Array.isArray(item));
        const namedTables = arrayEntries
            .flatMap(([name, item]) => [tableFromRows(name, item as unknown[])])
            .filter(Boolean) as DataTable[];
        if (arrayEntries.length) return namedTables;
        if (namedTables.length) return namedTables;

        const table = tableFromRows(fallbackName, [record]);
        return table ? [table] : [];
    }

    return parseMarkdownTables(String(value || ""), fallbackName);
}

function tablesFromWrapperSetup(setupCode?: string): DataTable[] {
    const text = normalizePreviewText(setupCode);
    if (!text) return [];

    const tables = new Map<string, Record<string, unknown>[]>();
    const insertRegex = /insert\s+into\s+[`"]?([a-zA-Z_][\w]*)[`"]?\s*\(([\s\S]*?)\)\s*values\s*([\s\S]*?);/gi;
    const matches = Array.from(text.matchAll(insertRegex));

    for (const match of matches) {
        const tableName = formatTableName(match[1]);
        const columns = splitSqlList(match[2]).map((column) => column.replace(/[`"]/g, "").trim()).filter(Boolean);
        const tuples = splitSqlTuples(match[3]);
        if (!tableName || !columns.length || !tuples.length) continue;

        const rows = tables.get(tableName) || [];
        for (const tuple of tuples) {
            const values = splitSqlList(tuple);
            const row: Record<string, unknown> = {};
            columns.forEach((column, index) => {
                row[column] = parseSqlLiteral(values[index] || "");
            });
            rows.push(row);
        }
        tables.set(tableName, rows);
    }

    return Array.from(tables.entries())
        .map(([name, rows]) => tableFromRows(name, rows))
        .filter(Boolean) as DataTable[];
}

function splitSqlTuples(value: string) {
    const tuples: string[] = [];
    let quote: string | null = null;
    let depth = 0;
    let start = -1;

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        const nextChar = value[index + 1];

        if (quote) {
            if (char === quote && nextChar === quote) {
                index += 1;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
        } else if (char === "(") {
            if (depth === 0) start = index + 1;
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                tuples.push(value.slice(start, index));
                start = -1;
            }
        }
    }

    return tuples;
}

function splitSqlList(value: string) {
    const items: string[] = [];
    let quote: string | null = null;
    let depth = 0;
    let current = "";

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        const nextChar = value[index + 1];

        if (quote) {
            current += char;
            if (char === quote && nextChar === quote) {
                current += nextChar;
                index += 1;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
            current += char;
        } else if (char === "(") {
            depth += 1;
            current += char;
        } else if (char === ")") {
            depth = Math.max(0, depth - 1);
            current += char;
        } else if (char === "," && depth === 0) {
            items.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    if (current.trim()) items.push(current.trim());
    return items;
}

function parseSqlLiteral(value: string) {
    const trimmed = value.trim();
    if (/^null$/i.test(trimmed)) return null;
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
        return trimmed.slice(1, -1).replace(/''/g, "'").replace(/""/g, "\"");
    }
    return trimmed;
}

function parseMarkdownTables(value: string, fallbackName?: string): DataTable[] {
    const lines = normalizePreviewText(value).split("\n").map((line) => line.trim()).filter(Boolean);
    const tableLines = lines.filter((line) => line.includes("|"));
    if (tableLines.length < 2) return [];

    const rows = tableLines
        .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
        .filter((row) => !row.every((cell) => /^-+$/.test(cell.replace(/\s/g, ""))));
    if (rows.length < 2) return [];

    return [{
        name: fallbackName,
        headers: rows[0],
        rows: rows.slice(1),
    }];
}

function parseSchemaTables(schema?: string): SchemaTable[] {
    const text = schemaOnlyText(schema);
    if (!text) return [];

    const createTableMatches = Array.from(text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"]?([a-zA-Z_][\w]*)[`"]?\s*\(([\s\S]*?)\)\s*;?/gi));
    if (createTableMatches.length) {
        return createTableMatches.map((match) => ({
            name: formatTableName(match[1]),
            rows: match[2]
                .split(/,(?![^()]*\))/)
                .map((line) => line.trim())
                .filter((line) => line && !/^(primary|foreign|unique|constraint|key)\b/i.test(line))
                .map((line) => {
                    const cleanLine = line.replace(/[`"]/g, "");
                    const parts = cleanLine.split(/\s+/);
                    return {
                        column: parts[0] || "",
                        type: parts[1] || "",
                        description: "",
                    };
                })
                .filter((row) => row.column),
        }));
    }

    const sectionTables = splitSchemaSections(text).flatMap((section) => {
        const pipeTables = parsePipeSchemaTables(section.text, section.name);
        if (pipeTables.length) return pipeTables;
        const looseTable = parseLooseSchemaTable(section.text, section.name);
        return looseTable ? [looseTable] : [];
    });

    if (sectionTables.length) return sectionTables;

    const tableName = firstTableName(text) || "Table";
    const looseTable = parseLooseSchemaTable(text, tableName);
    return looseTable ? [looseTable] : [];
}

function schemaOnlyText(schema?: string) {
    const text = normalizePreviewText(schema);
    const cutoffIndex = text.search(/(?:^|\n)\s*(?:example|input|output|explanation|constraints?)\s*\d*\s*[:\n]/i);
    return (cutoffIndex >= 0 ? text.slice(0, cutoffIndex) : text).trim();
}

function firstTableName(text: string) {
    return formatTableName(
        text.match(/\btable\s*:\s*([a-zA-Z_][\w]*)/i)?.[1] ||
        text.match(/\b([a-zA-Z_][\w]*)\s+table\s*:/i)?.[1] ||
        text.match(/^#+\s*([a-zA-Z_][\w]*)\s*$/im)?.[1] ||
        ""
    );
}

function formatTableName(value: string) {
    return normalizePreviewText(value)
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .replace(/\s+/g, " ")
        .trim();
}

function splitSchemaSections(text: string) {
    const markerRegex = /(?:^|\n)\s*(?:table\s*:\s*([a-zA-Z_][\w]*)|([a-zA-Z_][\w]*)\s+table\s*:|#+\s*([a-zA-Z_][\w]*)\s*)/gi;
    const markers = Array.from(text.matchAll(markerRegex));
    if (!markers.length) {
        return [{ name: firstTableName(text) || "Table", text }];
    }

    return markers.map((marker, index) => {
        const nextMarker = markers[index + 1];
        const name = formatTableName(marker[1] || marker[2] || marker[3] || "Table");
        const start = (marker.index || 0) + marker[0].length;
        const end = nextMarker?.index ?? text.length;
        return {
            name,
            text: text.slice(start, end).trim(),
        };
    }).filter((section) => section.text);
}

function parsePipeSchemaTables(text: string, tableName: string): SchemaTable[] {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const pipeLineIndexes = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.includes("|") && !/^[+\-|\s]+$/.test(line));

    if (pipeLineIndexes.length < 2) return [];

    const rows = pipeLineIndexes.map(({ line }) =>
        line.replace(/^\||\|$/g, "").split("|").map((cell) => normalizePreviewText(cell))
    ).filter((row) => !isSeparatorRow(row));
    const headerIndex = rows.findIndex((row) => row.some((cell) => /column/i.test(cell)) && row.some((cell) => /type/i.test(cell)));
    if (headerIndex < 0) return [];

    const headers = rows[headerIndex].map((header) => header.toLowerCase());
    const columnIndex = Math.max(0, headers.findIndex((header) => header.includes("column")));
    const typeIndex = Math.max(1, headers.findIndex((header) => header.includes("type")));
    const descriptionIndex = headers.findIndex((header) => header.includes("description"));

    const schemaRows = rows.slice(headerIndex + 1)
        .filter((row) => row.some(Boolean))
        .map((row) => ({
            column: row[columnIndex] || "",
            type: (row[typeIndex] || "").toUpperCase(),
            description: descriptionIndex >= 0 ? row[descriptionIndex] || "" : "",
        }))
        .filter((row) => row.column && !/column\s*name/i.test(row.column));

    const note = parseSchemaNote(lines.slice(pipeLineIndexes[pipeLineIndexes.length - 1].index + 1).join("\n"));
    if (note) schemaRows.push({ column: "Note", type: "", description: note });

    return schemaRows.length ? [{ name: tableName, rows: schemaRows }] : [];
}

function parseLooseSchemaTable(text: string, tableName: string): SchemaTable | null {
    const typePattern = "(?:INT|INTEGER|BIGINT|SMALLINT|DATE|DATETIME|TIMESTAMP|VARCHAR(?:\\(\\d+\\))?|TEXT|CHAR(?:\\(\\d+\\))?|BOOLEAN|BOOL|DECIMAL(?:\\([^)]*\\))?|FLOAT|DOUBLE|NUMERIC(?:\\([^)]*\\))?)";
    const rowRegex = new RegExp("^\\s*[-*]?\\s*`?([a-zA-Z_][\\w]*)`?\\s*(?:[:\\-])?\\s*`?(" + typePattern + ")`?\\s*(?:[:\\-])?\\s*(.*)$", "i");
    const rows = text.split("\n")
        .map((line) => normalizePreviewText(line))
        .map((line) => line.match(rowRegex))
        .filter(Boolean)
        .map((match) => ({
            column: match![1],
            type: match![2].toUpperCase(),
            description: normalizePreviewText(match![3] || ""),
        }));

    const note = parseSchemaNote(text);
    if (note) rows.push({ column: "Note", type: "", description: note });
    return rows.length ? { name: tableName, rows } : null;
}

function isSeparatorRow(row: string[]) {
    return row.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function parseSchemaNote(text: string) {
    const lines = normalizePreviewText(text).split("\n").map((line) => line.trim()).filter(Boolean);
    const noteLine = lines.find((line) => /\b(no primary key|primary key|duplicate rows?|note)\b/i.test(line) && !line.includes("|"));
    return noteLine?.replace(/^note\s*[:\-]?\s*/i, "").trim() || "";
}

export function SQLSchemaPreview({ schema }: { schema?: string }) {
    const tables = parseSchemaTables(schema);

    if (!tables.length) {
        return (
            <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700 dark:bg-lc-elevated dark:text-slate-200">
                {normalizePreviewText(schema) || "No schema provided."}
            </pre>
        );
    }

    return (
        <div className="space-y-5">
            {tables.map((table) => (
                <div key={table.name} className="rounded-md bg-slate-50 p-5 dark:bg-lc-elevated">
                    <h3 className="mb-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{table.name}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] border border-slate-300 text-left text-base dark:border-lc-border">
                            <thead className="bg-slate-100/70 dark:bg-lc-surface">
                                <tr>
                                    <SchemaHeaderCell className="w-[26%]">Column<br />Name</SchemaHeaderCell>
                                    <SchemaHeaderCell className="w-[16%]">Type</SchemaHeaderCell>
                                    <SchemaHeaderCell>Description</SchemaHeaderCell>
                                </tr>
                            </thead>
                            <tbody>
                                {table.rows.map((row, index) => (
                                    <tr key={`${row.column}-${index}`} className="border-t border-slate-200 dark:border-lc-border">
                                        <SchemaBodyCell>{row.column}</SchemaBodyCell>
                                        <SchemaBodyCell>{row.type}</SchemaBodyCell>
                                        <SchemaBodyCell>{row.description || ""}</SchemaBodyCell>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function SQLExamplesPreview({ examples, testCases, setupCode }: { examples?: ExampleLike[]; testCases?: ExampleLike[]; setupCode?: string }) {
    const visibleExamples = examples?.length ? examples : testCases;
    if (!visibleExamples?.length) return null;
    const setupInputTables = tablesFromWrapperSetup(setupCode);

    return (
        <div className="space-y-8">
            {visibleExamples.map((example, index) => {
                const explicitInputTables = tablesFromValue(example.input, "Input");
                const inputTables = explicitInputTables.length ? explicitInputTables : setupInputTables;
                const outputTables = tablesFromValue(example.output ?? example.expected_output, "Output");
                return (
                    <div key={index} className="space-y-6">
                        <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Example {visibleExamples.length > 1 ? index + 1 : ""}</h3>
                        {!!inputTables.length && (
                            <div className="space-y-4">
                                {inputTables.map((table, tableIndex) => <DataTableView key={`${table.name}-${tableIndex}`} table={table} />)}
                            </div>
                        )}
                        {!!outputTables.length && (
                            <div>
                                <h4 className="mb-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Output</h4>
                                {outputTables.map((table, tableIndex) => <DataTableView key={`${table.name}-${tableIndex}`} table={table} />)}
                            </div>
                        )}
                        {example.explanation && (
                            <div>
                                <h4 className="mb-2 font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Explanation:</h4>
                                <p className="whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600 dark:text-slate-300">{normalizePreviewText(example.explanation)}</p>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function SQLSolutionPreview({ solution }: { solution: unknown }) {
    const parsed = parseMaybeJson(solution);
    const entries = solutionEntries(parsed);

    if (!entries.length) {
        return (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700 dark:bg-lc-elevated dark:text-slate-200">
                {valueToText(solution) || "No solution available."}
            </pre>
        );
    }

    return (
        <div className="space-y-5">
            {entries.map((entry) => (
                <div key={entry.title} className="rounded-lg bg-slate-50 p-4 dark:bg-lc-elevated">
                    <h3 className="mb-3 font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{entry.title}</h3>
                    <pre className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">{entry.query}</pre>
                </div>
            ))}
        </div>
    );
}

function solutionEntries(value: unknown): Array<{ title: string; query: string }> {
    if (typeof value === "string") {
        const text = normalizePreviewText(value);
        return text ? [{ title: "Solution", query: text }] : [];
    }

    if (!value || typeof value !== "object") return [];

    return Object.entries(value as Record<string, unknown>)
        .map(([key, rawValue]) => {
            const query = solutionValueText(rawValue);
            return query ? { title: formatSolutionTitle(key), query } : null;
        })
        .filter(Boolean) as Array<{ title: string; query: string }>;
}

function solutionValueText(value: unknown): string {
    if (typeof value === "string") return normalizePreviewText(value);
    if (!value || typeof value !== "object") return valueToText(value);

    const record = value as Record<string, unknown>;
    const queryValue = record.query ?? record.sql ?? record.solution ?? record.code ?? record.answer;
    if (queryValue !== undefined) return solutionValueText(queryValue);
    return valueToText(value);
}

function formatSolutionTitle(value: string) {
    return normalizePreviewText(value)
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function DataTableView({ table }: { table: DataTable }) {
    return (
        <div className="rounded-lg bg-slate-50 p-5 dark:bg-lc-elevated">
            {table.name && <h4 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{table.name}</h4>}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border border-slate-200 text-left text-sm dark:border-lc-border">
                    <thead className="bg-slate-100 dark:bg-lc-surface">
                        <tr>{table.headers.map((header) => <HeaderCell key={header}>{header}</HeaderCell>)}</tr>
                    </thead>
                    <tbody>
                        {table.rows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-t border-slate-200 dark:border-lc-border">
                                {row.map((cell, cellIndex) => <BodyCell key={`${rowIndex}-${cellIndex}`}>{cell}</BodyCell>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function HeaderCell({ children }: { children: React.ReactNode }) {
    return <th className="px-5 py-3 font-nunito text-base font-extrabold text-slate-950 dark:text-white">{children}</th>;
}

function BodyCell({ children }: { children: React.ReactNode }) {
    return <td className="px-5 py-3 font-medium leading-6 text-slate-700 dark:text-slate-200">{children}</td>;
}

function SchemaHeaderCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return <th className={`px-5 py-4 font-nunito text-lg font-extrabold leading-6 text-slate-950 dark:text-white ${className}`}>{children}</th>;
}

function SchemaBodyCell({ children }: { children: React.ReactNode }) {
    return <td className="px-5 py-3.5 text-lg font-medium leading-7 text-slate-700 dark:text-slate-200">{children}</td>;
}
