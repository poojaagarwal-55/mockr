require('dotenv').config({ path: '../../apps/.env' });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const data = [
  // 1. Reverse Linked List
  {
    slug: 'reverse-linked-list',
    language: 'java',
    wrapperCode: `public class Main {
    public static void main(String[] args) throws Exception {
        java.util.Scanner sc = new java.util.Scanner(System.in);
        String line = sc.nextLine().trim();

        // Remove brackets
        line = line.substring(1, line.length() - 1).trim();

        ListNode head = null, tail = null;

        if (!line.isEmpty()) {
            String[] parts = line.split(",");
            for (String part : parts) {
                int val = Integer.parseInt(part.trim());
                ListNode node = new ListNode(val);
                if (head == null) { head = node; tail = node; }
                else { tail.next = node; tail = node; }
            }
        }

        Solution sol = new Solution();
        ListNode result = sol.reverseList(head);

        // Print result
        StringBuilder sb = new StringBuilder("[");
        ListNode cur = result;
        while (cur != null) {
            sb.append(cur.val);
            if (cur.next != null) sb.append(",");
            cur = cur.next;
        }
        sb.append("]");
        System.out.println(sb.toString());
    }
}`
  },
  {
    slug: 'reverse-linked-list',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};

class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        // your code here
        return head;
    }
};`,
    wrapperCode: `// I/O helpers for linked list
ListNode* buildList(const string& s) {
    vector<int> vals;
    int i = 0, n = s.size();
    while (i < n && s[i] != '[') i++;
    i++;
    while (i < n && s[i] != ']') {
        if (s[i] == ',' || s[i] == ' ') { i++; continue; }
        int sign = 1;
        if (s[i] == '-') { sign = -1; i++; }
        int num = 0;
        while (i < n && s[i] >= '0' && s[i] <= '9') { num = num*10 + (s[i]-'0'); i++; }
        vals.push_back(sign*num);
    }
    ListNode dummy;
    ListNode* cur = &dummy;
    for (int v : vals) { cur->next = new ListNode(v); cur = cur->next; }
    return dummy.next;
}

void printList(ListNode* head) {
    cout << "[";
    bool first = true;
    while (head) {
        if (!first) cout << ",";
        cout << head->val;
        first = false;
        head = head->next;
    }
    cout << "]" << endl;
}

