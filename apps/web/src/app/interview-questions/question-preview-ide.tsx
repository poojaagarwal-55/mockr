"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import Editor, { loader } from "@monaco-editor/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Lock } from "lucide-react";
import { LANGUAGE_MAP } from "@interviewforge/shared";
import RequirementCard from "@/components/system-design/requirement-card";
import { readPublicQuestionDraft, writePublicQuestionDraft, type PublicQuestionDraftKind } from "@/lib/public-question-drafts";
import { getLoginPath, normalizeQuestionTypography, type PublicQuestionPreview } from "@/lib/public-question-previews";

const SystemDesignScratchpad = dynamic(
  () => import("@/components/system-design/scratchpad"),
  { ssr: false }
);

loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" },
});

const languageLabel: Record<PublicQuestionPreview["language"], string> = {
  cpp: "C++",
  sql: "SQL",
  text: "Answer",
};

function cleanPreviewText(value: string) {
  return normalizeQuestionTypography(value)
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\[cite:\s*\d+\]/gi, "")
    .replace(/\*\*/g, "")
    .replace(/\n\s*\*\s+/g, "\n- ")
    .replace(/\\([\[\]{}()_*`#+\-.!|>])/g, "$1")
    .replace(/\\"/g, "\"")
    .trim();
}

function stripExamplesAndConstraints(value: string) {
  return cleanPreviewText(
    value
      .split(/\n\s*(?:\*\*)?Example\s+1\s*:?(?:\*\*)?/i)[0]
      .split(/\n\s*(?:\*\*)?Constraints\s*:?(?:\*\*)?/i)[0] || value
  );
}

function renderInlineMarkdown(text: string) {
  const parts: Array<string | ReactNode> = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <strong key={`bold-${key}`} className="font-semibold text-slate-900 dark:text-white">
        {match[1]}
      </strong>
    );
    key += 1;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function parseSystemDesignStatement(raw: string) {
  const text = normalizeQuestionTypography(raw || "").replace(/\r\n/g, "\n");
  const headingPattern = /\*\*(Functional Requirements|Non-Functional Requirements|Scale)\s*:?\s*\*\*/gi;
  const matches: Array<{ index: number; matchLength: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(text)) !== null) {
    matches.push({ index: match.index, matchLength: match[0].length });
  }

  if (matches.length === 0) return { intro: text.trim() };
  return { intro: text.slice(0, matches[0].index).trim() };
}

function SystemDesignDescriptionPreview({ question }: { question: PublicQuestionPreview }) {
  const parsed = parseSystemDesignStatement(question.prompt);
  const [revealed, setRevealed] = useState(0);
  const followUpQuestions = (question.followUpQuestions?.length ? question.followUpQuestions : question.tests || [])
    .filter(Boolean)
    .filter(Boolean);
  const hints = (question.hints?.length ? question.hints : question.approachHint ? [question.approachHint] : [])
    .filter(Boolean);

  return (
    <div className="space-y-8">
      {parsed.intro && (
        <div className="whitespace-pre-wrap text-[16px] leading-relaxed text-slate-700 dark:text-slate-100">
          {renderInlineMarkdown(parsed.intro)}
        </div>
      )}

      {followUpQuestions.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[19px] font-bold text-slate-900 dark:text-white">
            <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">quiz</span>
            Follow-up Questions
          </h3>
          <ol className="list-inside list-decimal space-y-2 marker:text-slate-400 dark:marker:text-slate-500">
            {followUpQuestions.map((followUp, index) => (
              <li key={`${followUp}-${index}`} className="pl-1 text-[15.5px] leading-relaxed text-slate-700 dark:text-slate-200">
                {cleanPreviewText(followUp)}
              </li>
            ))}
          </ol>
        </section>
      )}

      {hints.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[19px] font-bold text-slate-900 dark:text-white">
              <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">lightbulb</span>
              Hints
              <span className="ml-1 text-[13px] font-medium text-slate-400 dark:text-slate-500">
                ({revealed}/{hints.length})
              </span>
            </h3>
            {revealed > 0 && (
              <button
                type="button"
                onClick={() => setRevealed(0)}
                className="rounded px-2 py-1 text-[13px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Hide all
              </button>
            )}
          </div>

          {revealed === 0 ? (
            <button
              type="button"
              onClick={() => setRevealed(1)}
              className="px-4 py-2 text-[14px] font-medium text-slate-800 transition-colors hover:text-slate-600 dark:text-slate-200 dark:hover:text-slate-400"
            >
              Reveal first hint
            </button>
          ) : (
            <div className="space-y-3">
              {hints.slice(0, revealed).map((hint, index) => (
                <div key={`${hint}-${index}`} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-[11px] font-bold text-white">
                    {index + 1}
                  </span>
                  <p className="text-[15.5px] leading-relaxed text-slate-700 dark:text-slate-200">
                    {cleanPreviewText(hint)}
                  </p>
                </div>
              ))}
              {revealed < hints.length && (
                <button
                  type="button"
                  onClick={() => setRevealed((next) => Math.min(next + 1, hints.length))}
                  className="px-4 py-2 text-[14px] font-medium text-slate-800 transition-colors hover:text-slate-600 dark:text-slate-200 dark:hover:text-slate-400"
                >
                  Show next hint
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function isMarkdownTableLine(line: string) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanPreviewText(cell));
}

function isMarkdownTableSeparator(row: string[]) {
  return row.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function splitPromptContent(value: string) {
  const lines = value.split("\n");
  const parts: Array<{ type: "text"; content: string } | { type: "table"; rows: string[][] }> = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    const content = textBuffer.join("\n").trim();
    if (content) parts.push({ type: "text", content });
    textBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!isMarkdownTableLine(line)) {
      textBuffer.push(line);
      continue;
    }

    flushText();
    const tableLines = [line];

    while (index + 1 < lines.length && isMarkdownTableLine(lines[index + 1])) {
      index += 1;
      tableLines.push(lines[index]);
    }

    const rows = tableLines
      .map(parseMarkdownTableRow)
      .filter((row) => row.some((cell) => cell.length > 0))
      .filter((row) => !isMarkdownTableSeparator(row));

    if (rows.length > 0) {
      parts.push({ type: "table", rows });
    }
  }

  flushText();
  return parts;
}

function PromptContent({ value }: { value: string }) {
  const parts = splitPromptContent(value);

  return (
    <div className="mt-5 space-y-4 text-[15px] leading-8 text-slate-700 dark:text-[#d7d7d7]">
      {parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <p key={`text-${index}`} className="whitespace-pre-line break-words [overflow-wrap:anywhere]">
              {part.content}
            </p>
          );
        }

        const [header, ...body] = part.rows;
        return (
          <div
            key={`table-${index}`}
            className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-[#3a3a3a] dark:bg-[#202020]"
          >
            <div className="question-preview-scroll overflow-x-auto">
              <table className="w-full min-w-[440px] border-collapse text-left text-sm">
                <thead className="bg-blue-50/80 text-xs uppercase tracking-[0.08em] text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  <tr>
                    {header.map((cell, cellIndex) => (
                      <th key={`${cell}-${cellIndex}`} className="border-b border-slate-200 px-4 py-3 font-black dark:border-[#3a3a3a]">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`} className="border-b border-slate-100 last:border-0 dark:border-[#343434]">
                      {header.map((_, cellIndex) => (
                        <td
                          key={`cell-${rowIndex}-${cellIndex}`}
                          className="break-words px-4 py-3 align-top text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300"
                        >
                          {row[cellIndex] || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatPreviewValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalizeQuestionTypography(String(value));
  }
  return normalizeQuestionTypography(JSON.stringify(value, null, 2));
}

function SqlDataTable({ data, title }: { data: unknown; title?: string }) {
  if (!data) return null;

  let parsedData = data;
  if (typeof data === "string") {
    try {
      parsedData = JSON.parse(data);
    } catch {
      return (
        <div className="question-preview-scroll overflow-x-auto">
          {title && <p className="mb-2 font-semibold text-slate-700 dark:text-slate-300">{title}</p>}
          <pre className="whitespace-pre-wrap break-words rounded bg-white p-3 text-sm text-slate-700 [overflow-wrap:anywhere] dark:bg-[#282828] dark:text-slate-300">
            {normalizeQuestionTypography(data)}
          </pre>
        </div>
      );
    }
  }

  if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === "object") {
    const keys = Object.keys(parsedData[0] as Record<string, unknown>);
    return (
      <div className="question-preview-scroll overflow-x-auto">
        {title && <p className="mb-2 font-semibold text-slate-700 dark:text-slate-300">{title}</p>}
        <table className="min-w-full border border-slate-300 text-sm dark:border-slate-600">
          <thead className="bg-slate-100 dark:bg-slate-700">
            <tr>
              {keys.map((key) => (
                <th
                  key={key}
                  className="border-b border-slate-300 px-4 py-2 text-left font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                >
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsedData.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                {keys.map((key) => (
                  <td
                    key={key}
                    className="border-b border-slate-200 px-4 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    {formatPreviewValue((row as Record<string, unknown>)[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (typeof parsedData === "object" && !Array.isArray(parsedData)) {
    return (
      <div className="space-y-4">
        {Object.entries(parsedData as Record<string, unknown>).map(([tableName, tableData]) => (
          <SqlDataTable key={tableName} data={tableData} title={tableName} />
        ))}
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
      {formatPreviewValue(parsedData)}
    </pre>
  );
}

function inferSqlSchemaData(input: unknown): Record<string, Array<{ "Column Name": string; "Example Value": string }>> | null {
  if (!input) return null;

  let parsedInput = input;
  if (typeof input === "string") {
    try {
      parsedInput = JSON.parse(input);
    } catch {
      return null;
    }
  }

  const schema: Record<string, Array<{ "Column Name": string; "Example Value": string }>> = {};

  const addTable = (tableName: string, rows: unknown) => {
    if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0] !== "object" || rows[0] === null) return;
    const firstRow = rows[0] as Record<string, unknown>;
    const columns = Object.keys(firstRow);
    if (columns.length === 0) return;

    schema[tableName] = columns.map((column) => ({
      "Column Name": column,
      "Example Value": formatPreviewValue(firstRow[column]),
    }));
  };

  if (Array.isArray(parsedInput)) {
    addTable("Input", parsedInput);
  } else if (typeof parsedInput === "object" && parsedInput !== null) {
    Object.entries(parsedInput as Record<string, unknown>).forEach(([tableName, rows]) => {
      addTable(tableName, rows);
    });
  }

  return Object.keys(schema).length > 0 ? schema : null;
}

function parseSqlSchemaText(schemaText: string): Record<string, Array<Record<string, string>>> | null {
  const schema: Record<string, Array<Record<string, string>>> = {};
  const blocks = schemaText
    .split(/(?=^Table\s*:\s*)/gim)
    .map((block) => block.trim())
    .filter(Boolean);

  blocks.forEach((block, blockIndex) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const tableName = lines[0]?.replace(/^Table\s*:\s*/i, "").trim() || `Table ${blockIndex + 1}`;
    const tableRows = lines
      .filter(isMarkdownTableLine)
      .map(parseMarkdownTableRow)
      .map((row) => row.filter((cell) => cell.trim() !== ""))
      .filter((row) => row.length > 0 && !isMarkdownTableSeparator(row));

    const [header, ...body] = tableRows;
    if (!header || body.length === 0) return;

    schema[tableName] = body.map((row) => {
      const item: Record<string, string> = {};
      header.forEach((column, index) => {
        item[column] = row[index] || "";
      });
      return item;
    });
  });

  return Object.keys(schema).length > 0 ? schema : null;
}

function SqlExampleBlocks({ question, firstExample }: { question: PublicQuestionPreview; firstExample: ReturnType<typeof getFirstExample> }) {
  const example = question.examples?.[0];

  if (example?.input || example?.output) {
    return (
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Example</h3>
        <div className="mt-4 space-y-4 rounded bg-slate-50 p-4 dark:bg-[#1c160d]">
          <SqlDataTable data={example.input} title="Input" />
          <SqlDataTable data={example.output} title="Output" />
          {example.explanation && (
            <>
              <p className="font-semibold text-slate-900 dark:text-white">Explanation:</p>
              <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
                {normalizeQuestionTypography(example.explanation)}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!firstExample) return null;

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Example</h3>
      <div className="mt-4 rounded bg-slate-50 p-4 dark:bg-[#1c160d]">
        {firstExample.body ? (
          <p className="whitespace-pre-line break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
            {firstExample.body}
          </p>
        ) : (
          <div className="space-y-4">
            <SqlDataTable data={firstExample.input} title="Input" />
            <SqlDataTable data={firstExample.output} title="Output" />
            {firstExample.explanation && (
              <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">Explanation: </span>
                {firstExample.explanation}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function parseExampleBlock(block: string) {
  const normalized = block
    .replace(/\*\*/g, "")
    .replace(/\r\n/g, "\n")
    .trim();

  const input = normalized.match(/\bInput\s*:?\s*([\s\S]*?)(?=\s*(?:Output|Explanation)\s*:|$)/i)?.[1] || "";
  const rawOutput = normalized.match(/\bOutput\s*:?\s*([\s\S]*?)(?=\s*Explanation\s*:|$)/i)?.[1] || "";
  const explicitExplanation = normalized.match(/\bExplanation\s*:?\s*([\s\S]*)/i)?.[1] || "";
  const outputLines = rawOutput.trim().split("\n");
  const output = outputLines.shift() || "";
  const inferredExplanation = outputLines.join("\n").trim();

  return {
    input: cleanPreviewText(input),
    output: cleanPreviewText(output),
    explanation: cleanPreviewText(explicitExplanation || inferredExplanation),
  };
}

function getFirstExample(question: PublicQuestionPreview) {
  const source = question.prompt;
  const exampleBlock = source.match(
    /\n\s*\*\*Example\s+1:\*\*([\s\S]*?)(?=\n\s*\*\*Example\s+2:\*\*|\n\s*\*\*Constraints:\*\*|$)/i
  )?.[1];

  if (!exampleBlock) {
    const fallback = question.tests[0];
    if (!fallback) return null;
    const parsed = parseExampleBlock(fallback);
    return {
      label: "Example 1",
      body: parsed.input || parsed.output ? "" : cleanPreviewText(fallback),
      ...parsed,
    };
  }

  const parsed = parseExampleBlock(exampleBlock);

  return {
    label: "Example 1",
    body: "",
    ...parsed,
  };
}

function getDifficultyClass(difficulty: string) {
  if (difficulty === "Easy") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (difficulty === "Medium") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

function getMonacoLanguage(language: PublicQuestionPreview["language"]) {
  if (language === "cpp") return LANGUAGE_MAP.cpp?.monacoId || "cpp";
  if (language === "sql") return "sql";
  return "markdown";
}

export function QuestionPreviewIde({ question }: { question: PublicQuestionPreview }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [activeTestCaseIndex, setActiveTestCaseIndex] = useState(0);
  const loginPath = getLoginPath(question.authPath);
  const firstExample = getFirstExample(question);
  const displayPrompt = stripExamplesAndConstraints(question.prompt);
  const displayTitle = normalizeQuestionTypography(question.title);
  const isCsFundamentals = question.category === "cs-fundamentals";
  const isSystemDesign = question.category === "system-design";
  const isSql = question.category === "sql" || question.language === "sql";
  const workspaceLabel = isSystemDesign ? "Notepad" : languageLabel[question.language];
  const workspaceFile = isSystemDesign
    ? "architecture-notes.md"
    : question.language === "sql"
      ? "query.sql"
      : question.language === "text"
        ? "answer.md"
        : "solution.cpp";
  const workspaceCopy = isSystemDesign
    ? "Preview mode. Log in to write architecture notes, save your answer, and get feedback."
    : "Preview mode. Log in to edit, run, submit, and save progress.";
  const workspaceText = isSystemDesign ? "" : question.starterCode;
  const [draftCode, setDraftCode] = useState(workspaceText);
  const [systemNfr, setSystemNfr] = useState("");
  const [initialSystemDesignElements, setInitialSystemDesignElements] = useState<any[]>([]);
  const [systemDesignElements, setSystemDesignElements] = useState<any[]>([]);
  const systemDesignSceneSignatureRef = useRef("");
  const draftKind: PublicQuestionDraftKind = isSystemDesign ? "system-design" : isSql ? "sql" : "dsa";
  const testCases = [
    {
      input: firstExample?.input || "Login to run sample tests and see exact execution output.",
      expected: firstExample?.output || "",
    },
  ];
  const activeTest = testCases[activeTestCaseIndex] ?? { input: "", expected: "" };
  const editorTheme = resolvedTheme === "dark" ? "vs-dark" : isSql ? "light" : "vs";
  const monacoLanguage = getMonacoLanguage(question.language);
  const hasSystemDesignDraft = isSystemDesign && Boolean(draftCode.trim() || systemNfr.trim() || systemDesignElements.length);
  const persistedDraftContent = hasSystemDesignDraft
    ? `Functional Requirements:\n${draftCode}\n\nNon-Functional Requirements:\n${systemNfr}`
    : draftCode;
  const explicitSqlSchemaData = typeof question.schema === "string"
    ? parseSqlSchemaText(question.schema)
    : question.schema;
  const sqlSchemaData = isSql
    ? explicitSqlSchemaData || inferSqlSchemaData(question.examples?.[0]?.input)
    : null;
  const isInferredSqlSchema = isSql && !question.schema && Boolean(sqlSchemaData);

  useEffect(() => {
    const savedDraft = readPublicQuestionDraft(question.authPath);
    if (savedDraft?.content) {
      if (isSystemDesign) {
        const systemDesignDraft = savedDraft.content.match(
          /^Functional Requirements:\n([\s\S]*?)\n\nNon-Functional Requirements:\n([\s\S]*)$/
        );
        if (systemDesignDraft) {
          setDraftCode(systemDesignDraft[1]);
          setSystemNfr(systemDesignDraft[2]);
        }
        if (savedDraft.systemDesignElements?.length) {
          const restoredElements = savedDraft.systemDesignElements as any[];
          const restoredSignature = restoredElements.map((element: any) => `${element?.id || ""}:${element?.version || 0}`).join("|");
          systemDesignSceneSignatureRef.current = restoredSignature;
          setInitialSystemDesignElements(restoredElements);
          setSystemDesignElements(restoredElements);
        }
        if (systemDesignDraft) return;
      }
      setDraftCode(savedDraft.content);
    }
  }, [isSystemDesign, question.authPath]);

  useEffect(() => {
    if (isSystemDesign ? !hasSystemDesignDraft : !persistedDraftContent || persistedDraftContent === workspaceText) return;
    writePublicQuestionDraft(question.authPath, {
      content: persistedDraftContent,
      kind: draftKind,
      language: question.language,
      systemDesignElements: isSystemDesign ? systemDesignElements : undefined,
    });
  }, [draftKind, hasSystemDesignDraft, isSystemDesign, persistedDraftContent, question.authPath, question.language, systemDesignElements, workspaceText]);

  const handleSystemDesignSceneChange = useCallback((elements: any[]) => {
    const nextElements = elements || [];
    const nextSignature = nextElements.map((element: any) => `${element?.id || ""}:${element?.version || 0}`).join("|");
    if (nextSignature === systemDesignSceneSignatureRef.current) return;
    systemDesignSceneSignatureRef.current = nextSignature;
    setSystemDesignElements(nextElements);
  }, []);

  const gate = () => {
    if (isSystemDesign ? hasSystemDesignDraft : persistedDraftContent && persistedDraftContent !== workspaceText) {
      writePublicQuestionDraft(question.authPath, {
        content: persistedDraftContent,
        kind: draftKind,
        language: question.language,
        systemDesignElements: isSystemDesign ? systemDesignElements : undefined,
      });
    }
    router.push(loginPath);
  };

  if (isCsFundamentals) {
    const questionText = cleanPreviewText(displayPrompt || displayTitle);
    const lockedAnswerLines = [
      "Start with a clear definition, then explain where the concept appears in real systems.",
      "Add one practical example so the answer sounds interview-ready instead of memorized.",
      "Close with trade-offs, edge cases, and the mistake candidates usually make.",
    ];

    return (
      <div className="min-h-[calc(100vh-64px)] bg-white px-6 py-8 text-slate-900 dark:bg-[#1a1a1a] dark:text-white">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                {question.difficulty}
              </span>
              {question.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-[#333333] dark:text-slate-300">
                  {tag}
                </span>
              ))}
            </div>
            <button
              onClick={gate}
              className="hidden items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-[#333333] dark:text-slate-300 dark:hover:bg-[#3d3d3d] sm:flex"
            >
              <Lock className="h-4 w-4" />
              Login to save
            </button>
          </div>

          <section className="mb-8">
            <div className="flex items-start gap-3">
              <span className="shrink-0 text-3xl font-bold text-blue-600 dark:text-blue-400">Q.</span>
              <h1 className="font-nunito text-[30px] font-black leading-relaxed tracking-[-0.02em] text-slate-950 dark:text-white md:text-[36px]">
                {questionText}
              </h1>
            </div>
          </section>

          <section>
            <div className="mb-6 flex items-center gap-2">
              <div className="h-8 w-1 rounded-full bg-green-500" />
              <h2 className="font-nunito text-3xl font-black text-slate-950 dark:text-white">Answer</h2>
            </div>

            <div className="relative overflow-hidden rounded-3xl bg-white p-6 shadow-[0_18px_70px_rgba(74,124,255,0.10)] dark:bg-[#242424] dark:shadow-[0_18px_70px_rgba(0,0,0,0.32)] md:p-8">
              <div className="pointer-events-none select-none space-y-6 blur-[10px]">
                {lockedAnswerLines.map((line, index) => (
                  <p key={line} className="text-lg leading-relaxed text-slate-700 dark:text-slate-300">
                    <strong className="text-slate-950 dark:text-white">{index + 1}. </strong>
                    {line}
                  </p>
                ))}
                <ul className="ml-4 space-y-3">
                  <li className="flex items-start gap-3 text-slate-700 dark:text-slate-300">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    <span>Include one concise example and one common interview caveat.</span>
                  </li>
                  <li className="flex items-start gap-3 text-slate-700 dark:text-slate-300">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    <span>Keep the answer structured enough to revise quickly before a technical screen.</span>
                  </li>
                </ul>
              </div>

              <div className="absolute inset-0 flex items-center justify-center px-6">
                <div className="max-w-sm text-center">
                  <button
                    onClick={gate}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600/95 px-5 py-3 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(74,124,255,0.28)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-blue-700 dark:shadow-[0_14px_34px_rgba(0,0,0,0.38)]"
                  >
                    <Lock className="h-4 w-4" />
                    Login to view answer
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-128px)] min-h-[620px] overflow-hidden bg-[#FAFBFC] text-slate-900 dark:bg-lc-bg dark:text-white">
      <style jsx global>{`
        .question-preview-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .question-preview-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <Group orientation="horizontal">
        <Panel defaultSize={40} minSize={25}>
          <div className="flex h-full min-h-0 min-w-0 flex-col bg-white dark:bg-[#282828]">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-[#3e3e3e]">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate font-nunito text-[22px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">
                    {displayTitle}
                  </h1>
                  <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {workspaceCopy}
                  </p>
                </div>
                <button
                  onClick={gate}
                  className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
                >
                  Login to solve
                </button>
              </div>
            </div>

            <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
              {["Description", "Solution", "Submissions", "Result"].map((tab, index) => (
                <button
                  key={tab}
                  onClick={index === 0 ? undefined : gate}
                  className={`px-4 py-2 text-sm font-medium ${
                    index === 0
                      ? isSystemDesign
                        ? "border-b-2 border-slate-700 text-slate-900 dark:border-slate-300 dark:text-white"
                        : "border-b-2 border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  {tab}
                </button>
              ))}
              <div className="ml-auto pr-3">
                <button
                  onClick={gate}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-[#3e3e3e] dark:hover:text-slate-200"
                  title="Report question"
                >
                  <span className="material-symbols-outlined text-[18px]">flag</span>
                </button>
              </div>
            </div>

            <div className="question-preview-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
              {!isSystemDesign && (
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${getDifficultyClass(question.difficulty)}`}>
                    {question.difficulty}
                  </span>
                  <button
                    onClick={gate}
                    className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-slate-600 transition-all hover:bg-slate-200 hover:text-slate-800 dark:bg-[#333333] dark:text-slate-400 dark:hover:bg-[#3e3e3e] dark:hover:text-slate-200"
                    title="Add to custom sheet"
                  >
                    <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                    <span className="text-sm font-medium">Add to Sheet</span>
                  </button>
                </div>
              )}

              {isSystemDesign ? (
                <SystemDesignDescriptionPreview question={question} />
              ) : isSql ? (
                <div className="prose max-w-none dark:prose-invert">
                  <h3>Description</h3>
                  <div className="whitespace-pre-wrap dark:text-slate-300">
                    <PromptContent value={displayPrompt} />
                  </div>

                  {Boolean(sqlSchemaData) && (
                    <>
                      <h3 className="mt-8 border-b border-slate-200 pb-2 text-lg font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-200">
                        {isInferredSqlSchema ? "Database Schema (Inferred)" : "Database Schema"}
                      </h3>
                      <div className="mt-4 rounded bg-slate-50 p-4 dark:bg-[#1c160d]">
                        <SqlDataTable data={sqlSchemaData} />
                      </div>
                    </>
                  )}

                  <SqlExampleBlocks question={question} firstExample={firstExample} />
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-bold tracking-[-0.02em]">{displayTitle}</h2>
                  <PromptContent value={displayPrompt} />

                  {firstExample && (
                    <div className="mt-7 space-y-3">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Examples</h3>
                      <div className="w-full min-w-0 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-[#1c160d] dark:text-slate-300">
                        <span className="mb-3 block text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                          {firstExample.label}
                        </span>
                        {firstExample.body ? (
                          <p className="whitespace-pre-line break-words [overflow-wrap:anywhere]">{firstExample.body}</p>
                        ) : (
                          <div className="space-y-3">
                            {firstExample.input && (
                              <div>
                                <span className="font-bold text-slate-900 dark:text-white">Input: </span>
                                <pre className="question-preview-scroll mt-2 whitespace-pre-wrap break-words rounded bg-white p-3 font-mono text-[13px] leading-6 [overflow-wrap:anywhere] dark:bg-[#282828]">{firstExample.input}</pre>
                              </div>
                            )}
                            {firstExample.output && (
                              <div>
                                <span className="font-bold text-slate-900 dark:text-white">Output: </span>
                                <pre className="question-preview-scroll mt-2 whitespace-pre-wrap break-words rounded bg-white p-3 font-mono text-[13px] leading-6 [overflow-wrap:anywhere] dark:bg-[#282828]">{firstExample.output}</pre>
                              </div>
                            )}
                            {firstExample.explanation && (
                              <p className="break-words text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
                                <span className="font-bold text-slate-900 dark:text-white">Explanation: </span>
                                {firstExample.explanation}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!isSystemDesign && (
                <div className="mt-7 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4 dark:bg-[#1c160d]">
                    <h3 className="text-sm font-bold">Approach hint</h3>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
                      {cleanPreviewText(question.approachHint)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4 dark:bg-[#1c160d]">
                    <h3 className="text-sm font-bold">Common mistake</h3>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
                      {cleanPreviewText(question.commonMistake)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Separator className="group relative flex w-1.5 cursor-col-resize items-center justify-center bg-slate-200 transition-colors hover:bg-teal-500 dark:bg-[#3e3e3e] dark:hover:bg-teal-500">
          <div className="h-6 w-0.5 rounded-full bg-slate-400 transition-colors group-hover:bg-teal-400 dark:bg-slate-500" />
        </Separator>

        <Panel defaultSize={60} minSize={30}>
          {isSystemDesign ? (
            <Group orientation="vertical">
              <Panel defaultSize={55} minSize={25}>
                <div className="relative h-full bg-white dark:bg-[#282828]">
                  <SystemDesignScratchpad
                    isDark={resolvedTheme === "dark"}
                    initialElements={initialSystemDesignElements}
                    onSceneChange={handleSystemDesignSceneChange}
                  />

                  <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2">
                    <button
                      onClick={gate}
                      className="pointer-events-auto flex h-9 items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </Panel>
              <Separator className="group relative flex h-1.5 cursor-row-resize items-center justify-center bg-slate-200 transition-colors hover:bg-teal-500 dark:bg-[#3e3e3e] dark:hover:bg-teal-500">
                <div className="h-0.5 w-6 rounded-full bg-slate-400 transition-colors group-hover:bg-teal-400 dark:bg-slate-500" />
              </Separator>
              <Panel defaultSize={45} minSize={25}>
                <div className="h-full overflow-hidden bg-slate-50 p-4 dark:bg-[#1e1e1e]">
                  <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-2">
                    <RequirementCard
                      title="Functional Requirements"
                      placeholder="Write functional requirements here..."
                      value={draftCode}
                      onChange={setDraftCode}
                    />
                    <RequirementCard
                      title="Non-Functional Requirements"
                      placeholder="Write non-functional requirements here..."
                      value={systemNfr}
                      onChange={setSystemNfr}
                    />
                  </div>
                </div>
              </Panel>
            </Group>
          ) : (
            <Group orientation="vertical">
              <Panel defaultSize={isSql ? 60 : 50} minSize={isSql ? 30 : 20}>
                <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[#282828]">
                  <div className={`${isSql ? "h-12 px-4" : "p-4"} flex items-center justify-between bg-slate-50 dark:bg-[#242424]`}>
                    {isSql ? (
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        SQL Editor
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={gate}
                        className="flex h-8 items-center gap-2 rounded-full bg-slate-200 px-4 text-sm font-medium text-slate-700 transition-all hover:bg-slate-300 dark:bg-[#333333] dark:text-slate-300 dark:hover:bg-[#3e3e3e]"
                        title="Select language after login"
                      >
                        <span>{workspaceLabel}</span>
                        <span className="material-symbols-outlined text-[16px] leading-none text-slate-500 dark:text-slate-300">
                          expand_more
                        </span>
                      </button>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={gate}
                        className={`flex h-8 items-center justify-center rounded-full px-4 text-sm font-medium text-white shadow-sm transition ${
                          isSql
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-slate-600 hover:bg-slate-700"
                        }`}
                      >
                        {isSql ? "Run Query" : "Run Tests"}
                      </button>
                      {!isSql && (
                        <button
                          onClick={gate}
                          className="flex h-8 items-center justify-center rounded-full bg-teal-600 px-4 text-sm font-medium text-white transition hover:bg-teal-700"
                        >
                          Submit
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative min-h-0 flex-1 overflow-hidden bg-white dark:bg-[#1e1e1e]">
                    <Editor
                      height="100%"
                      language={monacoLanguage}
                      theme={editorTheme}
                      value={draftCode}
                      onChange={(value) => setDraftCode(value || "")}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        renderLineHighlight: "none",
                        guides: { indentation: false },
                        padding: { top: 16 },
                        wordWrap: "on",
                      }}
                    />
                  </div>
                </div>
              </Panel>

              <Separator className="group relative flex h-1.5 cursor-row-resize items-center justify-center bg-slate-200 transition-colors hover:bg-teal-500 dark:bg-[#3e3e3e] dark:hover:bg-teal-500">
                <div className="h-0.5 w-6 rounded-full bg-slate-400 transition-colors group-hover:bg-teal-400 dark:bg-slate-500" />
              </Separator>

              <Panel defaultSize={isSql ? 40 : 50} minSize={20}>
                <div className="flex h-full min-h-0 flex-col border-t border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-[#252526]">
                  <div className="flex shrink-0 items-end gap-2 bg-slate-50 px-4 pt-2 dark:bg-[#282828]">
                    <button className="flex items-center gap-2 rounded-t-md bg-white px-4 py-2 text-sm font-semibold text-green-600 transition-colors dark:bg-[#1e1e1e] dark:text-green-500">
                      <span className="material-symbols-outlined text-[18px]">{isSql ? "check_circle" : "task_alt"}</span>
                      Testcase
                    </button>
                    <div className="mx-1 mb-2.5 h-5 w-px rounded-full bg-slate-300 dark:bg-[#444]" />
                    <button
                      onClick={gate}
                      className="flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      <span className="material-symbols-outlined text-[16px]">terminal</span>
                      {isSql ? "Result" : "Test Result"}
                    </button>
                  </div>
                  <div className={`question-preview-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white dark:bg-[#1e1e1e] ${isSql ? "p-6" : "p-4"}`}>
                    {!isSql && (
                      <div className="mb-6 flex flex-wrap gap-2">
                        {testCases.map((test, index) => (
                          <button
                            key={`${test.input}-${index}`}
                            onClick={() => setActiveTestCaseIndex(index)}
                            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                              activeTestCaseIndex === index
                                ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-[#333] dark:text-white"
                                : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-[#282828] dark:text-slate-400 dark:hover:bg-[#333]"
                            }`}
                          >
                            Case {index + 1}
                          </button>
                        ))}
                      </div>
                    )}

                    {isSql ? (
                      <div className="space-y-4">
                        {question.examples?.[0]?.input || question.examples?.[0]?.output ? (
                          <>
                            <SqlDataTable data={question.examples?.[0]?.input} title="Input" />
                            <SqlDataTable data={question.examples?.[0]?.output} title="Output" />
                          </>
                        ) : (
                          <div className="space-y-6">
                            <SqlDataTable data={activeTest.input} title="Input" />
                            <SqlDataTable data={activeTest.expected || "Login to run tests and compare output."} title="Output" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div>
                          <div className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Input</div>
                          <div className="mt-1.5 rounded-lg bg-slate-50 p-4 dark:bg-[#282828]">
                            <code className="block whitespace-pre-wrap break-words font-mono text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
                              {activeTest.input}
                            </code>
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Output</div>
                          <div className="mt-1.5 rounded-lg bg-slate-50 p-4 dark:bg-[#282828]">
                            <code className="block whitespace-pre-wrap break-words font-mono text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
                              {activeTest.expected || "Login to run tests and compare output."}
                            </code>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            </Group>
          )}
        </Panel>
      </Group>
    </div>
  );
}
