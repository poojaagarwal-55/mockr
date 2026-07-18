jest.mock('../lib/queue.js', () => ({
  submissionQueue: { add: jest.fn() },
}));

jest.mock('../lib/prisma.js', () => ({
  prisma: {},
}));

jest.mock('../lib/judge0-client.js', () => ({
  judge0Client: {},
  LANGUAGE_IDS: {},
}));

jest.mock('./scoring-service.js', () => ({
  finalizeSubmissionScore: jest.fn(),
}));

jest.mock('../lib/redis.js', () => ({
  redis: {},
}));

jest.mock('../lib/websocket-gateway.js', () => ({
  sendNotificationToUser: jest.fn(),
}));

jest.mock('../lib/judge0-errors.js', () => ({
  isJudge0InfrastructureError: jest.fn(),
}));

jest.mock('../lib/env.js', () => ({
  env: {},
}));

jest.mock('../lib/judge0-concurrency.js', () => ({
  runWithJudge0Concurrency: jest.fn(),
}));

jest.mock('mongoose', () => ({
  __esModule: true,
  default: {},
}));

const { judge0Client } = require('../lib/judge0-client.js') as {
  judge0Client: {
    executeCode: jest.Mock;
    executeBatch: jest.Mock;
  };
};
const { runWithJudge0Concurrency } = require('../lib/judge0-concurrency.js') as {
  runWithJudge0Concurrency: jest.Mock;
};
const { buildFinalCode, compareOutput, runAllTestCases } = require('./submission-worker.js') as typeof import('./submission-worker.js');

describe('submission worker helpers', () => {
  it('normalizes comparable outputs like the main preview runner', () => {
    expect(compareOutput('[1, 2]', '[1,2]')).toBe(true);
    expect(compareOutput('4\n', '4')).toBe(true);
    expect(compareOutput('True', 'true')).toBe(true);
  });

  it('builds a C++ adapter when wrapper expects a free function but user code uses class Solution', () => {
    const userCode = `class Solution {
public:
    long long minimumPrefixAverageBoost(int n, long long k, vector<long long>& arr) {
        return 0;
    }
};`;

    const wrapperCode = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    long long k;
    cin >> n >> k;
    vector<long long> arr(n);
    for (int i = 0; i < n; i++) cin >> arr[i];
    cout << minimumPrefixAverageBoost(n, k, arr) << '\\n';
}`;

    const finalCode = buildFinalCode(userCode, wrapperCode, 'cpp');

    expect(finalCode).toContain('Solution sol;');
    expect(finalCode).toContain('return sol.minimumPrefixAverageBoost(n, k, arr);');
    expect(finalCode.indexOf('return sol.minimumPrefixAverageBoost(n, k, arr);')).toBeLessThan(finalCode.indexOf('int main()'));
  });

  it('does not treat C++ recursive return statements as class method declarations', () => {
    const userCode = `#define ll long long
class Solution {
public:
    bool cnd(ll mid, vector<ll> &v, int k) {
        return true;
    }

    ll bs(vector<ll> &v, int k, ll lo, ll hi) {
        if (lo > hi) {
            return lo;
        }

        ll mid = (lo + hi) >> 1;

        if (cnd(mid, v, k)) {
            return bs(v, k, lo, mid - 1);
        } else {
            return bs(v, k, mid + 1, hi);
        }
    }

    long long solve(int n, int k, vector<long long>& v) {
        return bs(v, k, 0, 10);
    }
};`;

    const wrapperCode = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n, k;
    cin >> n >> k;
    vector<long long> v(n);
    for (int i = 0; i < n; i++) cin >> v[i];
    cout << solve(n, k, v) << '\\n';
    return 0;
}`;

    const finalCode = buildFinalCode(userCode, wrapperCode, 'cpp');

    expect(finalCode).toContain('return bs(v, k, lo, mid - 1);');
    expect(finalCode).toContain('return bs(v, k, mid + 1, hi);');
    expect(finalCode).not.toContain('return bs(v, k, lo, mid - 1) {');
    expect(finalCode).not.toContain('return bs(v, k, mid + 1, hi) {');
    expect(finalCode).toContain('long long solve(int n, int k, vector<long long>& v) {');
    expect(finalCode).toContain('return sol.solve(n, k, v);');
    expect(finalCode).not.toContain('bool cnd(ll mid, vector<ll> &v, int k) {\n    Solution sol;');
    expect(finalCode).not.toContain('ll bs(vector<ll> &v, int k, ll lo, ll hi) {\n    Solution sol;');
  });

  it('builds a Python adapter when wrapper expects a free function but user code uses class Solution', () => {
    const userCode = `class Solution:
    def max_subarray_sum_k(self, nums, k):
        return sum(nums[:k])`;

    const wrapperCode = `nums = [20, 19, 5, 7, 3]
print(max_subarray_sum_k(nums, 2))`;

    const finalCode = buildFinalCode(userCode, wrapperCode, 'python3');

    expect(finalCode).toContain('def max_subarray_sum_k(nums, k):');
    expect(finalCode).toContain('return Solution().max_subarray_sum_k(nums, k)');
    expect(finalCode.indexOf('def max_subarray_sum_k(nums, k):')).toBeLessThan(finalCode.indexOf('nums = [20'));
  });

  it('builds a JavaScript adapter when wrapper expects a free function but user code uses class Solution', () => {
    const userCode = `class Solution {
  maxSubarraySumK(nums, k) {
    return nums.slice(0, k).reduce((sum, value) => sum + value, 0);
  }
}`;

    const wrapperCode = `console.log(maxSubarraySumK([20, 19, 5, 7, 3], 2));`;

    const finalCode = buildFinalCode(userCode, wrapperCode, 'javascript');

    expect(finalCode).toContain('function maxSubarraySumK(nums, k) {');
    expect(finalCode).toContain('return new Solution().maxSubarraySumK(nums, k);');
    expect(finalCode.indexOf('function maxSubarraySumK(nums, k) {')).toBeLessThan(finalCode.indexOf('console.log'));
  });

  it('runs every hidden test case instead of stopping at 20', async () => {
    const testCases = Array.from({ length: 25 }, (_, index) => ({
      input: String(index),
      expected: String(index),
    }));

    judge0Client.executeCode = jest.fn().mockResolvedValue({
      status: { id: 3, description: 'Accepted' },
      stdout: '0',
      stderr: null,
      compile_output: null,
      message: null,
      time: '0.01',
      memory: 1024,
    });
    judge0Client.executeBatch = jest.fn().mockResolvedValue(
      testCases.slice(1).map((testCase) => ({
        status: { id: 3, description: 'Accepted' },
        stdout: testCase.expected,
        stderr: null,
        compile_output: null,
        message: null,
        time: '0.01',
        memory: 1024,
      }))
    );
    runWithJudge0Concurrency.mockImplementation((fn: () => unknown) => fn());

    const results = await runAllTestCases('source', 'cpp', testCases);

    expect(results).toHaveLength(25);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(judge0Client.executeBatch).toHaveBeenCalledWith(
      'source',
      'cpp',
      testCases.slice(1).map((testCase) => testCase.input),
      undefined
    );
  });
});