int main() {
    string line;
    getline(cin, line);
    ListNode* head = buildList(line);
    Solution sol;
    ListNode* result = sol.reverseList(head);
    printList(result);
    return 0;
}`
  },
  {
    slug: 'reverse-linked-list',
    language: 'python',
    starter: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def reverseList(self, head: ListNode) -> ListNode:
        pass`,
    wrapperCode: `if __name__ == "__main__":
    line = input().strip()

    # Input format: [1,2,3,4,5]
    line = line[1:-1]  # remove brackets
    head = None
    tail = None

    if line:
        for val in line.split(","):
            node = ListNode(int(val.strip()))
            if head is None:
                head = node
                tail = node
            else:
                tail.next = node
                tail = node

    sol = Solution()
    result = sol.reverseList(head)

    # Print result
    vals = []
    while result:
        vals.append(str(result.val))
        result = result.next
    print("[" + ",".join(vals) + "]")`
  },
  
  // 2. Merge Intervals
  {
    slug: 'merge-intervals',
    language: 'java',
    wrapperCode: `import java.util.Scanner;
public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();

        // Remove outer brackets [[...]]
        line = line.substring(2, line.length() - 2).trim();

        // Split by "],[" to get individual intervals
        String[] parts = line.split("\\\\],\\[\\\\");

        int[][] intervals = new int[parts.length][2];
        for (int i = 0; i < parts.length; i++) {
            String[] nums = parts[i].split(",");
            intervals[i][0] = Integer.parseInt(nums[0].trim());
            intervals[i][1] = Integer.parseInt(nums[1].trim());
        }

        Solution sol = new Solution();
        int[][] result = sol.merge(intervals);

        // Print result
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < result.length; i++) {
            sb.append("[").append(result[i][0]).append(",").append(result[i][1]).append("]");
            if (i < result.length - 1) sb.append(",");
        }
        sb.append("]");
        System.out.println(sb.toString());
    }
}`
  },
  {
    slug: 'merge-intervals',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> merge(vector<vector<int>>& intervals) {
        // your code here
        return {};
    }
};`,
    wrapperCode: `int main() {
    string line;
    getline(cin, line);

    vector<vector<int>> intervals;

    int i = 0;
    while (i < (int)line.size()) {
        if (line[i] == '[') {
            // skip outer bracket
            if (i + 1 < (int)line.size() && line[i + 1] == '[') {
                i++;
                continue;
            }

            // find closing bracket for this inner [x,y]
            int j = line.find(']', i);
            if (j == (int)string::npos) break;

            string token = line.substr(i + 1, j - i - 1);

            // trim whitespace
            token.erase(remove_if(token.begin(), token.end(), ::isspace), token.end());

            int comma = token.find(',');
            if (comma != (int)string::npos) {
                string s1 = token.substr(0, comma);
                string s2 = token.substr(comma + 1);

                if (!s1.empty() && !s2.empty()) {
                    intervals.push_back({stoi(s1), stoi(s2)});
                }
            }
            i = j + 1;
        } else {
            i++;
        }
    }

    Solution sol;
    vector<vector<int>> result = sol.merge(intervals);

    // Print result
    cout << "[";
    for (int i = 0; i < (int)result.size(); i++) {
        cout << "[" << result[i][0] << "," << result[i][1] << "]";
        if (i < (int)result.size() - 1) cout << ",";
    }
    cout << "]" << endl;

    return 0;
}`
  },
  {
    slug: 'merge-intervals',
    language: 'python',
    starter: `class Solution:
    def merge(self, intervals: list[list[int]]) -> list[list[int]]:
        pass`,
    wrapperCode: `if __name__ == "__main__":
    line = input().strip()

    # Input format: [[1,3],[2,6],[8,10],[15,18]]
    import json
    intervals = json.loads(line)

    sol = Solution()
    result = sol.merge(intervals)

    # Print result
    print("[" + ",".join("[" + ",".join(map(str, pair)) + "]" for pair in result) + "]")`
  },
  
  // 3. Two Sum
  {
    slug: 'two-sum',
    language: 'java',
    wrapperCode: `import java.util.*;
public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);

        // Parse nums array from first line: [2,7,11,15]
        String line = sc.nextLine().trim();
        line = line.substring(1, line.length() - 1).trim();
        String[] parts = line.split(",");
        int[] nums = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            nums[i] = Integer.parseInt(parts[i].trim());
        }

        // Parse target from second line: 9
        int target = Integer.parseInt(sc.nextLine().trim());

        Solution sol = new Solution();
        int[] result = sol.twoSum(nums, target);

        // Print result
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < result.length; i++) {
            sb.append(result[i]);
            if (i < result.length - 1) sb.append(",");
        }
        sb.append("]");
        System.out.println(sb.toString());
    }
}`
  },
  {
    slug: 'two-sum',
    language: 'cpp',
    wrapperCode: `#include <bits/stdc++.h>
using namespace std;
int main() {
    // Parse nums array from first line: [2,7,11,15]
    string line;
    getline(cin, line);
    line = line.substr(1, line.size() - 2);

    vector<int> nums;
    stringstream ss(line);
    string token;
    while (getline(ss, token, ',')) {
        nums.push_back(stoi(token));
    }

    // Parse target from second line: 9
    int target;
    cin >> target;

    Solution sol;
    vector<int> result = sol.twoSum(nums, target);

    // Print result
    cout << "[";
    for (int i = 0; i < result.size(); i++) {
        cout << result[i];
        if (i < result.size() - 1) cout << ",";
    }
    cout << "]" << endl;

    return 0;
}`
  },
  {
    slug: 'two-sum',
    language: 'python',
    wrapperCode: `if __name__ == "__main__":
    line = input().strip()
    line = line[1:-1]
    nums = [int(x.strip()) for x in line.split(",")]

    target = int(input().strip())

    sol = Solution()
    result = sol.twoSum(nums, target)

    print("[" + ",".join(str(x) for x in result) + "]")`
  },
  {
    slug: 'two-sum',
    language: 'javascript',
    wrapperCode: `const lines = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split('\\n');

