# Maximum Sum Subarray of Size K - Contest Snippets

Use this input format in sample and hidden test cases:

```text
[20,19,5,7,3],3
```

Expected output:

```text
44
```

The wrappers below read exactly that format, call the candidate function, and print one integer.

## Python 3

Starter code:

```python
def max_subarray_sum_k(nums, k):
    # Write your code here
    return 0
```

Wrapper code:

```python
import ast
import sys

<USER_CODE>

def parse_input(raw):
    raw = raw.strip()
    if not raw:
        return [], 0
    value = ast.literal_eval(raw)
    if isinstance(value, tuple) and len(value) == 2:
        return list(value[0]), int(value[1])
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], list):
        return list(value[0]), int(value[1])
    raise ValueError("Input must be like [20,19,5,7,3],3")

nums, k = parse_input(sys.stdin.read())
print(max_subarray_sum_k(nums, k))
```

Optimized solution:

```python
def max_subarray_sum_k(nums, k):
    window = sum(nums[:k])
    best = window
    for i in range(k, len(nums)):
        window += nums[i] - nums[i - k]
        best = max(best, window)
    return best
```

## C++

Starter code:

```cpp
long long maxSubarraySumK(vector<long long>& nums, int k) {
    // Write your code here
    return 0;
}
```

Wrapper code:

```cpp
#include <bits/stdc++.h>
using namespace std;

<USER_CODE>

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    string input, line;
    while (getline(cin, line)) input += line;

    size_t left = input.find('[');
    size_t right = input.find(']');
    if (left == string::npos || right == string::npos || right <= left) return 0;

    vector<long long> nums;
    string arr = input.substr(left + 1, right - left - 1);
    string token;
    stringstream ss(arr);
    while (getline(ss, token, ',')) {
        if (!token.empty()) nums.push_back(stoll(token));
    }

    string rest = input.substr(right + 1);
    size_t comma = rest.find(',');
    int k = stoi(comma == string::npos ? rest : rest.substr(comma + 1));

    cout << maxSubarraySumK(nums, k);
    return 0;
}
```

Optimized solution:

```cpp
long long maxSubarraySumK(vector<long long>& nums, int k) {
    long long window = 0;
    for (int i = 0; i < k; i++) window += nums[i];
    long long best = window;
    for (int i = k; i < (int)nums.size(); i++) {
        window += nums[i] - nums[i - k];
        best = max(best, window);
    }
    return best;
}
```

## Java

Starter code:

```java
class Solution {
    public long maxSubarraySumK(long[] nums, int k) {
        // Write your code here
        return 0;
    }
}
```

Wrapper code:

```java
import java.io.*;
import java.util.*;

<USER_CODE>

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line.trim());
        String input = sb.toString();

        int left = input.indexOf('[');
        int right = input.indexOf(']');
        if (left < 0 || right < 0 || right <= left) return;

        String arr = input.substring(left + 1, right).trim();
        List<Long> values = new ArrayList<>();
        if (!arr.isEmpty()) {
            for (String part : arr.split(",")) {
                values.add(Long.parseLong(part.trim()));
            }
        }

        String rest = input.substring(right + 1);
        int comma = rest.indexOf(',');
        int k = Integer.parseInt((comma >= 0 ? rest.substring(comma + 1) : rest).trim());

        long[] nums = new long[values.size()];
        for (int i = 0; i < values.size(); i++) nums[i] = values.get(i);

        System.out.print(new Solution().maxSubarraySumK(nums, k));
    }
}
```

Optimized solution:

```java
class Solution {
    public long maxSubarraySumK(long[] nums, int k) {
        long window = 0;
        for (int i = 0; i < k; i++) window += nums[i];
        long best = window;
        for (int i = k; i < nums.length; i++) {
            window += nums[i] - nums[i - k];
            best = Math.max(best, window);
        }
        return best;
    }
}
```

## JavaScript

Starter code:

```javascript
function maxSubarraySumK(nums, k) {
    // Write your code here
    return 0;
}
```

Wrapper code:

```javascript
const fs = require("fs");

<USER_CODE>

function parseInput(raw) {
    raw = raw.trim();
    const right = raw.indexOf("]");
    const nums = JSON.parse(raw.slice(0, right + 1));
    const k = Number(raw.slice(right + 1).replace(/^,/, "").trim());
    return { nums, k };
}

const { nums, k } = parseInput(fs.readFileSync(0, "utf8"));
console.log(String(maxSubarraySumK(nums, k)));
```

Optimized solution:

```javascript
function maxSubarraySumK(nums, k) {
    let window = 0;
    for (let i = 0; i < k; i++) window += nums[i];
    let best = window;
    for (let i = k; i < nums.length; i++) {
        window += nums[i] - nums[i - k];
        best = Math.max(best, window);
    }
    return best;
}
```
