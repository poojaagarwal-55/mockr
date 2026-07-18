import { useState } from "react";
import { DSAQuestionData, TestResultsState } from "../DSAQuestionForm";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
    setTestStatus?: React.Dispatch<React.SetStateAction<TestResultsState>>;
}

const languages = [
    { id: "python3" as const, name: "Python 3" },
    { id: "cpp" as const, name: "C++" },
    { id: "java" as const, name: "Java" },
    { id: "javascript" as const, name: "JavaScript" },
];

type LanguageId = (typeof languages)[number]["id"];

const starterPlaceholders: Record<LanguageId, string> = {
    python3: `class Solution:
    def solve(self, nums, k):
        # Write your code here
        return 0`,
    cpp: `class Solution {
public:
    long long solve(vector<int>& nums, int k) {
        // Write your code here
        return 0;
    }
};`,
    java: `class Solution {
    public long solve(int[] nums, int k) {
        // Write your code here
        return 0;
    }
}`,
    javascript: `class Solution {
  solve(nums, k) {
    // Write your code here
    return 0;
  }
}`,
};

const wrapperPlaceholders: Record<LanguageId, string> = {
    python3: `import sys

data = list(map(int, sys.stdin.read().split()))
# Parse stdin, then call Solution().solve(...)
print(Solution().solve(nums, k))`,
    cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // Parse stdin, then call Solution sol;
    return 0;
}`,
    java: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        // Parse stdin, then call new Solution().solve(...)
    }
}`,
    javascript: `const fs = require('fs');
const data = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);

// Parse stdin, then call new Solution().solve(...)
console.log(new Solution().solve(nums, k));`,
};