const line = lines[0].trim().slice(1, -1); // Remove brackets
const nums = line.split(',').map(x => parseInt(x.trim()));

// Parse target from second line: 9
const target = parseInt(lines[1].trim());

const result = twoSum(nums, target);

// Print result
console.log('[' + result.join(',') + ']');`
  },

  // 4. Longest Increasing Subsequence
  {
    slug: 'longest-increasing-subsequence',
    language: 'java',
    wrapperCode: `import java.util.*;
public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();

        // Remove {"nums": and } to extract the array
        // Input format: {"nums":[10,9,2,5,3,7,101,18]}
        line = line.replaceAll(".*\\\\[", "").replaceAll("\\\\].*", "");

        // Parse nums
        String[] parts = line.split(",");
        int[] nums = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            nums[i] = Integer.parseInt(parts[i].trim());
        }

        Solution sol = new Solution();
        int result = sol.lengthOfLIS(nums);

        // Print result
        System.out.println(result);
    }
}`
  },
  {
    slug: 'longest-increasing-subsequence',
    language: 'cpp',
    wrapperCode: `#include <bits/stdc++.h>
using namespace std;
int main() {
    string line;
    getline(cin, line);

    // Input format: {"nums":[10,9,2,5,3,7,101,18]}
    // Strip everything up to and including '[' and from ']' onward
    int start = line.find('[') + 1;
    int end   = line.find(']');
    line = line.substr(start, end - start);

    // Parse nums
    vector<int> nums;
    stringstream ss(line);
    string token;
    while (getline(ss, token, ',')) {
        nums.push_back(stoi(token));
    }

    Solution sol;
    int result = sol.lengthOfLIS(nums);

    // Print result
    cout << result << endl;

    return 0;
}`
  },
  {
    slug: 'longest-increasing-subsequence',
    language: 'python',
    starter: `class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        pass`,
    wrapperCode: `import sys
import json

