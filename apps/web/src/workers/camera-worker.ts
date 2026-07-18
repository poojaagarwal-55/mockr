import type { ProctoringEventDraft } from "@/lib/proctoring/types";

type WorkerInboundMessage =
    | { type: "init" }
    | { type: "frame"; bitmap: ImageBitmap; capturedAt: number };

type WorkerOutboundMessage =
    | { type: "event"; event: ProctoringEventDraft }
    | { type: "model_error"; message: string };

type CameraWorkerGlobalScope = {
    postMessage(message: WorkerOutboundMessage): void;
    onmessage: ((message: MessageEvent<WorkerInboundMessage>) => void) | null;
};

type FaceLandmarkerInstance = {
    detectForVideo(source: ImageBitmap | OffscreenCanvas, timestamp: number): {
        faceLandmarks?: unknown[];
        facialTransformationMatrixes?: Array<{ data?: number[] | Float32Array }>;
    };
};

type OrtTensor = {
    data: ArrayLike<number>;
    dims: readonly number[];
};

type OrtSession = {
    inputNames: string[];
    outputNames: string[];
    run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
};

type OrtModule = {
    env?: {
        wasm?: {
            wasmPaths?: string | Record<string, string>;
            numThreads?: number;
        };
    };
    Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
    InferenceSession: {
        create(
            modelUrl: string,
            options?: {
                executionProviders?: string[];
                graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
            }
        ): Promise<OrtSession>;
    };
};

type YoloRuntime = {
    ort: OrtModule;
    session: OrtSession;
};