export function CodeSnippetsSection({ formData, setFormData, setTestStatus }: Props) {
    const [guidelinesOpen, setGuidelinesOpen] = useState(false);
    const [exampleOpen, setExampleOpen] = useState(false);
    const [activeLanguage, setActiveLanguage] = useState<LanguageId>("python3");

    const updateCodeSnippet = (
        lang: LanguageId,
        field: "starter_code" | "wrapper_code",
        value: string
    ) => {
        setFormData({
            ...formData,
            codeSnippets: {
                ...formData.codeSnippets,
                [lang]: {
                    ...formData.codeSnippets[lang],
                    [field]: value,
                },
            },
        });

        setTestStatus?.((prev) => ({
            bruteForce: {
                ...prev.bruteForce,
                [lang]: "untested",
            },
            optimized: {
                ...prev.optimized,
                [lang]: "untested",
            },
        }));
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Code Snippets</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        Add starter and wrapper code for every supported language.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setExampleOpen(true)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                    >
                        <span className="material-symbols-outlined text-[18px]">info</span>
                        Example
                    </button>
                    <button
                        type="button"
                        onClick={() => setGuidelinesOpen(true)}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-primary/30 px-4 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/15"
                    >
                        Guidelines
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                {languages.map((lang) => {
                    const active = activeLanguage === lang.id;
                    const complete = Boolean(
                        formData.codeSnippets[lang.id].starter_code.trim() &&
                        formData.codeSnippets[lang.id].wrapper_code.trim()
                    );
                    return (
                        <button
                            key={lang.id}
                            type="button"
                            onClick={() => setActiveLanguage(lang.id)}
                            className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-extrabold transition ${
                                active
                                    ? "bg-primary text-white shadow-sm"
                                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border dark:hover:bg-lc-hover dark:hover:text-white"
                            }`}
                        >
                            {lang.name}
                            <span className={`size-2 rounded-full ${complete ? "bg-emerald-400" : active ? "bg-white/40" : "bg-slate-300"}`} />
                        </button>
                    );
                })}
            </div>

            {languages
                .filter((lang) => lang.id === activeLanguage)
                .map((lang) => (
                    <div key={lang.id} className="rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                                {lang.name}
                            </h3>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">
                                {activeLanguage.toUpperCase()}
                            </span>
                        </div>

                        <div className="space-y-4">
                            <label className="block">
                                <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">
                                    Starter Code <span className="text-red-500">*</span>
                                </span>
                                <span className="mb-2 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                    Candidate-visible code must use a Solution class. For C++, put methods inside public:.
                                </span>
                                <textarea
                                    value={formData.codeSnippets[lang.id].starter_code}
                                    onChange={(event) => updateCodeSnippet(lang.id, "starter_code", event.target.value)}
                                    rows={10}
                                    required
                                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                    placeholder={starterPlaceholders[lang.id]}
                                />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">
                                    Wrapper Code <span className="text-red-500">*</span>
                                </span>
                                <span className="mb-2 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                    Hidden runner only: parse stdin, call Solution, and print stdout.
                                </span>
                                <textarea
                                    value={formData.codeSnippets[lang.id].wrapper_code}
                                    onChange={(event) => updateCodeSnippet(lang.id, "wrapper_code", event.target.value)}
                                    rows={10}
                                    required
                                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                    placeholder={wrapperPlaceholders[lang.id]}
                                />
                            </label>
                        </div>
                    </div>
                ))}

            {guidelinesOpen && (
                <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl dark:bg-lc-surface dark:ring-1 dark:ring-lc-border">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Language Guidelines</h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Use these rules so contest questions run correctly in Judge0.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setGuidelinesOpen(false)}
                                className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                                aria-label="Close guidelines"
                            >
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>

                        <div className="mt-6 space-y-4 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                            <p><strong className="text-slate-950 dark:text-white">Starter Code:</strong> What the candidate sees and edits. Use a <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-lc-elevated dark:text-slate-100">Solution</code> class for supported languages.</p>
                            <p><strong className="text-slate-950 dark:text-white">Wrapper Code:</strong> Hidden execution code that reads stdin, calls the candidate solution, and prints stdout.</p>
                            <p><strong className="text-slate-950 dark:text-white">Combine rule:</strong> Keep starter and wrapper separate. Do not repeat the same function or class in both blocks.</p>
                            <p><strong className="text-slate-950 dark:text-white">Wrapper style:</strong> Python and JavaScript wrappers usually only need stdin parsing and a final print. Java wrappers should include imports and a <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-lc-elevated dark:text-slate-100">public class Main</code> runner. C++ wrappers can contain helper declarations and <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-lc-elevated dark:text-slate-100">main()</code>.</p>
                            <p><strong className="text-slate-950 dark:text-white">Coverage:</strong> Fill both starter and wrapper code for Python 3, C++, Java, and JavaScript.</p>
                        </div>
                    </div>
                </div>
            )}

            {exampleOpen && (
                <div className="fixed inset-0 z-[180] overflow-y-auto bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
                    <div className="mx-auto w-full max-w-6xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-lc-surface dark:ring-1 dark:ring-lc-border">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Code snippet example</p>
                                <h3 className="mt-2 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">
                                    One complete example in all languages
                                </h3>
                                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                    Use this as the reference shape for starter code and wrapper code. The example problem is: given two integers, return their sum.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setExampleOpen(false)}
                                className="grid size-10 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                                aria-label="Close example"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                            <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Example problem</p>
                            <div className="mt-2 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 md:grid-cols-3">
                                <div><span className="text-slate-400 dark:text-slate-500">Title:</span> Add Two Numbers</div>
                                <div><span className="text-slate-400 dark:text-slate-500">Input:</span> <code className="font-mono">a b</code></div>
                                <div><span className="text-slate-400 dark:text-slate-500">Output:</span> <code className="font-mono">a + b</code></div>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-5 xl:grid-cols-2">
                            <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h4 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Python 3</h4>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">PYTHON3</span>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Starter Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`class Solution:
    def add_two_numbers(self, a, b):
        # Write your code here
        return 0`}</pre>
                                    </div>
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Wrapper Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`a, b = map(int, input().split())
print(Solution().add_two_numbers(a, b))`}</pre>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h4 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">C++</h4>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">CPP</span>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Starter Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`class Solution {
public:
    long long addTwoNumbers(long long a, long long b) {
        // Write your code here
        return 0;
    }
};`}</pre>
                                    </div>
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Wrapper Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    long long a, b;
    cin >> a >> b;

    Solution sol;
    cout << sol.addTwoNumbers(a, b) << '\\n';
    return 0;
}`}</pre>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h4 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Java</h4>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">JAVA</span>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Starter Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`class Solution {
    public static long addTwoNumbers(long a, long b) {
        // Write your code here
        return 0;
    }
}`}</pre>
                                    </div>
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Wrapper Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());

        long a = Long.parseLong(st.nextToken());
        long b = Long.parseLong(st.nextToken());

        System.out.println(Solution.addTwoNumbers(a, b));
    }
}`}</pre>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h4 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">JavaScript</h4>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">JAVASCRIPT</span>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Starter Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`class Solution {
  addTwoNumbers(a, b) {
  // Write your code here
  return 0;
  }
}`}</pre>
                                    </div>
                                    <div>
                                        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Wrapper Code</p>
                                        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`const fs = require('fs');
const input = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);

const [a, b] = input;
console.log(new Solution().addTwoNumbers(a, b));`}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-300">
                            Keep the same pattern in every question: starter is what the candidate edits, wrapper is only the hidden stdin/stdout runner.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