if __name__ == "__main__":
    line = input().strip()

    # Input format: {"nums":[10,9,2,5,3,7,101,18]}
    data = json.loads(line)
    nums = data["nums"]

    sol = Solution()
    result = sol.lengthOfLIS(nums)

    # Print result
    print(result)`
  },

  // 5. Detect Cycle in Directed Graph
  {
    slug: 'detect-cycle-directed',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool hasCycle(int n, const vector<vector<int>>& adj) {
        // your code here
        return false;
    }
};`,
    wrapperCode: `int main() {
    string line;
    getline(cin, line);

    // Input format: {"n":2,"edges":[[0,1],[1,0]]}
    // Parse n
    int n;
    sscanf(line.c_str(), "{\\"n\\":%d", &n);

    // Extract edges array
    int start = line.find("[[") + 1;
    int end   = line.find("]]") + 1;
    string edgePart = line.substr(start, end - start);

    // Build adjacency list
    vector<vector<int>> adj(n);
    stringstream ss(edgePart);
    string token;
    while (getline(ss, token, ']')) {
        if (token.find('[') == string::npos) continue;
        token = token.substr(token.find('[') + 1);
        if (token.empty()) continue;
        stringstream ss2(token);
        string num;
        vector<int> edge;
        while (getline(ss2, num, ',')) {
            if (!num.empty()) edge.push_back(stoi(num));
        }
        if (edge.size() == 2) adj[edge[0]].push_back(edge[1]);
    }

    Solution sol;
    bool result = sol.hasCycle(n, adj);

    // Print result
    cout << (result ? "true" : "false") << endl;

    return 0;
}`
  },
  {
    slug: 'detect-cycle-directed',
    language: 'java',
    starter: `import java.util.*;

class Solution {
    public boolean hasCycle(int n, List<List<Integer>> edges) {
        // your code here
        return false;
    }
}`,
    wrapperCode: `import java.util.*;
public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();

        // Input format: {"n":2,"edges":[[0,1],[1,0]]}
        // Parse n
        int nStart = line.indexOf("\\"n\\":") + 4;
        int nEnd   = line.indexOf(",", nStart);
        int n = Integer.parseInt(line.substring(nStart, nEnd).trim());

        // Extract edges array [[...]]
        int start = line.indexOf("[[") + 1;
        int end   = line.indexOf("]]") + 1;
        String edgePart = line.substring(start, end);

        // Build edges list
        List<List<Integer>> edges = new ArrayList<>();
        String[] tokens = edgePart.split("\\\\].,\\\\[");
        for (String token : tokens) {
            token = token.replaceAll("[\\\\[\\\\]]", "").trim();
            if (token.isEmpty()) continue;
            String[] nums = token.split(",");
            List<Integer> edge = new ArrayList<>();
            edge.add(Integer.parseInt(nums[0].trim()));
            edge.add(Integer.parseInt(nums[1].trim()));
            edges.add(edge);
        }

        Solution sol = new Solution();
        boolean result = sol.hasCycle(n, edges);

        // Print result
        System.out.println(result);
    }
}`
  },
  {
    slug: 'detect-cycle-directed',
    language: 'python',
    starter: `class Solution:
    def hasCycle(self, n: int, edges: list[list[int]]) -> bool:
        pass`,
    wrapperCode: `import json

if __name__ == "__main__":
    line = input().strip()

    # Input format: {"n":2,"edges":[[0,1],[1,0]]}
    data = json.loads(line)
    n     = data["n"]
    edges = data["edges"]

    sol = Solution()
    result = sol.hasCycle(n, edges)

    # Print result
    print(str(result).lower())`
  },

  // 6. LRU Cache
  {
    slug: 'lru-cache',
    language: 'python',
    starter: `class LRUCache:
    def __init__(self, capacity: int):
        pass

    def get(self, key: int) -> int:
        pass

    def put(self, key: int, value: int) -> None:
        pass`,
    wrapperCode: `import sys

if __name__ == "__main__":
    lines = sys.stdin.read().splitlines()

    # First line is capacity
    capacity = int(lines[0].strip())
    cache = LRUCache(capacity)

    # Remaining lines are operations
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if parts[0] == "get":
            key = int(parts[1])
            print(cache.get(key))
        elif parts[0] == "put":
            key   = int(parts[1])
            value = int(parts[2])
            cache.put(key, value)`
  },
  {
    slug: 'lru-cache',
    language: 'java',
    starter: `class LRUCache {
    public LRUCache(int capacity) {

    }

    public int get(int key) {
        return -1;
    }

    public void put(int key, int value) {

    }
}`,
    wrapperCode: `import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);

        // First line is capacity
        int capacity = Integer.parseInt(sc.nextLine().trim());
        LRUCache cache = new LRUCache(capacity);

        // Remaining lines are operations
        while (sc.hasNextLine()) {
            String line = sc.nextLine().trim();
            if (line.isEmpty()) continue;

            String[] parts = line.split(" ");
            if (parts[0].equals("get")) {
                int key = Integer.parseInt(parts[1]);
                System.out.println(cache.get(key));
            } else if (parts[0].equals("put")) {
                int key   = Integer.parseInt(parts[1]);
                int value = Integer.parseInt(parts[2]);
                cache.put(key, value);
            }
        }
    }
}`
  },
  {
    slug: 'lru-cache',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class LRUCache {
public:
    LRUCache(int capacity) {

    }

    int get(int key) {
        return -1;
    }

    void put(int key, int value) {

    }
};`,
    wrapperCode: `int main() {
    string line;

    // First line is capacity
    getline(cin, line);
    // int capacity = stoi(line.trim()); // (fixed missing trim implementation)
    line.erase(line.find_last_not_of(" \\n\\r\\t")+1);
    int capacity = stoi(line);
    LRUCache cache(capacity);

    // Remaining lines are operations
    while (getline(cin, line)) {
        if (line.empty()) continue;
        istringstream iss(line);
        string op;
        iss >> op;
        if (op == "get") {
            int key;
            iss >> key;
            cout << cache.get(key) << "\\n";
        } else if (op == "put") {
            int key, value;
            iss >> key >> value;
            cache.put(key, value);
        }
    }
    return 0;
}`
  },

  // 7. Longest Substring Without Repeating Characters
  {
    slug: 'longest-substring-without-repeating',
    language: 'java',
    starter: `class Solution {
    public int lengthOfLongestSubstring(String s) {
        // your code here
        return 0;
    }
}`,
    wrapperCode: `import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);

        // Input is just a string
        if (!sc.hasNextLine()) return;
        String s = sc.nextLine().trim();

        Solution sol = new Solution();
        int result = sol.lengthOfLongestSubstring(s);

        // Print result
        System.out.println(result);
    }
}`
  },
  {
    slug: 'longest-substring-without-repeating',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int lengthOfLongestSubstring(string s) {
        // your code here
        return 0;
    }
};`,
    wrapperCode: `int main() {
    string s;
    getline(cin, s);
    // Removed isspace as it removes spaces which are valid chars in the string
    // s.erase(remove_if(s.begin(), s.end(), ::isspace), s.end());

    Solution sol;
    int result = sol.lengthOfLongestSubstring(s);

    cout << result << endl;
    return 0;
}`
  },
  {
    slug: 'longest-substring-without-repeating',
    language: 'python',
    starter: `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        pass`,
    wrapperCode: `if __name__ == "__main__":
    s = input().strip()

    sol = Solution()
    result = sol.lengthOfLongestSubstring(s)

    print(result)`
  },
  {
    slug: 'longest-substring-without-repeating',
    language: 'javascript',
    starter: `function lengthOfLongestSubstring(s) {
  // your code here
}`,
    wrapperCode: `const lines = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split('\\n');

const s = lines[0].trim();

const result = lengthOfLongestSubstring(s);

console.log(result);`
  },

  // 8. Valid Parentheses
  {
    slug: 'valid-parentheses',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool isValid(string s) {
        // your code here
        return false;
    }
};`,
    wrapperCode: `int main() {
    string s;
    getline(cin, s);
    s.erase(remove_if(s.begin(), s.end(), ::isspace), s.end());

    Solution sol;
    bool result = sol.isValid(s);

    cout << (result ? "true" : "false") << endl;
    return 0;
}`
  },
  {
    slug: 'valid-parentheses',
    language: 'java',
    starter: `class Solution {
    public boolean isValid(String s) {
        // your code here
        return false;
    }
}`,
    wrapperCode: `import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);
        if(!sc.hasNextLine()) return;
        String s = sc.nextLine().trim();

        Solution sol = new Solution();
        boolean result = sol.isValid(s);

        System.out.println(result);
    }
}`
  },
  {
    slug: 'valid-parentheses',
    language: 'python',
    starter: `class Solution:
    def isValid(self, s: str) -> bool:
        pass`,
    wrapperCode: `if __name__ == "__main__":
    s = input().strip()

    sol = Solution()
    result = sol.isValid(s)

    print(str(result).lower())`
  },
  {
    slug: 'valid-parentheses',
    language: 'javascript',
    starter: `function isValid(s) {
  // your code here
}`,
    wrapperCode: `const lines = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split('\\n');

