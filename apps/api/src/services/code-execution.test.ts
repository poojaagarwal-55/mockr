jest.mock('../lib/prisma.js', () => ({
  prisma: {},
}));

import { __testUtils, resolveLanguageId } from './code-execution.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('code-execution helpers', () => {
  test('compareOutput treats JSON spacing differences as equal', () => {
    const { compareOutput } = __testUtils;

    expect(compareOutput('[0,1]\n', '[0, 1]').passed).toBe(true);
    expect(compareOutput('  -1  ', '-1').passed).toBe(true);
  });

  test('compareOutput still rejects different values', () => {
    const { compareOutput } = __testUtils;

    expect(compareOutput('[0,2]', '[0,1]').passed).toBe(false);
  });

  test('compareOutput treats group-anagrams output as order-insensitive', () => {
    const { compareOutput } = __testUtils;

    const expected = "[['abc', 'bca', 'cab'], ['xyz', 'zyx', 'yxz']]";
    const actual = '[["yxz", "xyz", "zyx"], ["cab", "abc", "bca"]]';

    expect(compareOutput(actual, expected, { problemSlug: 'group-anagrams' }).passed).toBe(true);
  });

  test('compareOutput remains strict without group-anagrams context', () => {
    const { compareOutput } = __testUtils;

    const expected = '[[1,2],[3,4]]';
    const actual = '[[3,4],[1,2]]';

    expect(compareOutput(actual, expected).passed).toBe(false);
  });

  test('combineCodeWithWrapper keeps Go package/import at top', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = 'func twoSum(nums []int, target int) []int { return []int{} }';
    const wrapperCode = 'package main\n\nimport "fmt"\n\nfunc main(){fmt.Println(twoSum([]int{1,2},3))}';

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'golang');

    expect(combined.startsWith('package main')).toBe(true);
    expect(combined).toContain('func twoSum(nums []int, target int) []int');
  });

  test('combineCodeWithWrapper keeps C# using directives before classes', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = 'public class Solution { public int[] TwoSum(int[] nums, int target){ return new int[0]; } }';
    const wrapperCode = 'using System;\n\nclass Program { static void Main() {} }';

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'csharp');

    expect(combined.startsWith('using System;')).toBe(true);
    expect(combined.indexOf('using System;')).toBeLessThan(combined.indexOf('public class Solution'));
    expect(combined).toContain('class Program { static void Main() {} }');
  });

  test('combineCodeWithWrapper keeps C++ helper types before user code and bridges global calls', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution {
public:
    ListNode* mergeTwoLists(ListNode* a, ListNode* b) { return a ? a : b; }
};`;

    const wrapperCode = `#include <bits/stdc++.h>
using namespace std;

struct ListNode { int val; ListNode* next; };
ListNode* mergeTwoLists(ListNode* list1, ListNode* list2);

class Solution {
public:
    ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) { return nullptr; }
};

int main() {
    ListNode* a = nullptr;
    ListNode* b = nullptr;
    auto out = mergeTwoLists(a, b);
    (void)out;
    return 0;
}`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'cpp');

    expect(combined.indexOf('struct ListNode')).toBeLessThan(combined.indexOf('class Solution'));
    expect(combined).toContain('ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {');
    expect(combined).toContain('Solution sol;');
    expect(combined).toContain('return sol.mergeTwoLists(list1, list2);');
  });

  test('combineCodeWithWrapper bridges direct global C++ runner calls when wrapper has no prototype', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution {
public:
    long long minimumPrefixAverageBoost(int n, long long k, vector<long long>& arr) {
        return 4;
    }
};`;

    const wrapperCode = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    long long k;
    cin >> n >> k;
    vector<long long> arr(n);
    for (int i = 0; i < n; ++i) cin >> arr[i];
    cout << minimumPrefixAverageBoost(n, k, arr) << '\\n';
    return 0;
}`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'cpp');

    expect(combined).toContain('long long minimumPrefixAverageBoost(int n, long long k, vector<long long>& arr) {');
    expect(combined).toContain('Solution sol;');
    expect(combined).toContain('return sol.minimumPrefixAverageBoost(n, k, arr);');
  });

  test('combineCodeWithWrapper directly replaces C++ USER_CODE placeholder without generating adapters', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution {
public:
    long long largestDivisionLoad(vector<int>& parent, vector<int>& load) {
        int n = parent.size();
        vector<vector<int>> children(n);
        return 0;
    }
};`;

    const wrapperCode = `#include <bits/stdc++.h>
using namespace std;

<USER_CODE>

int main() {
    int n; cin >> n;
    vector<int> parent(n), load(n);
    Solution solution;
    cout << solution.largestDivisionLoad(parent, load);
    return 0;
}`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'cpp');

    expect(combined).toBe(wrapperCode.replace(/<USER_CODE>/g, userCode));
    expect(combined).toContain('vector<vector<int>> children(n);');
    expect(combined).not.toContain('vector<vector<int>> children(n) {');
    expect(combined).not.toContain('Solution sol;');
    expect(combined).not.toContain('return sol.children(n);');
  });

  test('combineCodeWithWrapper does not parse C++ recursive return calls as methods', () => {
    const { combineCodeWithWrapper } = __testUtils;

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
    for (int i = 0; i < n; ++i) cin >> v[i];
    cout << solve(n, k, v) << '\\n';
    return 0;
}`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'cpp');

    expect(combined).toContain('return bs(v, k, lo, mid - 1);');
    expect(combined).toContain('return bs(v, k, mid + 1, hi);');
    expect(combined).not.toContain('return bs(v, k, lo, mid - 1) {');
    expect(combined).not.toContain('return bs(v, k, mid + 1, hi) {');
    expect(combined).toContain('long long solve(int n, int k, vector<long long>& v) {');
    expect(combined).toContain('return sol.solve(n, k, v);');
    expect(combined).not.toContain('bool cnd(ll mid, vector<ll> &v, int k) {\n    Solution sol;');
    expect(combined).not.toContain('ll bs(vector<ll> &v, int k, ll lo, ll hi) {\n    Solution sol;');
  });

  test.each([
    {
      language: 'java',
      userCode: `class Solution {
    public int solve(int x) { return x + 1; }
}`,
      wrapperCode: `import java.util.*;

<USER_CODE>

class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().solve(1));
    }
}`,
    },
    {
      language: 'python3',
      userCode: `class Solution:
    def solve(self, x):
        return x + 1`,
      wrapperCode: `<USER_CODE>

