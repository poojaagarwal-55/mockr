// ============================================
// LaTeX Compiler Service
// ============================================
// Accepts LaTeX source, compiles with pdflatex,
// returns PDF as base64 or structured errors.

const Fastify = require("fastify");
const { execFile } = require("child_process");
const { writeFile, readFile, mkdtemp, rm } = require("fs/promises");
const { tmpdir } = require("os");
const path = require("path");

const MAX_COMPILE_TIME = parseInt(process.env.MAX_COMPILE_TIME || "30", 10) * 1000;
const PORT = parseInt(process.env.PORT || "3002", 10);

const fastify = Fastify({ logger: true });

// Health check
fastify.get("/health", async () => ({ status: "ok" }));

// Compile endpoint
fastify.post("/compile", async (request, reply) => {
    const { source } = request.body || {};

    if (!source || typeof source !== "string") {
        return reply.status(400).send({
            success: false,
            errors: [{ line: 0, message: "No LaTeX source provided", severity: "error" }],
        });
    }

    if (source.length > 500_000) {
        return reply.status(400).send({
            success: false,
            errors: [{ line: 0, message: "Source exceeds 500KB limit", severity: "error" }],
        });
    }

    let tmpDir;
    try {
        // Create temp directory
        tmpDir = await mkdtemp(path.join(tmpdir(), "latex-"));
        const texFile = path.join(tmpDir, "document.tex");
        const pdfFile = path.join(tmpDir, "document.pdf");
        const logFile = path.join(tmpDir, "document.log");

        await writeFile(texFile, source, "utf8");

        // Run pdflatex with --no-shell-escape for security
        // Run twice for references/TOC
        await runPdflatex(texFile, tmpDir);
        await runPdflatex(texFile, tmpDir);

        // Read the generated PDF
        const pdfBuffer = await readFile(pdfFile);
        const pdfBase64 = pdfBuffer.toString("base64");

        // Check for warnings in log
        let warnings = [];
        try {
            const logContent = await readFile(logFile, "utf8");
            warnings = extractWarnings(logContent);
        } catch {
            // log file may not exist
        }

        return {
            success: true,
            pdf: pdfBase64,
            warnings,
        };
    } catch (err) {
        // Parse errors from the compilation output
        const compilerOutput = getCompilerOutput(err);
        const errors = parseLatexErrors(compilerOutput);

        if (errors.length === 0) {
            fastify.log.error({ compilerOutput }, "LaTeX compile failed without parsed error lines");
        }

        return reply.status(422).send({
            success: false,
            errors:
                errors.length > 0
                    ? errors
                    : [{ line: 0, message: compilerOutput || "Compilation failed", severity: "error" }],
            warnings: [],
        });
    } finally {
        // Cleanup temp directory
        if (tmpDir) {
            rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
    }
});

function runPdflatex(texFile, cwd) {
    return new Promise((resolve, reject) => {
        const proc = execFile(
            "pdflatex",
            [
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-no-shell-escape",
                "-output-directory=" + cwd,
                texFile,
            ],
            {
                cwd,
                timeout: MAX_COMPILE_TIME,
                maxBuffer: 10 * 1024 * 1024, // 10MB
            },
            (error, stdout, stderr) => {
                if (error) {
                    // pdflatex often exits with code 1 but still produces output
                    // Check if a PDF was generated despite the error
                    const fs = require("fs");
                    const pdfPath = path.join(cwd, "document.pdf");
                    if (fs.existsSync(pdfPath)) {
                        resolve(stdout);
                    } else {
                        error.stderr = stderr;
                        error.stdout = stdout;
                        reject(error);
                    }
                } else {
                    resolve(stdout);
                }
            }
        );
    });
}

function parseLatexErrors(output) {
    const errors = [];
    const lines = output.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match "! Error message"
        if (line.startsWith("!")) {
            const message = line.substring(2).trim();
            let lineNum = 0;

            // Look for "l.123" in nearby lines
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const match = lines[j].match(/\bl\.(\d+)\b/);
                if (match) {
                    lineNum = parseInt(match[1], 10);
                    break;
                }
            }

            // Fallback: look backwards a few lines too, since TeX can emit context before the error line.
            if (lineNum === 0) {
                for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
                    const match = lines[j].match(/\bl\.(\d+)\b/);
                    if (match) {
                        lineNum = parseInt(match[1], 10);
                        break;
                    }
                }
            }

            errors.push({ line: lineNum, message, severity: "error" });
        }
    }

    return errors;
}

function getCompilerOutput(err) {
    const stderr = typeof err?.stderr === "string" ? err.stderr : "";
    const stdout = typeof err?.stdout === "string" ? err.stdout : "";
    const message = typeof err?.message === "string" ? err.message : "";

    const combined = `${stderr}\n${stdout}`.trim();
    if (combined) {
        return combined;
    }

    return message || "Unknown compilation error";
}

function extractWarnings(logContent) {
    const warnings = [];
    const lines = logContent.split("\n");

    for (const line of lines) {
        if (line.includes("Warning:") && !line.includes("Font Warning")) {
            warnings.push(line.trim());
        }
    }

    return warnings.slice(0, 10); // Cap at 10 warnings
}

// Start server
fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
    fastify.log.info(`LaTeX compiler service running on port ${PORT}`);
});