const s = lines[0].trim();

const result = isValid(s);

console.log(result);`
  },

  // 9. Minimum Window Substring
  {
    slug: 'minimum-window-substring',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string minWindow(const string& s, const string& t) {
        // your code here
        return "";
    }
};`,
    wrapperCode: `int main() {
    string line;
    getline(cin, line);

    // Input format: {"s": "ADOBECODEBANC", "t": "ABC"}
    // Extract s value
    int sStart = line.find("\\"s\\":");
    sStart = line.find("\\"", sStart + 4) + 1;
    int sEnd = line.find("\\"", sStart);
    string s = line.substr(sStart, sEnd - sStart);

    // Extract t value
    int tStart = line.find("\\"t\\":");
    tStart = line.find("\\"", tStart + 4) + 1;
    int tEnd = line.find("\\"", tStart);
    string t = line.substr(tStart, tEnd - tStart);

    Solution sol;
    string result = sol.minWindow(s, t);

    cout << "\\"" << result << "\\"" << endl;
    return 0;
}`
  },
  {
    slug: 'minimum-window-substring',
    language: 'java',
    starter: `import java.util.*;

class Solution {
    public String minWindow(String s, String t) {
        // your code here
        return "";
    }
}`,
    wrapperCode: `import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();

        // Input format: {"s": "ADOBECODEBANC", "t": "ABC"}
        // Extract s value
        int sStart = line.indexOf("\\"s\\":");
        sStart = line.indexOf("\\"", sStart + 4) + 1;
        int sEnd = line.indexOf("\\"", sStart);
        String s = line.substring(sStart, sEnd);

        // Extract t value
        int tStart = line.indexOf("\\"t\\":");
        tStart = line.indexOf("\\"", tStart + 4) + 1;
        int tEnd = line.indexOf("\\"", tStart);
        String t = line.substring(tStart, tEnd);

        Solution sol = new Solution();
        String result = sol.minWindow(s, t);

        System.out.println("\\"" + result + "\\"");
    }
}`
  },

  // 10. Word Ladder
  {
    slug: 'word-ladder',
    language: 'cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int ladderLength(string beginWord, string endWord, vector<string>& wordList) {
        // your code here
        return 0;
    }
};`,
    wrapperCode: `int main() {
    string line;
    getline(cin, line);

    // Input format: {"beginWord": "hit", "endWord": "cog", "wordList": ["hot","dot",...]}
    // Extract beginWord
    int bStart = line.find("\\"beginWord\\":");
    bStart = line.find("\\"", bStart + 12) + 1;
    int bEnd = line.find("\\"", bStart);
    string beginWord = line.substr(bStart, bEnd - bStart);

    // Extract endWord
    int eStart = line.find("\\"endWord\\":");
    eStart = line.find("\\"", eStart + 10) + 1;
    int eEnd = line.find("\\"", eStart);
    string endWord = line.substr(eStart, eEnd - eStart);

    // Extract wordList array
    int wStart = line.find("[") + 1;
    int wEnd   = line.find("]");
    string wordPart = line.substr(wStart, wEnd - wStart);

    vector<string> wordList;
    stringstream ss(wordPart);
    string token;
    while (getline(ss, token, ',')) {
        // Remove quotes and whitespace
        token.erase(remove_if(token.begin(), token.end(),
                   [](char c){ return c == '"' || c == ' '; }), token.end());
        if (!token.empty()) wordList.push_back(token);
    }

    Solution sol;
    int result = sol.ladderLength(beginWord, endWord, wordList);

    cout << result << endl;
    return 0;
}`
  },
  {
    slug: 'word-ladder',
    language: 'java',
    starter: `import java.util.*;

class Solution {
    public int ladderLength(String beginWord, String endWord, List<String> wordList) {
        // your code here
        return 0;
    }
}`,
    wrapperCode: `import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();

        // Input format: {"beginWord": "hit", "endWord": "cog", "wordList": ["hot","dot",...]}
        // Extract beginWord
        int bStart = line.indexOf("\\"beginWord\\":");
        bStart = line.indexOf("\\"", bStart + 12) + 1;
        int bEnd = line.indexOf("\\"", bStart);
        String beginWord = line.substring(bStart, bEnd);

        // Extract endWord
        int eStart = line.indexOf("\\"endWord\\":");
        eStart = line.indexOf("\\"", eStart + 10) + 1;
        int eEnd = line.indexOf("\\"", eStart);
        String endWord = line.substring(eStart, eEnd);

        // Extract wordList array
        int wStart = line.indexOf("[") + 1;
        int wEnd   = line.indexOf("]");
        String wordPart = line.substring(wStart, wEnd);

        List<String> wordList = new ArrayList<>();
        for (String token : wordPart.split(",")) {
            token = token.replaceAll("[\\"\\\\s]", ""); // remove quotes and whitespace
            if (!token.isEmpty()) wordList.add(token);
        }

        Solution sol = new Solution();
        int result = sol.ladderLength(beginWord, endWord, wordList);

        System.out.println(result);
    }
}`
  },
  {
    slug: 'word-ladder',
    language: 'python',
    starter: `class Solution:
    def ladderLength(self, beginWord: str, endWord: str, wordList: list[str]) -> int:
        pass`,
    wrapperCode: `import json

if __name__ == "__main__":
    line = input().strip()

    # Input format: {"beginWord": "hit", "endWord": "cog", "wordList": ["hot","dot",...]}
    data = json.loads(line)
    beginWord = data["beginWord"]
    endWord   = data["endWord"]
    wordList  = data["wordList"]

    sol = Solution()
    result = sol.ladderLength(beginWord, endWord, wordList)

    print(result)`
  }
];

async function main() {
    let successCount = 0;
    let missingCount = 0;
    
    // First let's get a map of questions
    const allQuestions = await prisma.question.findMany({ select: { id: true, slug: true } });
    const slugMap = new Map();
    for (let q of allQuestions) {
        slugMap.set(q.slug, q.id);
    }

    for (const item of data) {
        let questionId = slugMap.get(item.slug);
        
        // If exact slug not found, let's try case-insensitive
        if (!questionId) {
             const fallback = allQuestions.find(q => q.slug.toLowerCase() === item.slug.toLowerCase());
             if (fallback) questionId = fallback.id;
        }

        if (!questionId) {
            console.log(`[!] Question missing for slug: ${item.slug}`);
            missingCount++;
            continue;
        }

        // Try getting the existing starter just in case starter is not provided in item, but wrapperCode is.
        // We need 'starter' field to upsert since it's required in the schema!
        let existingStarterStr = "class Solution {}"; // Fallback default
        if (!item.starter) {
            const existing = await prisma.questionStarter.findUnique({
                where: { questionId_language: { questionId, language: item.language } }
            });
            if (existing && existing.starter) {
                existingStarterStr = existing.starter;
            } else {
                // Determine a basic default based on language
                if (item.language === 'python') existingStarterStr = "class Solution:\\n    pass";
                else if (item.language === 'java') existingStarterStr = "class Solution {}";
                else if (item.language === 'cpp') existingStarterStr = "class Solution {};";
                else if (item.language === 'javascript') existingStarterStr = "function solution() {}";
            }
        }

        const starterToUse = item.starter || existingStarterStr;

        await prisma.questionStarter.upsert({
            where: {
                questionId_language: { questionId, language: item.language }
            },
            update: {
                // Only update starter if it was explicitly provided in the data array, else keep existing
                ...(item.starter ? { starter: item.starter } : {}),
                wrapperCode: item.wrapperCode
            },
            create: {
                questionId,
                language: item.language,
                starter: starterToUse,
                wrapperCode: item.wrapperCode
            }
        });

        console.log(`✅ Updated ${item.language} for ${item.slug}`);
        successCount++;
    }

    console.log(`\nDone! Successfully upserted ${successCount} starter/wrappers. (${missingCount} questions not found).`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
