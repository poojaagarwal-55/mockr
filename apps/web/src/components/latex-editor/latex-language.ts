// ============================================
// Monaco Editor — LaTeX Language Configuration
// ============================================
// Monarch tokenizer for LaTeX syntax highlighting

import type * as Monaco from "monaco-editor";

export function registerLatexLanguage(monaco: typeof Monaco) {
    // Register the language
    monaco.languages.register({ id: "latex" });

    // Monarch tokenizer
    monaco.languages.setMonarchTokensProvider("latex", {
        defaultToken: "",
        tokenPostfix: ".latex",

        brackets: [
            { open: "{", close: "}", token: "delimiter.curly" },
            { open: "[", close: "]", token: "delimiter.square" },
            { open: "(", close: ")", token: "delimiter.parenthesis" },
        ],

        tokenizer: {
            root: [
                // Comments
                [/%.*$/, "comment"],

                // Math mode (inline)
                [/\$\$/, { token: "string.math", next: "@displayMath" }],
                [/\$/, { token: "string.math", next: "@inlineMath" }],

                // Environment begin/end
                [/(\\begin)(\{)([^}]+)(\})/, ["keyword", "delimiter.curly", "tag", "delimiter.curly"]],
                [/(\\end)(\{)([^}]+)(\})/, ["keyword", "delimiter.curly", "tag", "delimiter.curly"]],

                // Document class and packages
                [/(\\documentclass|\\usepackage)(\[?)/, ["keyword.control", "delimiter.square"]],

                // Section commands
                [/\\(section|subsection|subsubsection|paragraph|subparagraph|chapter|part)\*?/, "keyword.section"],

                // Formatting commands
                [/\\(textbf|textit|texttt|emph|underline|uppercase|lowercase|textsc)/, "keyword.format"],

                // Font size commands
                [/\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)/, "keyword.format"],

                // Reference commands
                [/\\(label|ref|cite|href|url|hyperref)/, "keyword.reference"],

                // Other commands
                [/\\[a-zA-Z@]+\*?/, "keyword"],

                // Braces
                [/[{}]/, "delimiter.curly"],
                [/[[\]]/, "delimiter.square"],

                // Special characters
                [/[&~^_]/, "operator"],

                // Numbers
                [/\d+(\.\d+)?/, "number"],
            ],

            inlineMath: [
                [/[^$\\]+/, "string.math"],
                [/\\[a-zA-Z]+/, "keyword.math"],
                [/\$/, { token: "string.math", next: "@pop" }],
            ],

            displayMath: [
                [/[^$\\]+/, "string.math"],
                [/\\[a-zA-Z]+/, "keyword.math"],
                [/\$\$/, { token: "string.math", next: "@pop" }],
            ],
        },
    });

    // Auto-closing pairs
    monaco.languages.setLanguageConfiguration("latex", {
        comments: {
            lineComment: "%",
        },
        brackets: [
            ["{", "}"],
            ["[", "]"],
            ["(", ")"],
        ],
        autoClosingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: "$", close: "$" },
        ],
        surroundingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: "$", close: "$" },
        ],
    });
}

// Custom theme tokens for LaTeX
export function getLatexThemeRules(isDark: boolean): Monaco.editor.ITokenThemeRule[] {
    if (isDark) {
        return [
            { token: "comment.latex", foreground: "6A9955" },
            { token: "keyword.latex", foreground: "569CD6" },
            { token: "keyword.control.latex", foreground: "C586C0" },
            { token: "keyword.section.latex", foreground: "DCDCAA" },
            { token: "keyword.format.latex", foreground: "4EC9B0" },
            { token: "keyword.reference.latex", foreground: "9CDCFE" },
            { token: "keyword.math.latex", foreground: "CE9178" },
            { token: "string.math.latex", foreground: "CE9178" },
            { token: "tag.latex", foreground: "4EC9B0" },
            { token: "delimiter.curly.latex", foreground: "FFD700" },
            { token: "delimiter.square.latex", foreground: "DA70D6" },
            { token: "number.latex", foreground: "B5CEA8" },
            { token: "operator.latex", foreground: "D4D4D4" },
        ];
    }
    return [
        { token: "comment.latex", foreground: "008000" },
        { token: "keyword.latex", foreground: "0000FF" },
        { token: "keyword.control.latex", foreground: "AF00DB" },
        { token: "keyword.section.latex", foreground: "795E26" },
        { token: "keyword.format.latex", foreground: "267F99" },
        { token: "keyword.reference.latex", foreground: "001080" },
        { token: "keyword.math.latex", foreground: "A31515" },
        { token: "string.math.latex", foreground: "A31515" },
        { token: "tag.latex", foreground: "267F99" },
        { token: "delimiter.curly.latex", foreground: "B8860B" },
        { token: "delimiter.square.latex", foreground: "800080" },
        { token: "number.latex", foreground: "098658" },
        { token: "operator.latex", foreground: "000000" },
    ];
}
