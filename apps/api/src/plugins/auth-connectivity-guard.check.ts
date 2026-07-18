import assert from "node:assert/strict";
import { isConnectivityIssue } from "../lib/user-facing-errors.js";

assert.equal(
    isConnectivityIssue({ message: "fetch failed" }),
    true,
    "Expected fetch/network failure to be treated as connectivity issue"
);

assert.equal(
    isConnectivityIssue({ status: 503, message: "service unavailable" }),
    true,
    "Expected upstream 5xx to be treated as connectivity issue"
);

assert.equal(
    isConnectivityIssue({ status: 401, message: "JWT expired" }),
    false,
    "Expected auth failure to not be treated as connectivity issue"
);

assert.equal(
    isConnectivityIssue({ message: "invalid jwt" }),
    false,
    "Expected invalid token to not be treated as connectivity issue"
);

console.log("auth connectivity guard checks passed");