const ctx = self as unknown as CameraWorkerGlobalScope;
const LOOKING_EMIT_INTERVAL_MS = 5000;
const FACE_MULTIPLE_EMIT_INTERVAL_MS = 5000;
const OBJECT_DEBOUNCE_MS = 10000;
const FACE_ABSENT_BOUNDARIES = [2000, 5000, 15000];
const YOLO_INPUT_SIZE = 640;
const PERSON_CLASS_ID = 0;
const GENERIC_OBJECT_CONFIDENCE_THRESHOLD = 0.25;
const OBJECT_CHANGE_WIDTH = 64;
const OBJECT_CHANGE_HEIGHT = 48;
const OBJECT_CHANGE_PIXEL_THRESHOLD = 32;
const OBJECT_CHANGE_RATIO_THRESHOLD = 0.055;
const ORT_VERSION = "1.23.0";
const ORT_CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/${ORT_VERSION}/`;
const ORT_MODULE_URLS = [
    "/vendor/onnxruntime/ort.all.bundle.min.mjs",
    `${ORT_CDN_BASE}ort.all.bundle.min.mjs`,
];
const YOLO_MODEL_URLS = [
    "/models/yolo26n.onnx",
    "https://huggingface.co/flotek/yolo26n-onnx/resolve/main/model.onnx",
];

let faceLandmarker: FaceLandmarkerInstance | null = null;
let yoloRuntime: YoloRuntime | null = null;
let modelReady = false;
let modelFailed = false;
let loadingPromise: Promise<void> | null = null;
let frameCanvas: OffscreenCanvas | null = null;
let frameContext: OffscreenCanvasRenderingContext2D | null = null;
let yoloCanvas: OffscreenCanvas | null = null;
let yoloContext: OffscreenCanvasRenderingContext2D | null = null;
let objectChangeCanvas: OffscreenCanvas | null = null;
let objectChangeContext: OffscreenCanvasRenderingContext2D | null = null;
let previousObjectFrame: Uint8Array | null = null;

let faceAbsentSince: number | null = null;
let emittedFaceAbsentBoundaries = new Set<number>();
let faceMultipleSince: number | null = null;
let lastFaceMultipleEmitAt = 0;
let lookingAwaySince: number | null = null;
let lookingAwayDirection: "left" | "right" | "down" | "up" | null = null;
let lastLookingAwayEmitAt = 0;
const lastObjectEmitByLabel = new Map<string, number>();

ctx.onmessage = (message: MessageEvent<WorkerInboundMessage>) => {
    if (message.data.type === "init") {
        void loadModels();
        return;
    }

    if (message.data.type === "frame") {
        void handleFrame(message.data.bitmap, message.data.capturedAt);
    }
};

async function loadModels(): Promise<void> {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
        try {
            const [{ FaceLandmarker, FilesetResolver }, loadedYoloRuntime] = await Promise.all([
                import("@mediapipe/tasks-vision"),
                loadYoloRuntime(),
            ]);

            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
            );
            faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath:
                        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
                    delegate: "CPU",
                },
                runningMode: "VIDEO",
                numFaces: 4,
                outputFacialTransformationMatrixes: true,
            }) as FaceLandmarkerInstance;
            yoloRuntime = loadedYoloRuntime;
            modelReady = true;
        } catch (error) {
            modelFailed = true;
            post({ type: "model_error", message: error instanceof Error ? error.message : "Unknown model error" });
        }
    })();
    return loadingPromise;
}

async function handleFrame(bitmap: ImageBitmap, capturedAt: number): Promise<void> {
    try {
        const frame = drawBitmapToCanvas(bitmap);
        processVisualObjectChange(frame, capturedAt);

        if (modelFailed) return;
        if (!modelReady) {
            await loadModels();
        }
        if (!faceLandmarker || !yoloRuntime) return;

        const faceResult = faceLandmarker.detectForVideo(frame, capturedAt);
        processFaces(faceResult, capturedAt);
        await processObjects(frame, capturedAt);
    } catch (error) {
        post({ type: "model_error", message: error instanceof Error ? error.message : "Frame processing failed" });
    } finally {
        bitmap.close();
    }
}

function drawBitmapToCanvas(bitmap: ImageBitmap): OffscreenCanvas {
    if (!frameCanvas || frameCanvas.width !== bitmap.width || frameCanvas.height !== bitmap.height) {
        frameCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        frameContext = frameCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    }

    if (!frameContext) {
        throw new Error("Camera worker could not create a 2D frame context.");
    }

    frameContext.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    return frameCanvas;
}

function processFaces(
    result: ReturnType<FaceLandmarkerInstance["detectForVideo"]>,
    now: number
): void {
    const faceCount = result.faceLandmarks?.length ?? 0;
    processFaceAbsence(faceCount, now);
    processMultipleFaces(faceCount, now);
    processLookingAway(result, now);
}

function processFaceAbsence(faceCount: number, now: number): void {
    if (faceCount > 0) {
        faceAbsentSince = null;
        emittedFaceAbsentBoundaries = new Set();
        return;
    }

    faceAbsentSince ??= now;
    const duration = now - faceAbsentSince;
    const boundary = FACE_ABSENT_BOUNDARIES.find(
        (candidate) => duration >= candidate && !emittedFaceAbsentBoundaries.has(candidate)
    );
    if (!boundary) return;

    emittedFaceAbsentBoundaries.add(boundary);
    emit({ event_type: "face_absent", payload: { duration_ms: Math.round(duration) } });
}

function processMultipleFaces(faceCount: number, now: number): void {
    if (faceCount < 2) {
        faceMultipleSince = null;
        lastFaceMultipleEmitAt = 0;
        return;
    }

    faceMultipleSince ??= now;
    if (!lastFaceMultipleEmitAt || now - lastFaceMultipleEmitAt >= FACE_MULTIPLE_EMIT_INTERVAL_MS) {
        lastFaceMultipleEmitAt = now;
        emit({
            event_type: "face_multiple",
            payload: { count: faceCount, duration_ms: Math.round(now - faceMultipleSince) },
        });
    }
}

function processLookingAway(
    result: ReturnType<FaceLandmarkerInstance["detectForVideo"]>,
    now: number
): void {
    const direction = getLookingAwayDirection(result);
    if (!direction) {
        lookingAwaySince = null;
        lookingAwayDirection = null;
        lastLookingAwayEmitAt = 0;
        return;
    }

    if (direction !== lookingAwayDirection) {
        lookingAwaySince = now;
        lookingAwayDirection = direction;
        lastLookingAwayEmitAt = 0;
        return;
    }

    lookingAwaySince ??= now;
    const duration = now - lookingAwaySince;
    if (duration < 3000) return;
    if (lastLookingAwayEmitAt && now - lastLookingAwayEmitAt < LOOKING_EMIT_INTERVAL_MS) return;

    lastLookingAwayEmitAt = now;
    emit({
        event_type: "face_looking_away",
        payload: { direction, duration_ms: Math.round(duration) },
    });
}

function getLookingAwayDirection(
    result: ReturnType<FaceLandmarkerInstance["detectForVideo"]>
): "left" | "right" | "down" | "up" | null {
    const matrix = result.facialTransformationMatrixes?.[0]?.data;
    if (!matrix || matrix.length < 16) return null;

    const yaw = Math.atan2(Number(matrix[8]), Number(matrix[10])) * (180 / Math.PI);
    const pitch = Math.atan2(
        -Number(matrix[9]),
        Math.sqrt(Number(matrix[8]) ** 2 + Number(matrix[10]) ** 2)
    ) * (180 / Math.PI);

    if (pitch > 25) return "down";
    if (pitch < -25) return "up";
    if (yaw > 30) return "right";
    if (yaw < -30) return "left";
    return null;
}

async function processObjects(source: OffscreenCanvas, now: number): Promise<void> {
    if (!yoloRuntime) return;
    const detection = await detectGenericObject(source, yoloRuntime);
    if (!detection) return;

    const lastEmit = lastObjectEmitByLabel.get("object") ?? 0;
    if (now - lastEmit < OBJECT_DEBOUNCE_MS) return;
    lastObjectEmitByLabel.set("object", now);
    emit({
        event_type: "object_detected",
        payload: {
            label: "object",
            confidence: detection.confidence,
        },
    });
}

function emit(event: ProctoringEventDraft): void {
    post({ type: "event", event });
}

function post(message: WorkerOutboundMessage): void {
    ctx.postMessage(message);
}

async function loadYoloRuntime(): Promise<YoloRuntime> {
    const ort = await loadOrtModule();
    let lastError: unknown = null;

    for (const modelUrl of YOLO_MODEL_URLS) {
        for (const executionProviders of yoloExecutionProviderCandidates()) {
            try {
                const session = await ort.InferenceSession.create(modelUrl, {
                    executionProviders,
                    graphOptimizationLevel: "all",
                });
                return { ort, session };
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error("YOLO mobile detector could not be loaded.");
}

async function loadOrtModule(): Promise<OrtModule> {
    let lastError: unknown = null;

    for (const moduleUrl of ORT_MODULE_URLS) {
        try {
            const ort = await import(/* webpackIgnore: true */ moduleUrl) as OrtModule;
            if (ort.env?.wasm) {
                ort.env.wasm.numThreads = 1;
                ort.env.wasm.wasmPaths = moduleUrl.startsWith("http")
                    ? ORT_CDN_BASE
                    : "/vendor/onnxruntime/";
            }
            return ort;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error("ONNX Runtime Web could not be loaded.");
}

function yoloExecutionProviderCandidates(): string[][] {
    const webgpuSupported = typeof navigator !== "undefined" && "gpu" in navigator;
    return webgpuSupported
        ? [["webgpu", "wasm"], ["wasm"]]
        : [["wasm"]];
}

async function detectGenericObject(
    source: OffscreenCanvas,
    runtime: YoloRuntime
): Promise<{ confidence: number } | null> {
    const input = prepareYoloInput(source, runtime.ort);
    const inputName = runtime.session.inputNames[0];
    const outputName = runtime.session.outputNames[0];
    const results = await runtime.session.run({ [inputName]: input });
    const output = results[outputName] ?? results[Object.keys(results)[0]];
    if (!output) return null;
    return bestGenericObjectDetection(output);
}

function prepareYoloInput(source: OffscreenCanvas, ort: OrtModule): unknown {
    const canvas = ensureYoloCanvas();
    const context = yoloContext;
    if (!context) {
        throw new Error("Camera worker could not create a YOLO preprocessing context.");
    }

    const scale = Math.min(YOLO_INPUT_SIZE / source.width, YOLO_INPUT_SIZE / source.height);
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    const dx = Math.floor((YOLO_INPUT_SIZE - width) / 2);
    const dy = Math.floor((YOLO_INPUT_SIZE - height) / 2);

    context.fillStyle = "rgb(114, 114, 114)";
    context.fillRect(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
    context.drawImage(source, 0, 0, source.width, source.height, dx, dy, width, height);

    const pixels = context.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE).data;
    const values = new Float32Array(3 * YOLO_INPUT_SIZE * YOLO_INPUT_SIZE);
    const planeSize = YOLO_INPUT_SIZE * YOLO_INPUT_SIZE;

    for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < planeSize; pixelIndex += 1, sourceIndex += 4) {
        values[pixelIndex] = pixels[sourceIndex] / 255;
        values[planeSize + pixelIndex] = pixels[sourceIndex + 1] / 255;
        values[(planeSize * 2) + pixelIndex] = pixels[sourceIndex + 2] / 255;
    }

    return new ort.Tensor("float32", values, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
}

function ensureYoloCanvas(): OffscreenCanvas {
    if (!yoloCanvas) {
        yoloCanvas = new OffscreenCanvas(YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
        yoloContext = yoloCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    }
    return yoloCanvas;
}

function bestGenericObjectDetection(output: OrtTensor): { confidence: number } | null {
    const dims = Array.from(output.dims);
    const data = output.data;
    if (dims.length < 2 || data.length === 0) return null;

    const best = dims[dims.length - 1] === 6
        ? bestPostProcessedDetection(data, dims)
        : bestRawYoloDetection(data, dims);

    return best >= GENERIC_OBJECT_CONFIDENCE_THRESHOLD ? { confidence: best } : null;
}

function bestPostProcessedDetection(data: ArrayLike<number>, dims: number[]): number {
    const rowCount = dims.slice(0, -1).reduce((total, value) => total * value, 1);
    let best = 0;

    for (let row = 0; row < rowCount; row += 1) {
        const offset = row * 6;
        const firstCandidate = Number(data[offset + 4] || 0);
        const secondCandidate = Number(data[offset + 5] || 0);
        const confidence = firstCandidate <= 1 ? firstCandidate : secondCandidate;
        const classId = Math.round(firstCandidate <= 1 ? secondCandidate : firstCandidate);
        if (classId !== PERSON_CLASS_ID && confidence > best) best = confidence;
    }

    return best;
}

function bestRawYoloDetection(data: ArrayLike<number>, dims: number[]): number {
    const rows = dims[dims.length - 2];
    const columns = dims[dims.length - 1];

    if (columns > 6 && rows > columns) {
        return bestRawRowMajorDetection(data, rows, columns);
    }

    if (rows > 6 && columns > rows) {
        return bestRawChannelMajorDetection(data, rows, columns);
    }

    return 0;
}

function bestRawRowMajorDetection(data: ArrayLike<number>, anchorCount: number, channelCount: number): number {
    const hasObjectness = channelCount === 85;
    const classOffset = hasObjectness ? 5 : 4;
    let best = 0;

    for (let anchor = 0; anchor < anchorCount; anchor += 1) {
        const offset = anchor * channelCount;
        const objectness = hasObjectness ? Number(data[offset + 4] || 0) : 1;
        for (let classId = 0; classId < channelCount - classOffset; classId += 1) {
            if (classId === PERSON_CLASS_ID) continue;
            const confidence = objectness * Number(data[offset + classOffset + classId] || 0);
            if (confidence > best) best = confidence;
        }
    }

    return best;
}

function bestRawChannelMajorDetection(data: ArrayLike<number>, channelCount: number, anchorCount: number): number {
    const hasObjectness = channelCount === 85;
    const classOffset = hasObjectness ? 5 : 4;
    let best = 0;

    for (let anchor = 0; anchor < anchorCount; anchor += 1) {
        const objectness = hasObjectness ? Number(data[(4 * anchorCount) + anchor] || 0) : 1;
        for (let classId = 0; classId < channelCount - classOffset; classId += 1) {
            if (classId === PERSON_CLASS_ID) continue;
            const confidence = objectness * Number(data[((classOffset + classId) * anchorCount) + anchor] || 0);
            if (confidence > best) best = confidence;
        }
    }

    return best;
}

function processVisualObjectChange(source: OffscreenCanvas, now: number): void {
    const current = captureObjectChangeFrame(source);
    if (!previousObjectFrame) {
        previousObjectFrame = current;
        return;
    }

    let changedPixels = 0;
    for (let index = 0; index < current.length; index += 1) {
        if (Math.abs(current[index] - previousObjectFrame[index]) >= OBJECT_CHANGE_PIXEL_THRESHOLD) {
            changedPixels += 1;
        }
    }
    previousObjectFrame = current;

    const changedRatio = changedPixels / current.length;
    if (changedRatio < OBJECT_CHANGE_RATIO_THRESHOLD) return;

    const lastEmit = lastObjectEmitByLabel.get("object") ?? 0;
    if (now - lastEmit < OBJECT_DEBOUNCE_MS) return;
    lastObjectEmitByLabel.set("object", now);
    emit({
        event_type: "object_detected",
        payload: {
            label: "object",
            confidence: Math.min(0.99, Math.max(0.25, changedRatio * 4)),
        },
    });
}

function captureObjectChangeFrame(source: OffscreenCanvas): Uint8Array {
    const canvas = ensureObjectChangeCanvas();
    if (!objectChangeContext) {
        throw new Error("Camera worker could not create an object-change context.");
    }

    objectChangeContext.drawImage(source, 0, 0, OBJECT_CHANGE_WIDTH, OBJECT_CHANGE_HEIGHT);
    const pixels = objectChangeContext.getImageData(0, 0, OBJECT_CHANGE_WIDTH, OBJECT_CHANGE_HEIGHT).data;
    const frame = new Uint8Array(OBJECT_CHANGE_WIDTH * OBJECT_CHANGE_HEIGHT);

    for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < frame.length; pixelIndex += 1, sourceIndex += 4) {
        frame[pixelIndex] = Math.round(
            (pixels[sourceIndex] * 0.299) +
            (pixels[sourceIndex + 1] * 0.587) +
            (pixels[sourceIndex + 2] * 0.114)
        );
    }

    return frame;
}

function ensureObjectChangeCanvas(): OffscreenCanvas {
    if (!objectChangeCanvas) {
        objectChangeCanvas = new OffscreenCanvas(OBJECT_CHANGE_WIDTH, OBJECT_CHANGE_HEIGHT);
        objectChangeContext = objectChangeCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    }
    return objectChangeCanvas;
}

export { };
