import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
const API_BASE = 'http://localhost:3001/api/ide';
export default function App() {
    const [question, setQuestion] = useState(null);
    const [code, setCode] = useState('// Loading...');
    const [tests, setTests] = useState([]);
    const [results, setResults] = useState({}); // { testId: { status, stdout, stderr, compile_output, time, memory, token } }
    const [isRunning, setIsRunning] = useState(false);

    // Track active EventSources to prevent memory leaks
    const sseConnections = useRef({});
    useEffect(() => {
        fetch(`${API_BASE}/question`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    console.error(data.error);
                    setCode('// Error: ' + data.error);
                    return;
                }
                setQuestion(data);

                // Parse starter code (assumes JSON `{ "javascript": "function..." }`)
                try {
                    const starter = typeof data.starter_code === 'string'
                        ? JSON.parse(data.starter_code)
                        : data.starter_code;
                    setCode(starter[data.language] || '// No starter code found');
                } catch (e) {
                    setCode(data.starter_code || '// Starter code parsing error');
                }
                // Parse tests
                try {
                    const parsedTests = typeof data.sample_tests === 'string'
                        ? JSON.parse(data.sample_tests)
                        : data.sample_tests;
                    setTests(parsedTests || []);

                    // Init results
                    const initialResults = {};
                    (parsedTests || []).forEach(t => {
                        initialResults[t.id] = { status: 'Pending' };
                    });
                    setResults(initialResults);
                } catch (e) {
                    console.error('Failed to parse tests', e);
                }
            })
            .catch(err => {
                console.error("Failed to load question", err);
                setCode('// Failed to connect to backend.');
            });
        return () => {
            // Cleanup all SSE connections on unmount
            Object.values(sseConnections.current).forEach(src => src.close());
        };
    }, []);
    const runAllTests = async () => {
        if (!question || tests.length === 0) return;
        setIsRunning(true);

        // Set all to running
        setResults(prev => {
            const next = { ...prev };
            tests.forEach(t => next[t.id] = { status: 'Running' });
            return next;
        });
        try {
            const res = await fetch(`${API_BASE}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: question.id,
                    code,
                    language_id: question.language_id || 93, // default to 93 (Node.js) if missing
                    tests_array: tests
                })
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);
            // We get tokenMap { test_id: "token" }
            const tokenMap = data.tokenMap;

            // Open SSE connections for each token
            Object.entries(tokenMap).forEach(([testId, token]) => {
                // If an old connection exists for this test, close it
                if (sseConnections.current[testId]) {
                    sseConnections.current[testId].close();
                }
                const eventSource = new EventSource(`${API_BASE}/result?token=${token}`);
                sseConnections.current[testId] = eventSource;

                eventSource.onmessage = (event) => {
                    const update = JSON.parse(event.data);

                    if (update.status === 'connected') {
                        // System ping
                        return;
                    }
                    // Judge0 actual webhook payload received
                    const b64Decode = (str) => {
                        if (!str) return null;
                        try { return atob(str); } catch (e) { return str; }
                    };
                    const statusDesc = update.status?.description || 'Finished';

                    setResults(prev => ({
                        ...prev,
                        [testId]: {
                            status: statusDesc,
                            stdout: b64Decode(update.stdout),
                            stderr: b64Decode(update.stderr),
                            compile_output: b64Decode(update.compile_output),
                            time: update.time,
                            memory: update.memory,
                            raw: update
                        }
                    }));
                    // Close connection once we got the final payload
                    eventSource.close();
                    delete sseConnections.current[testId];

                    // If all connections closed, reset isRunning
                    if (Object.keys(sseConnections.current).length === 0) {
                        setIsRunning(false);
                    }
                };
                eventSource.onerror = () => {
                    setResults(prev => ({
                        ...prev,
                        [testId]: { status: 'Error listening to results' }
                    }));
                    eventSource.close();
                };
            });
        } catch (err) {
            console.error(err);
            alert('Failed to submit code: ' + err.message);
            setIsRunning(false);

            // Reset to pending
            setResults(prev => {
                const next = { ...prev };
                tests.forEach(t => next[t.id] = { status: 'Pending' });
                return next;
            });
        }
    };
    const getBadgeClass = (status) => {
        if (!status || status === 'Pending') return 'badge-pending';
        if (status === 'Running') return 'badge-running';
        if (status === 'Accepted') return 'badge-success';
        return 'badge-error'; // Compile Error, Wrong Answer, Runtime Error, Time Limit Exceeded
    };
    return (
        <div className="app-container">
            {/* Left Panel: Problem Statement */}
            <div className="panel left-panel">
                <div className="panel-header">Problem Description</div>
                <div className="panel-content">
                    {question ? (
                        <>
                            <h2 className="question-title">{question.title}</h2>
                            <div className="Badge badge-pending" style={{ display: 'inline-block', marginBottom: 16 }}>
                                {question.category}
                            </div>
                            <p style={{ lineHeight: 1.6 }}>{question.statement}</p>
                        </>
                    ) : (
                        <p>Loading question...</p>
                    )}
                </div>
            </div>
            {/* Middle Panel: Editor */}
            <div className="panel middle-panel">
                <div className="panel-header">
                    <span>Editor ({question?.language || 'loading'})</span>
                    <button className="btn" onClick={runAllTests} disabled={isRunning || !question}>
                        {isRunning ? 'Running...' : 'Run All Tests'}
                    </button>
                </div>
                <div className="editor-wrapper">
                    <Editor
                        height="100%"
                        theme="vs-dark"
                        language={question?.language === 'nodejs' ? 'javascript' : (question?.language || 'javascript')}
                        value={code}
                        onChange={(val) => setCode(val)}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            padding: { top: 16 }
                        }}
                    />
                </div>
            </div>
            {/* Right Panel: Output and Test Cases */}
            <div className="panel right-panel">
                <div className="panel-header">Test Results</div>
                <div className="panel-content">
                    {tests.map(test => {
                        const res = results[test.id] || { status: 'Pending' };
                        const isFinished = res.status !== 'Pending' && res.status !== 'Running';
                        return (
                            <div key={test.id} className="result-card">
                                <div className="test-title">
                                    <span>Test Case: {test.id}</span>
                                    <span className={`Badge ${getBadgeClass(res.status)}`}>{res.status}</span>
                                </div>

                                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    <div><strong>Input:</strong></div>
                                    <div className="pre-block">{test.stdin}</div>

                                    <div><strong>Expected Output:</strong></div>
                                    <div className="pre-block">{test.expected_output}</div>
                                    {isFinished && (
                                        <>
                                            {res.stdout && (
                                                <>
                                                    <div><strong>Actual Output:</strong></div>
                                                    <div className="pre-block" style={{ color: 'var(--text-primary)' }}>
                                                        {res.stdout}
                                                    </div>
                                                </>
                                            )}
                                            {res.stderr && (
                                                <>
                                                    <div style={{ color: 'var(--error-color)' }}><strong>Stderr:</strong></div>
                                                    <div className="pre-block" style={{ color: 'var(--error-color)', borderColor: 'var(--error-color)' }}>
                                                        {res.stderr}
                                                    </div>
                                                </>
                                            )}
                                            {res.compile_output && (
                                                <>
                                                    <div style={{ color: 'var(--error-color)' }}><strong>Compile Error:</strong></div>
                                                    <div className="pre-block">{res.compile_output}</div>
                                                </>
                                            )}

                                            <div style={{ marginTop: 8, fontSize: 12 }}>
                                                {res.time && <span>⏱ Time: {res.time}s | </span>}
                                                {res.memory && <span>💾 Memory: {res.memory} KB</span>}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {tests.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No sample tests found.</p>}
                </div>
            </div>
        </div>
    );
}