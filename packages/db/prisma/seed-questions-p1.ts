// ============================================
// Question Data — Part 1 of 3  (Q1–Q5)
// ============================================

export const questionsP1 = [
  // ── Q1 ──
  {
    slug: 'count-submatrices-equal-frequency-x-y',
    title: 'Count the Number of Submatrices with Equal Frequency of X and Y',
    category: 'DSA', subcategory: 'Matrix', difficulty: 'Medium',
    problemMd: `## Count the Number of Submatrices with Equal Frequency of X and Y\n\nGiven a 2D character matrix grid, where grid[i][j] is either 'X', 'Y', or '.', return the number of submatrices that contain:\n\n- grid[0][0]\n- an equal frequency of 'X' and 'Y'.\n- at least one 'X'.`,
    constraints: `1 ≤ m, n ≤ 50 (grid dimensions)\ngrid[i][j] is 'X', 'Y', or '.'\nSubmatrix must include grid[0][0]\nMust have at least one 'X'\nCount of 'X' must equal count of 'Y'`,
    examples: [
      { input: 'grid = [["X","Y","."],["Y",".","."]]', output: '3' },
      { input: 'grid = [["X","X"],["X","Y"]]', output: '0' },
      { input: 'grid = [[".","."],[".","."]]', output: '0' },
    ],
    hints: ['Use prefix sums to count X and Y in submatrices.', 'A submatrix starting at (0,0) is defined by its bottom-right corner.'],
    followUpQuestions: ['What is the time complexity?', 'Can you optimize the space usage?'],
    tags: ['matrix', 'prefix-sum'], companies: ['Google', 'Amazon'],
    targetRoles: ['backend', 'fullstack'], targetLevels: ['SDE2', 'SDE3'],
    starters: [
      { language: 'cpp', starter: `class Solution {\npublic:\n\tint numberOfSubmatrices(vector<vector<char>>& grid) {\n\n\t}\n};`,
        wrapperCode: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n\tstring line; getline(cin, line);\n\tauto j = nlohmann::json::parse(line);\n\tvector<vector<char>> grid;\n\tfor (auto& row : j["grid"]) { vector<char> r; for (auto& c : row) r.push_back(c.get<string>()[0]); grid.push_back(r); }\n\tSolution sol;\n\tcout << sol.numberOfSubmatrices(grid) << endl;\n\treturn 0;\n}` },
      { language: 'java', starter: `class Solution {\n\tpublic int numberOfSubmatrices(char[][] grid) {\n\n\t}\n}`,
        wrapperCode: `import java.util.*;\nimport org.json.*;\n\npublic class Main {\n\tpublic static void main(String[] args) {\n\t\tScanner sc = new Scanner(System.in);\n\t\tStringBuilder sb = new StringBuilder();\n\t\twhile(sc.hasNextLine()) sb.append(sc.nextLine());\n\t\tJSONObject obj = new JSONObject(sb.toString());\n\t\tJSONArray g = obj.getJSONArray("grid");\n\t\tchar[][] grid = new char[g.length()][];\n\t\tfor(int i=0;i<g.length();i++){JSONArray row=g.getJSONArray(i);grid[i]=new char[row.length()];for(int jj=0;jj<row.length();jj++)grid[i][jj]=row.getString(jj).charAt(0);}\n\t\tSystem.out.println(new Solution().numberOfSubmatrices(grid));\n\t}\n}` },
      { language: 'python', starter: `class Solution(object):\n\tdef numberOfSubmatrices(self, grid):\n\t\t\"\"\"\n\t\t:type grid: List[List[str]]\n\t\t:rtype: int\n\t\t\"\"\"`,
        wrapperCode: `import sys, json\ndef main():\n\tdata = json.loads(sys.stdin.read())\n\tprint(Solution().numberOfSubmatrices(data["grid"]))\nmain()` },
      { language: 'javascript', starter: `/**\n * @param {character[][]} grid\n * @return {number}\n */\nvar numberOfSubmatrices = function(grid) {\n\n};`,
        wrapperCode: `const readline=require('readline');const rl=readline.createInterface({input:process.stdin});let inp='';rl.on('line',l=>inp+=l);rl.on('close',()=>{const d=JSON.parse(inp);console.log(numberOfSubmatrices(d.grid));});` },
    ],
    testCases: [
      { input: '{"grid":[["X","Y","."],["Y",".","."]]}\n', expected: '3', type: 'sample', orderIdx: 0 },
      { input: '{"grid":[["X","X"],["X","Y"]]}\n', expected: '0', type: 'sample', orderIdx: 1 },
      { input: '{"grid":[[".","."],[".","."]]}\n', expected: '0', type: 'sample', orderIdx: 2 },
    ],
  },
  // ── Q2 ──
  {
    slug: 'reverse-nodes-in-k-group',
    title: 'Reverse Nodes in K Groups',
    category: 'DSA', subcategory: 'LinkedList', difficulty: 'Hard',
    problemMd: `## Reverse Nodes in K Groups\n\nGiven the head of a linked list, reverse the nodes of the list k at a time, and return the modified list.\n\nk is a positive integer and is less than or equal to the length of the linked list. If the number of nodes is not a multiple of k then left-out nodes, in the end, should remain as it is.\n\nYou may not alter the values in the list's nodes, only nodes themselves may be changed.`,
    constraints: `1 ≤ k ≤ n (length of linked list)\n1 ≤ n ≤ 5000\n0 ≤ Node.val ≤ 1000`,
    examples: [
      { input: 'head = [1,2,3,4,5], k = 2', output: '[2,1,4,3,5]' },
      { input: 'head = [1,2,3,4,5], k = 3', output: '[3,2,1,4,5]' },
    ],
    hints: ['Count k nodes ahead, then reverse that segment.', 'Use recursion or iteration with pointer manipulation.'],
    followUpQuestions: ['What is the time and space complexity?', 'Can you solve it iteratively?'],
    tags: ['linked-list', 'recursion'], companies: ['Google', 'Amazon', 'Meta'],
    targetRoles: ['backend', 'fullstack'], targetLevels: ['SDE2', 'SDE3'],
    starters: [
      { language: 'cpp', starter: `/**\n * Definition for singly-linked list.\n * struct ListNode {\n * \tint val;\n * \tListNode *next;\n * \tListNode() : val(0), next(nullptr) {}\n * \tListNode(int x) : val(x), next(nullptr) {}\n * \tListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n\tListNode* reverseKGroup(ListNode* head, int k) {\n\t}\n};`,
        wrapperCode: `#include <bits/stdc++.h>\nusing namespace std;\nstruct ListNode { int val; ListNode *next; ListNode():val(0),next(nullptr){} ListNode(int x):val(x),next(nullptr){} ListNode(int x,ListNode*n):val(x),next(n){} };\nint main(){\n\tstring line; getline(cin,line);\n\tauto j=nlohmann::json::parse(line);\n\tauto arr=j["head"]; int k=j["k"];\n\tListNode dummy(0); ListNode*tail=&dummy;\n\tfor(auto&v:arr){tail->next=new ListNode(v.get<int>());tail=tail->next;}\n\tSolution sol; ListNode*res=sol.reverseKGroup(dummy.next,k);\n\tbool f=true; cout<<"["; while(res){if(!f)cout<<",";cout<<res->val;res=res->next;f=false;} cout<<"]"<<endl;\n}` },
      { language: 'java', starter: `/**\n * Definition for singly-linked list.\n * public class ListNode {\n * \tint val;\n * \tListNode next;\n * \tListNode() {}\n * \tListNode(int val) { this.val = val; }\n * \tListNode(int val, ListNode next) { this.val = val; this.next = next; }\n * }\n */\nclass Solution {\n\tpublic ListNode reverseKGroup(ListNode head, int k) {\n\n\t}\n}`,
        wrapperCode: `import java.util.*;\nimport org.json.*;\npublic class Main {\n\tpublic static void main(String[] args){\n\t\tScanner sc=new Scanner(System.in); StringBuilder sb=new StringBuilder(); while(sc.hasNextLine())sb.append(sc.nextLine());\n\t\tJSONObject obj=new JSONObject(sb.toString()); JSONArray arr=obj.getJSONArray("head"); int k=obj.getInt("k");\n\t\tListNode dummy=new ListNode(0),tail=dummy;\n\t\tfor(int i=0;i<arr.length();i++){tail.next=new ListNode(arr.getInt(i));tail=tail.next;}\n\t\tListNode res=new Solution().reverseKGroup(dummy.next,k);\n\t\tStringBuilder out=new StringBuilder("["); boolean f=true; while(res!=null){if(!f)out.append(",");out.append(res.val);res=res.next;f=false;} out.append("]");\n\t\tSystem.out.println(out);\n\t}\n}\nclass ListNode{int val;ListNode next;ListNode(){}ListNode(int v){val=v;}ListNode(int v,ListNode n){val=v;next=n;}}` },
      { language: 'python', starter: `# Definition for singly-linked list.\n# class ListNode(object):\n# \tdef __init__(self, val=0, next=None):\n# \t\tself.val = val\n# \t\tself.next = next\nclass Solution(object):\n\tdef reverseKGroup(self, head, k):\n\t\t\"\"\"\n\t\t:type head: Optional[ListNode]\n\t\t:type k: int\n\t\t:rtype: Optional[ListNode]\n\t\t\"\"\"`,
        wrapperCode: `import sys,json\nclass ListNode(object):\n\tdef __init__(self,val=0,next=None):self.val=val;self.next=next\ndef build(arr):\n\tdummy=ListNode(0);t=dummy\n\tfor v in arr:t.next=ListNode(v);t=t.next\n\treturn dummy.next\ndef tolist(h):\n\tr=[]\n\twhile h:r.append(h.val);h=h.next\n\treturn r\ndef main():\n\td=json.loads(sys.stdin.read());h=build(d["head"]);k=d["k"]\n\tres=Solution().reverseKGroup(h,k);print(json.dumps(tolist(res)))\nmain()` },
      { language: 'javascript', starter: `/**\n * Definition for singly-linked list.\n * function ListNode(val, next) {\n *     this.val = (val===undefined ? 0 : val)\n *     this.next = (next===undefined ? null : next)\n * }\n */\n/**\n * @param {ListNode} head\n * @param {number} k\n * @return {ListNode}\n */\nvar reverseKGroup = function(head, k) {\n\n};`,
        wrapperCode: `function ListNode(v,n){this.val=(v===undefined?0:v);this.next=(n===undefined?null:n);}\nconst rl=require('readline').createInterface({input:process.stdin});let inp='';rl.on('line',l=>inp+=l);rl.on('close',()=>{\n\tconst d=JSON.parse(inp);let dummy=new ListNode(0),t=dummy;\n\tfor(const v of d.head){t.next=new ListNode(v);t=t.next;}\n\tlet res=reverseKGroup(dummy.next,d.k),arr=[];\n\twhile(res){arr.push(res.val);res=res.next;}\n\tconsole.log(JSON.stringify(arr));\n});` },
    ],
    testCases: [
      { input: '{"head":[1,2,3,4,5],"k":2}\n', expected: '[2,1,4,3,5]', type: 'sample', orderIdx: 0 },
      { input: '{"head":[1,2,3,4,5],"k":3}\n', expected: '[3,2,1,4,5]', type: 'sample', orderIdx: 1 },
      { input: '{"head":[1,2,3,4,5],"k":1}\n', expected: '[1,2,3,4,5]', type: 'sample', orderIdx: 2 },
    ],
  },
  // ── Q3 ──
  {
    slug: 'container-with-most-water',
    title: 'Container with Most Water',
    category: 'DSA', subcategory: 'TwoPointers', difficulty: 'Medium',
    problemMd: `## Container with Most Water\n\nYou are given an integer array height of length n. There are n vertical lines drawn such that the two endpoints of the ith line are (i, 0) and (i, height[i]).\n\nFind two lines that together with the x-axis form a container, such that the container contains the most water.\n\nReturn the maximum amount of water a container can store.\n\nNotice that you may not slant the container.`,
    constraints: `2 ≤ n ≤ 100,000\n0 ≤ height[i] ≤ 10,000`,
    examples: [
      { input: 'height = [1,8,6,2,5,4,8,3,7]', output: '49', explanation: 'The max area of water the container can contain is 49.' },
      { input: 'height = [1,1]', output: '1' },
    ],
    hints: ['Use two pointers from both ends.', 'Move the pointer with the smaller height.'],
    followUpQuestions: ['Why does the two-pointer approach work?', 'What is the time complexity?'],
    tags: ['two-pointers', 'arrays', 'greedy'], companies: ['Amazon', 'Google', 'Meta'],
    targetRoles: ['backend', 'frontend', 'fullstack'], targetLevels: ['SDE1', 'SDE2'],
    starters: [
      { language: 'cpp', starter: `class Solution {\npublic:\n\tint maxArea(vector<int>& height) {\n\n\t}\n};`,
        wrapperCode: `#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n\tstring line;getline(cin,line);auto j=nlohmann::json::parse(line);\n\tvector<int> h=j["height"].get<vector<int>>();\n\tSolution sol;cout<<sol.maxArea(h)<<endl;\n}` },
      { language: 'java', starter: `class Solution {\n\tpublic int maxArea(int[] height) {\n\n\t}\n}`,
        wrapperCode: `import java.util.*;import org.json.*;\npublic class Main{public static void main(String[] a){\n\tScanner sc=new Scanner(System.in);StringBuilder sb=new StringBuilder();while(sc.hasNextLine())sb.append(sc.nextLine());\n\tJSONObject obj=new JSONObject(sb.toString());JSONArray arr=obj.getJSONArray("height");\n\tint[]h=new int[arr.length()];for(int i=0;i<arr.length();i++)h[i]=arr.getInt(i);\n\tSystem.out.println(new Solution().maxArea(h));\n}}` },
      { language: 'python', starter: `class Solution(object):\n\tdef maxArea(self, height):\n\t\t\"\"\"\n\t\t:type height: List[int]\n\t\t:rtype: int\n\t\t\"\"\"`,
        wrapperCode: `import sys,json\ndef main():\n\td=json.loads(sys.stdin.read());print(Solution().maxArea(d["height"]))\nmain()` },
      { language: 'javascript', starter: `/**\n * @param {number[]} height\n * @return {number}\n */\nvar maxArea = function(height) {\n\n};`,
        wrapperCode: `const rl=require('readline').createInterface({input:process.stdin});let inp='';rl.on('line',l=>inp+=l);rl.on('close',()=>{const d=JSON.parse(inp);console.log(maxArea(d.height));});` },
    ],
    testCases: [
      { input: '{"height":[1,8,6,2,5,4,8,3,7]}\n', expected: '49', type: 'sample', orderIdx: 0 },
      { input: '{"height":[1,1]}\n', expected: '1', type: 'sample', orderIdx: 1 },
      { input: '{"height":[4,3,2,1,4]}\n', expected: '16', type: 'sample', orderIdx: 2 },
    ],
  },
  // ── Q4 ──
  {
    slug: 'multiply-strings',
    title: 'Multiply Strings',
    category: 'DSA', subcategory: 'Strings', difficulty: 'Medium',
    problemMd: `## Multiply Strings\n\nGiven two non-negative integers num1 and num2 represented as strings, return the product of num1 and num2, also represented as a string.\n\nNote: You must not use any built-in BigInteger library or convert the inputs to integer directly.`,
    constraints: `1 ≤ num1.length, num2.length ≤ 200\nnum1 and num2 consist of digits only\nNeither has leading zeros (except '0')\nNo built-in BigInteger or direct int conversion`,
    examples: [
      { input: 'num1 = "2", num2 = "3"', output: '"6"' },
      { input: 'num1 = "123", num2 = "456"', output: '"56088"' },
    ],
    hints: ['Simulate grade-school multiplication.', 'Use an array to collect partial products.'],
    followUpQuestions: ['What is the time complexity?', 'How do you handle leading zeros?'],
    tags: ['strings', 'math', 'simulation'], companies: ['Meta', 'Google', 'Microsoft'],
    targetRoles: ['backend', 'fullstack'], targetLevels: ['SDE1', 'SDE2'],
    starters: [
      { language: 'cpp', starter: `class Solution {\npublic:\n\tstring multiply(string num1, string num2) {\n\n\t}\n};`,
        wrapperCode: `#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n\tstring line;getline(cin,line);auto j=nlohmann::json::parse(line);\n\tstring n1=j["num1"],n2=j["num2"];\n\tSolution sol;cout<<sol.multiply(n1,n2)<<endl;\n}` },
      { language: 'java', starter: `class Solution {\n\tpublic String multiply(String num1, String num2) {\n\n\t}\n}`,
        wrapperCode: `import java.util.*;import org.json.*;\npublic class Main{public static void main(String[] a){\n\tScanner sc=new Scanner(System.in);StringBuilder sb=new StringBuilder();while(sc.hasNextLine())sb.append(sc.nextLine());\n\tJSONObject obj=new JSONObject(sb.toString());\n\tSystem.out.println(new Solution().multiply(obj.getString("num1"),obj.getString("num2")));\n}}` },
      { language: 'python', starter: `class Solution(object):\n\tdef multiply(self, num1, num2):\n\t\t\"\"\"\n\t\t:type num1: str\n\t\t:type num2: str\n\t\t:rtype: str\n\t\t\"\"\"`,
        wrapperCode: `import sys,json\ndef main():\n\td=json.loads(sys.stdin.read());print(Solution().multiply(d["num1"],d["num2"]))\nmain()` },
      { language: 'javascript', starter: `/**\n * @param {string} num1\n * @param {string} num2\n * @return {string}\n */\nvar multiply = function(num1, num2) {\n\n};`,
        wrapperCode: `const rl=require('readline').createInterface({input:process.stdin});let inp='';rl.on('line',l=>inp+=l);rl.on('close',()=>{const d=JSON.parse(inp);console.log(multiply(d.num1,d.num2));});` },
    ],
    testCases: [
      { input: '{"num1":"2","num2":"3"}\n', expected: '6', type: 'sample', orderIdx: 0 },
      { input: '{"num1":"123","num2":"456"}\n', expected: '56088', type: 'sample', orderIdx: 1 },
      { input: '{"num1":"999","num2":"999"}\n', expected: '998001', type: 'sample', orderIdx: 2 },
    ],
  },
];