print(Solution().solve(1))`,
    },
    {
      language: 'javascript',
      userCode: `class Solution {
  solve(x) {
    return x + 1;
  }
}`,
      wrapperCode: `<USER_CODE>

console.log(new Solution().solve(1));`,
    },
  ])('combineCodeWithWrapper directly replaces $language USER_CODE placeholder', ({ language, userCode, wrapperCode }) => {
    const { combineCodeWithWrapper } = __testUtils;

    expect(combineCodeWithWrapper(userCode, wrapperCode, language)).toBe(
      wrapperCode.replace(/<USER_CODE>/g, userCode)
    );
  });

  test('combineCodeWithWrapper injects using namespace std for unqualified STL user code', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution {
public:
    vector<int> f(vector<int>& nums) { return nums; }
};`;

    const wrapperCode = `#include <bits/stdc++.h>
std::vector<int> f(std::vector<int>& nums);
int main(){ return 0; }`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'cpp');

    expect(combined).toContain('using namespace std;');
    expect(combined.indexOf('using namespace std;')).toBeLessThan(combined.indexOf('class Solution'));
  });

  test('combineCodeWithWrapper injects bits header when wrapper lacks broad STL includes', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution {
public:
    vector<int> f(vector<int>& nums) { return nums; }
};`;

    const wrapperCode = `#include <iostream>
int main(){ return 0; }`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'cpp');

    expect(combined).toContain('#include <bits/stdc++.h>');
    expect(combined.indexOf('#include <bits/stdc++.h>')).toBeLessThan(combined.indexOf('class Solution'));
  });

  test('combineCodeWithWrapper bridges Python class Solution methods to free-function wrappers', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution:
    def max_subarray_sum_k(self, nums, k):
        return sum(nums[:k])`;

    const wrapperCode = `nums = [20, 19, 5, 7, 3]
print(max_subarray_sum_k(nums, 2))`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'python3');

    expect(combined).toContain('def max_subarray_sum_k(nums, k):');
    expect(combined).toContain('return Solution().max_subarray_sum_k(nums, k)');
    expect(combined.indexOf('def max_subarray_sum_k(nums, k):')).toBeLessThan(combined.indexOf('nums = [20'));
  });

  test('combineCodeWithWrapper bridges JavaScript class Solution methods to free-function wrappers', () => {
    const { combineCodeWithWrapper } = __testUtils;

    const userCode = `class Solution {
  maxSubarraySumK(nums, k) {
    return nums.slice(0, k).reduce((sum, value) => sum + value, 0);
  }
}`;

    const wrapperCode = `console.log(maxSubarraySumK([20, 19, 5, 7, 3], 2));`;

    const combined = combineCodeWithWrapper(userCode, wrapperCode, 'javascript');

    expect(combined).toContain('function maxSubarraySumK(nums, k) {');
    expect(combined).toContain('return new Solution().maxSubarraySumK(nums, k);');
    expect(combined.indexOf('function maxSubarraySumK(nums, k) {')).toBeLessThan(combined.indexOf('console.log'));
  });

  test('buildHiddenFailureDetail includes exact hidden failure details for wrong answers', () => {
    const { buildHiddenFailureDetail } = __testUtils;

    const result = {
      token: 'tok-1',
      stdout: Buffer.from('3').toString('base64'),
      stderr: null,
      compile_output: null,
      status: { id: 4, description: 'Wrong Answer' },
      time: '0.012',
      memory: 1024,
    };

    const detail = buildHiddenFailureDetail(result as any, {
      id: 'h1',
      input: '{"nums":[1,2],"target":3}',
      expected: '4',
      type: 'hidden',
      orderIdx: 0,
    });

    expect(detail.input).toBe('{"nums":[1,2],"target":3}');
    expect(detail.expectedOutput).toBe('4');
    expect(detail.actualOutput).toBe('3');
    expect(detail.status).toBe('Wrong Answer');
    expect(detail.time).toBe('0.012s');
    expect(detail.memory).toBe('1024KB');
  });

  test('buildHiddenFailureDetail surfaces compile output when execution fails before stdout', () => {
    const { buildHiddenFailureDetail } = __testUtils;

    const compileMessage = 'error: expected ; before return';
    const result = {
      token: 'tok-2',
      stdout: null,
      stderr: null,
      compile_output: Buffer.from(compileMessage).toString('base64'),
      status: { id: 6, description: 'Compilation Error' },
      time: null,
      memory: null,
    };

    const detail = buildHiddenFailureDetail(result as any, {
      id: 'h2',
      input: '1 2',
      expected: '3',
      type: 'hidden',
      orderIdx: 1,
    });

    expect(detail.status).toBe('Compilation Error');
    expect(detail.actualOutput).toContain('expected ; before return');
    expect(detail.compileOutput).toContain('expected ; before return');
    expect(detail.time).toBe('N/A');
    expect(detail.memory).toBe('N/A');
  });

  test('splitJudge0ResultsBySampleCount preserves sample and hidden ordering', () => {
    const { splitJudge0ResultsBySampleCount } = __testUtils;

    const combined = [
      { token: 's1' },
      { token: 's2' },
      { token: 'h1' },
      { token: 'h2' },
    ];

    const { sampleJudge0Results, hiddenJudge0Results } =
      splitJudge0ResultsBySampleCount(combined as any, 2);

    expect(sampleJudge0Results.map((r: any) => r.token)).toEqual(['s1', 's2']);
    expect(hiddenJudge0Results.map((r: any) => r.token)).toEqual(['h1', 'h2']);
  });

  test('splitJudge0ResultsBySampleCount handles out-of-range sample count safely', () => {
    const { splitJudge0ResultsBySampleCount } = __testUtils;

    const combined = [{ token: 'only' }];
    const { sampleJudge0Results, hiddenJudge0Results } =
      splitJudge0ResultsBySampleCount(combined as any, 10);

    expect(sampleJudge0Results.map((r: any) => r.token)).toEqual(['only']);
    expect(hiddenJudge0Results).toEqual([]);
  });

  test('resolveLanguageId maps python3 to Judge0 Python', () => {
    expect(resolveLanguageId(undefined, 'python3')).toBe(71);
  });

  test('buildDSHiddenCodeBefore injects local dataset bytes for ds-001', async () => {
    const { buildDSHiddenCodeBefore } = __testUtils;
    const originalDatasetDir = process.env.DS_DATASET_SOURCE_DIR;
    const datasetDir = mkdtempSync(path.join(tmpdir(), 'if-datasets-'));
    writeFileSync(path.join(datasetDir, 'iris_v1.pkl'), Buffer.from('fake-pkl-bytes'));
    process.env.DS_DATASET_SOURCE_DIR = datasetDir;

    try {
      const hiddenCode = await buildDSHiddenCodeBefore({
        questionId: 'ds-001',
        hiddenCodeBefore: 'import joblib\ndata = joblib.load("/datasets/iris_v1.pkl")',
      } as any);

      expect(hiddenCode).toContain('import base64');
      expect(hiddenCode).toContain('os.makedirs("/tmp/datasets", exist_ok=True)');
      expect(hiddenCode).toContain('ZmFrZS1wa2wtYnl0ZXM=');
      expect(hiddenCode).not.toContain('urlretrieve');
      expect(hiddenCode).toContain('data = joblib.load("/tmp/datasets/iris_v1.pkl")');
    } finally {
      rmSync(datasetDir, { recursive: true, force: true });
      if (originalDatasetDir === undefined) delete process.env.DS_DATASET_SOURCE_DIR;
      else process.env.DS_DATASET_SOURCE_DIR = originalDatasetDir;
    }
  });

  test('buildDSHiddenCodeBefore does not inject pkl bytes when ds question does not reference pkl', async () => {
    const { buildDSHiddenCodeBefore } = __testUtils;

    const hiddenCode = await buildDSHiddenCodeBefore({
      questionId: 'ds-001',
      hiddenCodeBefore: 'import pandas as pd\ndata = pd.DataFrame({"x": [1, 2, 3]})',
    } as any);

    expect(hiddenCode).toBe('import pandas as pd\ndata = pd.DataFrame({"x": [1, 2, 3]})');
    expect(hiddenCode).not.toContain('_DATASET_B64');
  });

  test('buildDSHiddenCodeBefore leaves non-dataset DS questions unchanged', async () => {
    const { buildDSHiddenCodeBefore } = __testUtils;

    await expect(buildDSHiddenCodeBefore({
      questionId: 'ds-003',
      hiddenCodeBefore: 'print("setup")',
    } as any)).resolves.toBe('print("setup")');
  });
});
