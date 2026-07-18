import { connectMongoDB } from './src/lib/mongodb.js';
import { SystemDesignQuestion } from './src/models/system-design-question.js';

async function run() {
    await connectMongoDB();
    const map = { "SDE1": ["Easy", "Medium"], "SDE2": ["Easy", "Medium", "Hard"] };
    const diffs = map["SDE2"];
    let [rawDoc] = await SystemDesignQuestion.aggregate([
        { $match: { difficulty: { $in: diffs } } },
        { $sample: { size: 1 } }
    ]);
    console.log("Pass 1 doc:", rawDoc?.title);
    if (!rawDoc) {
        [rawDoc] = await SystemDesignQuestion.aggregate([{ $sample: { size: 1 } }]);
        console.log("Pass 4 doc:", rawDoc?.title);
    }
    process.exit(0);
}
run().catch(console.error);
