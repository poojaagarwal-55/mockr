import { config } from "dotenv";
import mongoose from "mongoose";
import path from "node:path";
import { DSCodingQuestion } from "../models/DSCodingQuestion.js";

config({ path: path.resolve(process.cwd(), ".env") });
config({ path: path.resolve(process.cwd(), "../../.env") });
config({ path: path.resolve(process.cwd(), "../../.env") });

const QUESTIONS = [
    {
        questionId: "ds-sklearn-breast-cancer",
        title: "Breast Cancer Classification",
        category: "machine-learning",
        tags: ["classification", "sklearn", "logistic-regression", "model-evaluation"],
        difficulty: "Medium",
        description: `Build a binary classifier for the Wisconsin breast cancer dataset.

The environment already provides X_train, X_test, y_train, and y_test from sklearn.datasets.load_breast_cancer().

Create a LogisticRegression model, train it on X_train/y_train, and assign predictions for X_test to a variable named predictions.`,
        datasetUrl: "sklearn.datasets.load_breast_cancer()",
        dataSchema: [
            {
                tableName: "breast_cancer",
                rowCount: "569 rows",
                columns: [
                    { name: "mean radius", dtype: "float64", nullable: false, description: "Mean radius of cell nuclei" },
                    { name: "mean texture", dtype: "float64", nullable: false, description: "Mean texture of cell nuclei" },
                    { name: "mean perimeter", dtype: "float64", nullable: false, description: "Mean perimeter of cell nuclei" },
                    { name: "worst concave points", dtype: "float64", nullable: false, description: "Worst concave points measurement" },
                    { name: "target", dtype: "int64", nullable: false, description: "0 = malignant, 1 = benign" },
                ],
                sampleRows: [
                    { "mean radius": 17.99, "mean texture": 10.38, "mean perimeter": 122.8, "worst concave points": 0.2654, target: 0 },
                    { "mean radius": 20.57, "mean texture": 17.77, "mean perimeter": 132.9, "worst concave points": 0.1860, target: 0 },
                    { "mean radius": 13.54, "mean texture": 14.36, "mean perimeter": 87.46, "worst concave points": 0.1288, target: 1 },
                ],
            },
        ],
        hiddenCodeBefore: `import json
import numpy as np
import pandas as pd
from sklearn.datasets import load_breast_cancer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
import warnings
warnings.filterwarnings("ignore")

_dataset = load_breast_cancer(as_frame=True)
df = _dataset.frame.copy()
X = df.drop(columns=["target"])
y = df["target"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.25, random_state=42, stratify=y
)`,
        starterCode: `# Create and train a LogisticRegression classifier.
# Assign predictions for X_test to the variable "predictions".

model = make_pipeline(
    StandardScaler(),
    LogisticRegression(max_iter=1000, random_state=42)
)
model.fit(X_train, y_train)

predictions = model.predict(X_test)
`,
        hiddenCodeAfter: `try:
    if "model" not in globals() or model is None:
        print("ERROR: Create a trained model variable.")
        raise SystemExit(1)
    if "predictions" not in globals() or predictions is None:
        print("ERROR: Assign model predictions to a variable named predictions.")
        raise SystemExit(1)
    if len(predictions) != len(y_test):
        print(f"ERROR: predictions length {len(predictions)} does not match expected {len(y_test)}.")
        raise SystemExit(1)

    accuracy = accuracy_score(y_test, predictions)
    precision = precision_score(y_test, predictions, zero_division=0)
    recall = recall_score(y_test, predictions, zero_division=0)
    f1 = f1_score(y_test, predictions, zero_division=0)

    if accuracy < 0.93:
        print(f"ERROR: Accuracy too low: {accuracy:.4f}. Target is at least 0.93.")
        raise SystemExit(1)

    print(json.dumps({
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1_score": round(float(f1), 4),
        "predictions_count": int(len(predictions))
    }))
except SystemExit:
    raise
except Exception as exc:
    print(f"ERROR: {exc}")
    raise SystemExit(1)`,
        sampleTestCases: [
            {
                id: "sample_1",
                description: "Model trains and reaches the target accuracy on a fixed holdout set.",
                input: "",
                output: "JSON metrics with accuracy >= 0.93",
            },
        ],
        evaluationCriteria: "Candidate should use a suitable classifier, fit on X_train/y_train, predict X_test, and discuss classification metrics and leakage risk.",
        probingQuestions: [
            "Why is stratified splitting useful for classification datasets?",
            "Why might scaling help LogisticRegression here?",
            "Which metric would you monitor if false negatives are especially costly?",
        ],
        hints: [
            "Use LogisticRegression with enough max_iter.",
            "A StandardScaler plus LogisticRegression pipeline is a strong baseline.",
        ],
        solution: "Use make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, random_state=42)), fit it, and predict X_test.",
        timeLimit: 20,
        memoryLimit: 512,
        metadata: {
            datasetSource: "sklearn_builtin",
            expectedAccuracy: ">= 0.93",
        },
    },
    {
        questionId: "ds-sklearn-wine-classifier",
        title: "Wine Cultivar Classification",
        category: "machine-learning",
        tags: ["classification", "sklearn", "decision-tree", "feature-scaling"],
        difficulty: "Medium",
        description: `Train a multiclass classifier on sklearn's built-in wine dataset.

The environment provides X_train, X_test, y_train, and y_test. Create a DecisionTreeClassifier with max_depth=4 and random_state=42, fit it, and store predictions for X_test in predictions.`,
        datasetUrl: "sklearn.datasets.load_wine()",
        dataSchema: [
            {
                tableName: "wine",
                rowCount: "178 rows",
                columns: [
                    { name: "alcohol", dtype: "float64", nullable: false },
                    { name: "malic_acid", dtype: "float64", nullable: false },
                    { name: "color_intensity", dtype: "float64", nullable: false },
                    { name: "proline", dtype: "float64", nullable: false },
                    { name: "target", dtype: "int64", nullable: false, description: "Cultivar class: 0, 1, or 2" },
                ],
                sampleRows: [
                    { alcohol: 14.23, malic_acid: 1.71, color_intensity: 5.64, proline: 1065, target: 0 },
                    { alcohol: 12.37, malic_acid: 0.94, color_intensity: 1.95, proline: 520, target: 1 },
                    { alcohol: 13.17, malic_acid: 5.19, color_intensity: 7.90, proline: 725, target: 2 },
                ],
            },
        ],
        hiddenCodeBefore: `import json
from sklearn.datasets import load_wine
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import accuracy_score, f1_score

_dataset = load_wine(as_frame=True)
df = _dataset.frame.copy()
X = df.drop(columns=["target"])
y = df["target"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.30, random_state=42, stratify=y
)`,
        starterCode: `# Create a DecisionTreeClassifier with max_depth=4 and random_state=42.
# Train it, then assign predictions for X_test to "predictions".

model = DecisionTreeClassifier(max_depth=4, random_state=42)
model.fit(X_train, y_train)

predictions = model.predict(X_test)
`,
        hiddenCodeAfter: `try:
    if "model" not in globals() or not isinstance(model, DecisionTreeClassifier):
        print("ERROR: model must be a DecisionTreeClassifier.")
        raise SystemExit(1)
    if model.max_depth != 4:
        print("ERROR: DecisionTreeClassifier must use max_depth=4.")
        raise SystemExit(1)
    if "predictions" not in globals() or len(predictions) != len(y_test):
        print("ERROR: predictions must contain one prediction per X_test row.")
        raise SystemExit(1)

    accuracy = accuracy_score(y_test, predictions)
    f1 = f1_score(y_test, predictions, average="weighted", zero_division=0)
    if accuracy < 0.88:
        print(f"ERROR: Accuracy too low: {accuracy:.4f}. Target is at least 0.88.")
        raise SystemExit(1)

    print(json.dumps({
        "accuracy": round(float(accuracy), 4),
        "weighted_f1": round(float(f1), 4),
        "max_depth": model.max_depth,
        "predictions_count": int(len(predictions))
    }))
except SystemExit:
    raise
except Exception as exc:
    print(f"ERROR: {exc}")
    raise SystemExit(1)`,
        sampleTestCases: [
            {
                id: "sample_1",
                description: "Decision tree classifier meets the fixed holdout accuracy target.",
                input: "",
                output: "JSON metrics with accuracy >= 0.88",
            },
        ],
        evaluationCriteria: "Candidate should instantiate the requested DecisionTreeClassifier, fit it, predict the holdout set, and reason about overfitting.",
        probingQuestions: [
            "What happens if max_depth is too high?",
            "How would you validate this model on a tiny dataset?",
            "Which features would you inspect for interpretability?",
        ],
        hints: ["The classifier class is already imported.", "Use model.fit(X_train, y_train) before predicting."],
        solution: "DecisionTreeClassifier(max_depth=4, random_state=42).fit(X_train, y_train), then predict X_test.",
        timeLimit: 15,
        memoryLimit: 512,
        metadata: {
            datasetSource: "sklearn_builtin",
            expectedAccuracy: ">= 0.88",
        },
    },
    {
        questionId: "ds-sklearn-diabetes-regression",
        title: "Diabetes Progression Regression",
        category: "machine-learning",
        tags: ["regression", "sklearn", "linear-regression", "r2"],
        difficulty: "Medium",
        description: `Build a regression model for sklearn's built-in diabetes dataset.

The environment provides X_train, X_test, y_train, and y_test. Train a regression model and store numeric predictions for X_test in predictions.`,
        datasetUrl: "sklearn.datasets.load_diabetes()",
        dataSchema: [
            {
                tableName: "diabetes",
                rowCount: "442 rows",
                columns: [
                    { name: "age", dtype: "float64", nullable: false },
                    { name: "sex", dtype: "float64", nullable: false },
                    { name: "bmi", dtype: "float64", nullable: false },
                    { name: "bp", dtype: "float64", nullable: false },
                    { name: "target", dtype: "float64", nullable: false, description: "Disease progression measure" },
                ],
                sampleRows: [
                    { age: 0.0381, sex: 0.0507, bmi: 0.0617, bp: 0.0219, target: 151 },
                    { age: -0.0019, sex: -0.0446, bmi: -0.0515, bp: -0.0263, target: 75 },
                    { age: 0.0853, sex: 0.0507, bmi: 0.0445, bp: -0.0057, target: 141 },
                ],
            },
        ],
        hiddenCodeBefore: `import json
import numpy as np
from sklearn.datasets import load_diabetes
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

_dataset = load_diabetes(as_frame=True)
df = _dataset.frame.copy()
X = df.drop(columns=["target"])
y = df["target"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.25, random_state=42
)`,
        starterCode: `# Train a regression model and assign X_test predictions to "predictions".

model = Ridge(alpha=1.0)
model.fit(X_train, y_train)

predictions = model.predict(X_test)
`,
        hiddenCodeAfter: `try:
    if "model" not in globals() or model is None:
        print("ERROR: Create and train a regression model.")
        raise SystemExit(1)
    if "predictions" not in globals() or predictions is None:
        print("ERROR: Assign predictions for X_test to predictions.")
        raise SystemExit(1)
    if len(predictions) != len(y_test):
        print(f"ERROR: predictions length {len(predictions)} does not match expected {len(y_test)}.")
        raise SystemExit(1)

    r2 = r2_score(y_test, predictions)
    mae = mean_absolute_error(y_test, predictions)
    if r2 < 0.35:
        print(f"ERROR: R2 too low: {r2:.4f}. Target is at least 0.35.")
        raise SystemExit(1)

    print(json.dumps({
        "r2": round(float(r2), 4),
        "mae": round(float(mae), 4),
        "predictions_count": int(len(predictions))
    }))
except SystemExit:
    raise
except Exception as exc:
    print(f"ERROR: {exc}")
    raise SystemExit(1)`,
        sampleTestCases: [
            {
                id: "sample_1",
                description: "Regression model produces one numeric prediction per test row and meets the R2 target.",
                input: "",
                output: "JSON metrics with r2 >= 0.35",
            },
        ],
        evaluationCriteria: "Candidate should fit a regression model, predict X_test, and explain R2/MAE tradeoffs.",
        probingQuestions: [
            "What does R2 measure here?",
            "When would MAE be preferable to RMSE?",
            "How would you diagnose underfitting?",
        ],
        hints: ["Ridge or LinearRegression is enough for this dataset.", "The target is continuous, so use a regressor, not a classifier."],
        solution: "Fit Ridge(alpha=1.0) or LinearRegression on X_train/y_train and predict X_test.",
        timeLimit: 15,
        memoryLimit: 512,
        metadata: {
            datasetSource: "sklearn_builtin",
            expectedVarianceExplained: "R2 >= 0.35",
        },
    },
];

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(uri, {
        dbName: process.env.MONGODB_DB || "mockr_questions",
    });

    const deleteResult = await DSCodingQuestion.deleteMany({
        $or: [
            { questionId: { $in: ["ds-001", "ds-002"] } },
            { "metadata.questionId": { $in: ["ds-001", "ds-002"] } },
            { hiddenCodeBefore: /joblib\.load\(["']\/(?:tmp\/)?datasets\/(?:iris_v1|churn_v1)\.pkl["']\)/ },
            { starterCode: /joblib\.load\(["']\/(?:tmp\/)?datasets\/(?:iris_v1|churn_v1)\.pkl["']\)/ },
        ],
    });

    console.log(`Removed ${deleteResult.deletedCount} pkl-backed DS coding question(s).`);

    for (const question of QUESTIONS) {
        await DSCodingQuestion.updateOne(
            { questionId: question.questionId },
            { $set: question },
            { upsert: true }
        );
        console.log(`Upserted ${question.questionId}: ${question.title}`);
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore disconnect failures on startup errors
    }
    process.exit(1);
});
