require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const app = express();
app.use(cors());
app.use(express.json()); // IMPORTANT: needed for parsing judge0 webhooks and frontend JSON
const port = process.env.PORT || 3001;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
// Cache for Judge0 languages: e.g. "javascript": 93
let languageMap = {};
let languageIdMap = {};
// Optional: Rate Limiting to prevent abuse of the Judge0 API
const runLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 submissions per `window`
    message: { error: 'Too many submissions, please try again later.' }
});
// SSE Clients map tracker: token -> response object
// When Judge0 fires our webhook, we lookup the client via token and send the data down
const sseClients = new Map();
/**
 * Utility: fetch available languages from Judge0
 */
async function loadLanguages() {
    try {
        console.log("Fetching Judge0 languages from:", process.env.JUDGE0_URL);
        const response = await axios.get(`${process.env.JUDGE0_URL}/languages`, {
            headers: {
                'x-rapidapi-host': process.env.JUDGE0_HOST,
                'x-rapidapi-key': process.env.JUDGE0_KEY
            }
        });

        response.data.forEach(lang => {
            // e.g. lang: { id: 93, name: 'JavaScript (Node.js 18.15.0)' }
            languageIdMap[lang.id] = lang.name;
            // create a generic mapping for common names if needed, or rely on db matching
            // this simple map just lowercases the first word for basic lookups
            const baseName = lang.name.split(' ')[0].toLowerCase();
            if (!languageMap[baseName]) {
                languageMap[baseName] = lang.id;
            }
        });
        console.log(`Loaded ${response.data.length} languages from Judge0.`);
    } catch (error) {
        console.error("Failed to fetch languages. Ensure JUDGE0_KEY is set.", error.message);
    }
}
/**
 * Helper: encode to base64
 */
const toB64 = (str) => Buffer.from(str || '').toString('base64');
/**
 * Endpoint 1: Fetch a random DSA question
 * GET /api/ide/question
 */
app.get('/api/ide/question', async (req, res) => {
    try {
        // Note: To get a random row securely, PostgREST doesn't have a direct RAND() normally without a view or rpc.
        // For this demo, we'll fetch all DSA IDs and pick one randomly.
        const { data: qList, error: qErr } = await supabase
            .from('questions')
            .select('id')
            .eq('category', 'DSA');
        if (qErr) throw qErr;
        if (!qList || qList.length === 0) return res.status(404).json({ error: 'No DSA questions found.' });
        const randomId = qList[Math.floor(Math.random() * qList.length)].id;

        // Now fetch the full question
        const { data: question, error: fetchErr } = await supabase
            .from('questions')
            .select('id, title, statement, category, language, language_id, starter_code, sample_tests')
            .eq('id', randomId)
            .single();
        if (fetchErr) throw fetchErr;
        res.json(question);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * Endpoint 1b: Fetch specific question
 */
app.get('/api/ide/question/:id', async (req, res) => {
    try {
        const { data: question, error } = await supabase
            .from('questions')
            .select('id, title, statement, category, language, language_id, starter_code, sample_tests')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        res.json(question);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * Endpoint 2: Run Code
 * POST /api/ide/run
 * Body: { question_id, code, language_id, run_type, test_id?, tests_array[] }
 */
app.post('/api/ide/run', runLimiter, async (req, res) => {
    try {
        const { question_id, code, language_id, tests_array } = req.body;

        if (!tests_array || tests_array.length === 0) {
            return res.status(400).json({ error: 'No tests provided.' });
        }
        // Prepare batch submission or individual submissions
        // For Approach A: Multi-TestCase iteration
        const submissions = tests_array.map(testCase => ({
            source_code: toB64(code),
            language_id: language_id,
            stdin: toB64(testCase.stdin),
            expected_output: testCase.expected_output ? toB64(testCase.expected_output) : null,
            cpu_time_limit: 2,
            memory_limit: 262144, // 256MB
            max_output_size: 131072, // 128KB - truncate huge outputs
            enable_network: false, // Strict resource limits
            // Important: Webhook callback! Base64 decoded test_id is passed as custom data if needed, but Judge0 gives us a unique token.
            callback_url: `${process.env.BASE_URL}/api/ide/judge0-callback`
        }));
        // Submit batch to Judge0
        const response = await axios.post(`${process.env.JUDGE0_URL}/submissions/batch?base64_encoded=true`, {
            submissions
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': process.env.JUDGE0_HOST,
                'x-rapidapi-key': process.env.JUDGE0_KEY
            }
        });
        // response.data will be an array of { token: "uuid..." }
        // We map these tokens back to our test_ids so the frontend knows which test is which token
        const tokenMap = {};
        tests_array.forEach((test, index) => {
            const token = response.data[index].token;
            tokenMap[test.id] = token;

            // Log submission (simulated db insert)
            // await supabase.from('submissions').insert({ question_id, test_id: test.id, token });
        });
        res.json({ success: true, tokenMap });
    } catch (err) {
        console.error("Execution error:", err?.response?.data || err.message);
        res.status(500).json({ error: 'Failed to submit execution to Judge0' });
    }
});
/**
 * Endpoint 3: Subscribe to SSE Results
 * GET /api/ide/result?token=...
 * The frontend connects to this to wait for the Judge0 webhook to arrive.
 */
app.get('/api/ide/result', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).send('Token required');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.set(token, res);
    // Send initial connected ping
    res.write(`data: {"status":"connected"}\n\n`);
    req.on('close', () => {
        sseClients.delete(token);
    });
});
/**
 * Endpoint 4: Judge0 Webhook Callback
 * POST /api/ide/judge0-callback
 * Judge0 calls this endpoint when a submission finishes.
 */
app.put('/api/ide/judge0-callback', async (req, res) => {
    // Judge0 sends PUT by default. Accept POST or PUT.
    handleJudgeRequest(req, res);
});
app.post('/api/ide/judge0-callback', async (req, res) => {
    handleJudgeRequest(req, res);
});
function handleJudgeRequest(req, res) {
    const result = req.body;
    const token = result.token;

    // Acknowledge receipt to Judge0 immediately
    res.status(200).send("OK");
    if (!token || !sseClients.has(token)) {
        // The client might be polling instead, or disconnected. We could save result to DB here.
        return;
    }
    // Push result to frontend SSE
    const clientResponse = sseClients.get(token);
    clientResponse.write(`data: ${JSON.stringify(result)}\n\n`);

    // Optional: close connection if we don't expect more updates for this token
    // clientResponse.end(); 
    // We'll leave it open and let the frontend close it, or close here:
    clientResponse.end();
    sseClients.delete(token);
}
app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
    loadLanguages();
});
