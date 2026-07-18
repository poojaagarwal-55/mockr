// ============================================
// Database Seed Script
// ============================================
// Seeds the question bank with initial DSA, CS, and SQL questions.
// Run: npm run db:seed (from monorepo root)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type LegacyQuestionClient = {
    question: {
        upsert(args: unknown): Promise<any>;
        count(args?: unknown): Promise<number>;
    };
    questionStarter: {
        upsert(args: unknown): Promise<any>;
    };
    questionTestCase: {
        deleteMany(args: unknown): Promise<any>;
        create(args: unknown): Promise<any>;
    };
    questionAnalytics: {
        upsert(args: unknown): Promise<any>;
    };
};

function getLegacyQuestionClient(): LegacyQuestionClient | null {
    const candidate = prisma as unknown as Partial<LegacyQuestionClient>;

    if (
        !candidate.question ||
        !candidate.questionStarter ||
        !candidate.questionTestCase ||
        !candidate.questionAnalytics
    ) {
        return null;
    }

    return candidate as LegacyQuestionClient;
}

async function main() {
    console.log('🌱 Seeding database...');

    const legacy = getLegacyQuestionClient();
    if (!legacy) {
        console.warn('⚠️ Legacy question Prisma models are not present in this schema. Skipping legacy seed script.');
        return;
    }

    // ---- DSA Questions ----
    const dsaQuestions = [
        {
            slug: 'two-sum',
            title: 'Two Sum',
            category: 'DSA',
            subcategory: 'Arrays',
            difficulty: 'Easy',
            problemMd: `## Two Sum\n\nGiven an array of integers \`nums\` and an integer \`target\`, return indices of the two numbers such that they add up to \`target\`.\n\nYou may assume that each input would have **exactly one solution**, and you may not use the same element twice.\n\nYou can return the answer in any order.`,
            constraints: '2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9',
            examples: [
                { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].' },
                { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
            ],
            hints: ['Try using a hash map to store values you\'ve seen.', 'For each number, check if target - number exists in the map.'],
            followUpQuestions: ['What is the time complexity of your solution?', 'Can you solve it in one pass?', 'What if the array was sorted?'],
            tags: ['hashmap', 'arrays'],
            companies: ['Google', 'Amazon', 'Meta'],
            targetRoles: ['backend', 'frontend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            starters: [
                { language: 'python', starter: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass\n', solution: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i\n        return []\n' },
                { language: 'javascript', starter: 'function twoSum(nums, target) {\n  // your code here\n}\n', solution: 'function twoSum(nums, target) {\n  const map = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    if (map.has(target - nums[i])) return [map.get(target - nums[i]), i];\n    map.set(nums[i], i);\n  }\n}\n' },
                { language: 'java', starter: 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // your code here\n        return new int[]{};\n    }\n}\n', solution: null },
            ],
            testCases: [
                { input: '[2,7,11,15]\n9', expected: '[0,1]', type: 'sample', orderIdx: 0 },
                { input: '[3,2,4]\n6', expected: '[1,2]', type: 'sample', orderIdx: 1 },
                { input: '[3,3]\n6', expected: '[0,1]', type: 'edge', orderIdx: 2 },
                { input: '[1,2,3,4,5,6,7,8,9,10]\n19', expected: '[8,9]', type: 'hidden', orderIdx: 3 },
            ],
        },
        {
            slug: 'valid-parentheses',
            title: 'Valid Parentheses',
            category: 'DSA',
            subcategory: 'Stacks',
            difficulty: 'Easy',
            problemMd: `## Valid Parentheses\n\nGiven a string \`s\` containing just the characters \`(\`, \`)\`, \`{\`, \`}\`, \`[\` and \`]\`, determine if the input string is valid.\n\nAn input string is valid if:\n1. Open brackets must be closed by the same type of brackets.\n2. Open brackets must be closed in the correct order.\n3. Every close bracket has a corresponding open bracket of the same type.`,
            constraints: '1 <= s.length <= 10^4\ns consists of parentheses only \'()[]{}\'',
            examples: [
                { input: 's = "()"', output: 'true' },
                { input: 's = "()[]{}"', output: 'true' },
                { input: 's = "(]"', output: 'false' },
            ],
            hints: ['Use a stack data structure.', 'Push opening brackets, pop and compare for closing ones.'],
            followUpQuestions: ['What data structure did you use and why?', 'What is the space complexity?', 'How would you handle nested structures?'],
            tags: ['stack', 'strings'],
            companies: ['Amazon', 'Microsoft', 'Meta'],
            targetRoles: ['backend', 'frontend', 'fullstack'],
            targetLevels: ['SDE1'],
            starters: [
                { language: 'python', starter: 'class Solution:\n    def isValid(self, s: str) -> bool:\n        pass\n', solution: null },
                { language: 'javascript', starter: 'function isValid(s) {\n  // your code here\n}\n', solution: null },
            ],
            testCases: [
                { input: '()', expected: 'true', type: 'sample', orderIdx: 0 },
                { input: '()[]{}', expected: 'true', type: 'sample', orderIdx: 1 },
                { input: '(]', expected: 'false', type: 'sample', orderIdx: 2 },
                { input: '([)]', expected: 'false', type: 'hidden', orderIdx: 3 },
                { input: '{[]}', expected: 'true', type: 'hidden', orderIdx: 4 },
            ],
        },
        {
            slug: 'reverse-linked-list',
            title: 'Reverse Linked List',
            category: 'DSA',
            subcategory: 'LinkedList',
            difficulty: 'Easy',
            problemMd: `## Reverse Linked List\n\nGiven the \`head\` of a singly linked list, reverse the list, and return the reversed list.`,
            constraints: 'The number of nodes in the list is the range [0, 5000]\n-5000 <= Node.val <= 5000',
            examples: [
                { input: 'head = [1,2,3,4,5]', output: '[5,4,3,2,1]' },
                { input: 'head = [1,2]', output: '[2,1]' },
            ],
            hints: ['Try iterative approach with three pointers.', 'Can you solve it recursively?'],
            followUpQuestions: ['Explain the iterative vs recursive approach.', 'What is the space complexity of each?'],
            tags: ['linked-list', 'recursion'],
            companies: ['Google', 'Microsoft', 'Apple'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            starters: [
                { language: 'python', starter: 'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n\nclass Solution:\n    def reverseList(self, head: ListNode) -> ListNode:\n        pass\n', solution: null },
            ],
            testCases: [
                { input: '[1,2,3,4,5]', expected: '[5,4,3,2,1]', type: 'sample', orderIdx: 0 },
                { input: '[]', expected: '[]', type: 'hidden', orderIdx: 1 },
            ],
        },
        {
            slug: 'longest-substring-without-repeating',
            title: 'Longest Substring Without Repeating Characters',
            category: 'DSA',
            subcategory: 'SlidingWindow',
            difficulty: 'Medium',
            problemMd: `## Longest Substring Without Repeating Characters\n\nGiven a string \`s\`, find the length of the **longest substring** without repeating characters.`,
            constraints: '0 <= s.length <= 5 * 10^4\ns consists of English letters, digits, symbols and spaces.',
            examples: [
                { input: 's = "abcabcbb"', output: '3', explanation: 'The answer is "abc", with the length of 3.' },
                { input: 's = "bbbbb"', output: '1' },
                { input: 's = "pwwkew"', output: '3' },
            ],
            hints: ['Use a sliding window approach.', 'Keep track of characters in the current window with a set or map.'],
            followUpQuestions: ['What is the time complexity?', 'Why is sliding window better than brute force here?', 'Could you optimize space usage?'],
            tags: ['sliding-window', 'hashmap', 'strings'],
            companies: ['Amazon', 'Google', 'Microsoft'],
            targetRoles: ['backend', 'frontend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            starters: [
                { language: 'python', starter: 'class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        pass\n', solution: null },
                { language: 'javascript', starter: 'function lengthOfLongestSubstring(s) {\n  // your code here\n}\n', solution: null },
            ],
            testCases: [
                { input: 'abcabcbb', expected: '3', type: 'sample', orderIdx: 0 },
                { input: 'bbbbb', expected: '1', type: 'sample', orderIdx: 1 },
                { input: 'pwwkew', expected: '3', type: 'sample', orderIdx: 2 },
                { input: '', expected: '0', type: 'hidden', orderIdx: 3 },
            ],
        },
        {
            slug: 'lru-cache',
            title: 'LRU Cache',
            category: 'DSA',
            subcategory: 'Design',
            difficulty: 'Medium',
            problemMd: `## LRU Cache\n\nDesign a data structure that follows the constraints of a **Least Recently Used (LRU) cache**.\n\nImplement the \`LRUCache\` class:\n- \`LRUCache(int capacity)\` Initialize the LRU cache with positive size capacity.\n- \`int get(int key)\` Return the value of the key if the key exists, otherwise return -1.\n- \`void put(int key, int value)\` Update the value of the key if the key exists. Otherwise, add the key-value pair to the cache. If the number of keys exceeds the capacity from this operation, evict the least recently used key.`,
            constraints: '1 <= capacity <= 3000\n0 <= key <= 10^4\n0 <= value <= 10^5\nAt most 2 * 10^5 calls will be made to get and put.',
            examples: [
                { input: '["LRUCache","put","put","get","put","get","put","get","get","get"]\n[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]', output: '[null,null,null,1,null,-1,null,-1,3,4]' },
            ],
            hints: ['Use a hash map + doubly linked list.', 'The hash map gives O(1) lookup, the linked list gives O(1) eviction.'],
            followUpQuestions: ['Why did you choose this data structure combination?', 'What are the time complexities of get and put?', 'How would this work in a distributed system?'],
            tags: ['design', 'hashmap', 'linked-list'],
            companies: ['Google', 'Amazon', 'Meta', 'Microsoft'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE2', 'SDE3'],
            starters: [
                { language: 'python', starter: 'class LRUCache:\n    def __init__(self, capacity: int):\n        pass\n\n    def get(self, key: int) -> int:\n        pass\n\n    def put(self, key: int, value: int) -> None:\n        pass\n', solution: null },
            ],
            testCases: [
                { input: '2\nput 1 1\nput 2 2\nget 1\nput 3 3\nget 2', expected: '1\n-1', type: 'sample', orderIdx: 0 },
            ],
        },
        {
            slug: 'merge-intervals',
            title: 'Merge Intervals',
            category: 'DSA',
            subcategory: 'Arrays',
            difficulty: 'Medium',
            problemMd: `## Merge Intervals\n\nGiven an array of \`intervals\` where \`intervals[i] = [start_i, end_i]\`, merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.`,
            constraints: '1 <= intervals.length <= 10^4\nintervals[i].length == 2\n0 <= start_i <= end_i <= 10^4',
            examples: [
                { input: 'intervals = [[1,3],[2,6],[8,10],[15,18]]', output: '[[1,6],[8,10],[15,18]]', explanation: 'Since intervals [1,3] and [2,6] overlap, merge them into [1,6].' },
            ],
            hints: ['Sort intervals by start time first.', 'Then iterate and merge overlapping ones.'],
            followUpQuestions: ['What is the time complexity?', 'Why must you sort first?'],
            tags: ['sorting', 'arrays', 'intervals'],
            companies: ['Google', 'Meta', 'Bloomberg'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            starters: [
                { language: 'python', starter: 'class Solution:\n    def merge(self, intervals: list[list[int]]) -> list[list[int]]:\n        pass\n', solution: null },
            ],
            testCases: [
                { input: '[[1,3],[2,6],[8,10],[15,18]]', expected: '[[1,6],[8,10],[15,18]]', type: 'sample', orderIdx: 0 },
                { input: '[[1,4],[4,5]]', expected: '[[1,5]]', type: 'sample', orderIdx: 1 },
            ],
        },
    ];

    // ---- CS Fundamentals Questions (non-coding, text-based) ----
    const fundamentalsQuestions = [
        {
            slug: 'process-vs-thread',
            title: 'Process vs Thread',
            category: 'OS',
            difficulty: 'Easy',
            problemMd: `## Process vs Thread\n\nExplain the difference between a process and a thread. When would you use multiple processes vs multiple threads?`,
            tags: ['os', 'concurrency'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            followUpQuestions: ['What is a context switch?', 'What is shared between threads in the same process?', 'What are the risks of multi-threading?'],
        },
        {
            slug: 'tcp-vs-udp',
            title: 'TCP vs UDP',
            category: 'Networking',
            difficulty: 'Easy',
            problemMd: `## TCP vs UDP\n\nCompare TCP and UDP protocols. Give real-world examples of when you would use each.`,
            tags: ['networking', 'protocols'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            followUpQuestions: ['What is the three-way handshake?', 'Why is UDP faster?', 'What about HTTP/3 and QUIC?'],
        },
        {
            slug: 'acid-properties',
            title: 'ACID Properties',
            category: 'OS',
            difficulty: 'Medium',
            problemMd: `## ACID Properties\n\nExplain the ACID properties of database transactions. Give an example scenario where each property is important.`,
            tags: ['databases', 'transactions'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2', 'SDE3'],
            followUpQuestions: ['What happens if Isolation is not maintained?', 'What is eventual consistency?', 'How does this relate to CAP theorem?'],
        },
        {
            slug: 'solid-principles',
            title: 'SOLID Principles',
            category: 'OOP',
            difficulty: 'Medium',
            problemMd: `## SOLID Principles\n\nExplain each of the SOLID principles with a brief example for each.`,
            tags: ['oop', 'design-principles'],
            targetRoles: ['backend', 'frontend', 'fullstack'],
            targetLevels: ['SDE2', 'SDE3'],
            followUpQuestions: ['Which principle do you think is most frequently violated?', 'How does Dependency Inversion apply in your framework of choice?'],
        },
    ];

    // ---- SQL Questions ----
    const sqlQuestions = [
        {
            slug: 'second-highest-salary',
            title: 'Second Highest Salary',
            category: 'SQL',
            difficulty: 'Medium',
            problemMd: `## Second Highest Salary\n\nWrite a SQL query to get the second highest salary from the \`Employee\` table. If there is no second highest salary, the query should return \`null\`.\n\n\`\`\`\n+----+--------+\n| id | salary |\n+----+--------+\n| 1  | 100    |\n| 2  | 200    |\n| 3  | 300    |\n+----+--------+\n\`\`\``,
            tags: ['sql', 'subquery'],
            targetRoles: ['backend', 'fullstack'],
            targetLevels: ['SDE1', 'SDE2'],
            followUpQuestions: ['Can you write this without a subquery?', 'What about the Nth highest salary?', 'How would DENSE_RANK help here?'],
        },
    ];

    // Seed all questions
    for (const q of [...dsaQuestions, ...fundamentalsQuestions, ...sqlQuestions]) {
        const { starters, testCases, ...questionData } = q as any;

        const question = await legacy.question.upsert({
            where: { slug: questionData.slug },
            update: questionData,
            create: {
                ...questionData,
                examples: questionData.examples || [],
                hints: questionData.hints || [],
                followUpQuestions: questionData.followUpQuestions || [],
                tags: questionData.tags || [],
                companies: questionData.companies || [],
                targetRoles: questionData.targetRoles || [],
                targetLevels: questionData.targetLevels || [],
            },
        });

        // Seed starters if provided
        if (starters) {
            for (const s of starters) {
                await legacy.questionStarter.upsert({
                    where: {
                        questionId_language: { questionId: question.id, language: s.language },
                    },
                    update: { starter: s.starter, solution: s.solution || null },
                    create: {
                        questionId: question.id,
                        language: s.language,
                        starter: s.starter,
                        solution: s.solution || null,
                    },
                });
            }
        }

        // Seed test cases if provided
        if (testCases) {
            // Delete existing test cases for this question and re-create
            await legacy.questionTestCase.deleteMany({ where: { questionId: question.id } });
            for (const tc of testCases) {
                await legacy.questionTestCase.create({
                    data: {
                        questionId: question.id,
                        input: tc.input,
                        expected: tc.expected,
                        type: tc.type || 'edge',
                        orderIdx: tc.orderIdx || 0,
                    },
                });
            }
        }

        // Initialize analytics row
        await legacy.questionAnalytics.upsert({
            where: { questionId: question.id },
            update: {},
            create: { questionId: question.id },
        });

        console.log(`  ✅ ${question.category}/${question.difficulty}: ${question.title}`);
    }

    const count = await legacy.question.count();
    console.log(`\n🎉 Seeded ${count} questions total.`);
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
