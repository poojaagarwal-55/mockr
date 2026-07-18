"use client";

import { useLayoutEffect } from "react";
import Link from "next/link";

type LegalDocumentProps = {
    title: string;
    subtitle: string;
    effectiveLine: string;
    contentLines: string[];
};

function shouldHideLine(line: string): boolean {
    return /^Owner \/ Operator:/i.test(line.trim());
}

function isTopLevelHeading(line: string): boolean {
    return /^\d+\.\s+/.test(line.trim());
}

function isNestedHeading(line: string): boolean {
    return /^\d+\.\d+\s+/.test(line.trim());
}

type TextToken =
    | { type: "text"; value: string }
    | { type: "url"; value: string }
    | { type: "email"; value: string };

function formatUrlForDisplay(url: string): string {
    return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

function tokenizeLinks(line: string): TextToken[] {
    const pattern = /(https?:\/\/[^\s]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    const tokens: TextToken[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
            tokens.push({ type: "text", value: line.slice(lastIndex, index) });
        }

        if (match[1]) {
            tokens.push({ type: "url", value: match[1] });
        } else if (match[2]) {
            tokens.push({ type: "email", value: match[2] });
        }

        lastIndex = index + match[0].length;
    }

    if (lastIndex < line.length) {
        tokens.push({ type: "text", value: line.slice(lastIndex) });
    }

    return tokens.length > 0 ? tokens : [{ type: "text", value: line }];
}

function renderLineWithLinks(line: string) {
    const tokens = tokenizeLinks(line);

    return tokens.map((token, tokenIndex) => {
        if (token.type === "url") {
            return (
                <a
                    key={`url-${tokenIndex}`}
                    href={token.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-blue-600 hover:text-blue-700"
                >
                    {formatUrlForDisplay(token.value)}
                </a>
            );
        }

        if (token.type === "email") {
            return (
                <a
                    key={`email-${tokenIndex}`}
                    href={`mailto:${token.value}`}
                    className="underline text-blue-600 hover:text-blue-700"
                >
                    {token.value}
                </a>
            );
        }

        return <span key={`text-${tokenIndex}`}>{token.value}</span>;
    });
}

export function LegalDocument({
    title,
    subtitle,
    effectiveLine,
    contentLines,
}: LegalDocumentProps) {
    const visibleLines = contentLines.filter((line) => !shouldHideLine(line));

    useLayoutEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const previousHtmlBehavior = html.style.scrollBehavior;
        const previousBodyBehavior = body.style.scrollBehavior;
        const previousLegalFlag = html.dataset.legalPage;

        html.dataset.legalPage = "true";
        html.style.scrollBehavior = "auto";
        body.style.scrollBehavior = "auto";
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });

        return () => {
            html.style.scrollBehavior = previousHtmlBehavior;
            body.style.scrollBehavior = previousBodyBehavior;
            if (previousLegalFlag === undefined) {
                delete html.dataset.legalPage;
            } else {
                html.dataset.legalPage = previousLegalFlag;
            }
        };
    }, []);

    return (
        <main className="min-h-screen bg-neutral-50 force-inter">
            <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
                <article className="p-2 sm:p-4">
                    <header className="relative mb-10 pb-2">
                        <div className="mb-2 mt-1">
                            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl text-left">
                                {title}
                            </h1>
                        </div>
                        <p className="mt-2 text-sm text-neutral-600">
                            <a
                                href={`https://${subtitle.replace(/^https?:\/\//i, "").replace(/^www\./i, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline text-blue-600 hover:text-blue-700"
                            >
                                {subtitle.replace(/^https?:\/\//i, "").replace(/^www\./i, "")}
                            </a>
                        </p>
                        <p className="mt-2 text-sm text-neutral-700">{effectiveLine}</p>
                    </header>

                    <div className="space-y-3 text-[15px] leading-7 text-neutral-800">
                        {visibleLines.map((line, index) => {
                            if (!line.trim()) {
                                return <div key={`spacer-${index}`} className="h-1" />;
                            }

                            if (isTopLevelHeading(line)) {
                                return (
                                    <h2 key={`h2-${index}`} className="pt-3 text-[1.08rem] font-semibold text-neutral-900">
                                        {line}
                                    </h2>
                                );
                            }

                            if (isNestedHeading(line)) {
                                return (
                                    <h3 key={`h3-${index}`} className="pt-2 text-base font-semibold text-neutral-900">
                                        {line}
                                    </h3>
                                );
                            }

                            return <p key={`para-${index}`}>{renderLineWithLinks(line)}</p>;
                        })}
                    </div>
                </article>
            </div>
        </main>
    );
}
