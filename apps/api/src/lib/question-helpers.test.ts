import { buildIDEResponse, normalizeDSAQuestion } from './question-helpers.js';

describe('question helpers', () => {
  test('normalizes camelCase snippet fields and c++ language key to cpp', () => {
    const doc: any = {
      _id: { toString: () => 'mongo-id-11' },
      title: 'Container With Most Water',
      problemId: '11',
      frontendId: '11',
      difficulty: 'Medium',
      problemSlug: 'container-with-most-water',
      topics: ['Array'],
      companyTags: ['Meta'],
      description: 'Problem statement',
      examples: [],
      constraints: [],
      sampleTestCases: [],
      hiddenTestCases: [],
      hints: [],
      codeSnippets: new Map([
        ['c++', { starterCode: 'class Solution {\npublic:\n    int maxArea(vector<int>& h) { return 0; }\n};', wrapperCode: 'int main() { return 0; }' }],
      ]),
      solution: {
        bruteForce: {
          explanation: 'Description: Check every pair\nTime Complexity: O(n^2)\nSpace Complexity: O(1)',
          code: new Map([['c++', 'class Solution { };']]),
        },
      },
    };

    const normalized = normalizeDSAQuestion(doc);
    const response = buildIDEResponse(normalized);

    expect(normalized.starters.some((s) => s.language === 'cpp')).toBe(true);
    expect(response.starter_code.cpp).toContain('class Solution');
    expect(response.solution?.bruteForce?.explaination).toBe('Check every pair');
    expect(response.solution?.bruteForce?.timeComplexity).toBe('O(n^2)');
    expect(response.solution?.bruteForce?.spaceComplexity).toBe('O(1)');
    expect(response.solution?.bruteForce?.code?.cpp).toContain('class Solution');
    expect(response.companyTags).toEqual(['Meta']);
  });

  test('keeps explicit structured solution fields as-is', () => {
    const doc: any = {
      _id: { toString: () => 'mongo-id-1' },
      title: 'Two Sum',
      problemId: '1',
      frontendId: '1',
      difficulty: 'Easy',
      problemSlug: 'two-sum',
      topics: [],
      companyTags: [],
      description: 'Problem statement',
      examples: [],
      constraints: [],
      sampleTestCases: [],
      hiddenTestCases: [],
      hints: [],
      codeSnippets: new Map(),
      solution: {
        optimized: {
          explaination: 'Use a hash map',
          timeComplexity: 'O(n)',
          spaceComplexity: 'O(n)',
          explanation: 'Use a hash map',
        },
      },
    };

    const response = buildIDEResponse(normalizeDSAQuestion(doc));

    expect(response.solution?.optimized?.explaination).toBe('Use a hash map');
    expect(response.solution?.optimized?.timeComplexity).toBe('O(n)');
    expect(response.solution?.optimized?.spaceComplexity).toBe('O(n)');
  });

  test('wraps method-only cpp starter into class Solution', () => {
    const doc: any = {
      _id: { toString: () => 'mongo-id-2' },
      title: 'Container',
      problemId: '11',
      frontendId: '11',
      difficulty: 'Medium',
      problemSlug: 'container-with-most-water',
      topics: [],
      companyTags: [],
      description: 'Problem statement',
      examples: [],
      constraints: [],
      sampleTestCases: [],
      hiddenTestCases: [],
      hints: [],
      codeSnippets: new Map([
        ['cpp', { starterCode: 'int maxArea(vector<int>& height) {\n    return 0;\n}' }],
      ]),
    };

    const response = buildIDEResponse(normalizeDSAQuestion(doc));
    expect(response.starter_code.cpp).toContain('class Solution');
    expect(response.starter_code.cpp).toContain('int maxArea(vector<int>& height)');
  });

  test('normalizes simple Python and JavaScript starters into class Solution', () => {
    const doc: any = {
      _id: { toString: () => 'mongo-id-22' },
      title: 'Window Sum',
      problemId: '22',
      frontendId: '22',
      difficulty: 'Easy',
      problemSlug: 'window-sum',
      topics: [],
      companyTags: [],
      description: 'Problem statement',
      examples: [],
      constraints: [],
      sampleTestCases: [],
      hiddenTestCases: [],
      hints: [],
      codeSnippets: new Map([
        ['python3', { starterCode: 'def solve(nums, k):\n    return 0' }],
        ['javascript', { starterCode: 'function solve(nums, k) {\n  return 0;\n}' }],
      ]),
    };

    const response = buildIDEResponse(normalizeDSAQuestion(doc));

    expect(response.starter_code.python3).toContain('class Solution:');
    expect(response.starter_code.python3).toContain('def solve(self, nums, k):');
    expect(response.starter_code.javascript).toContain('class Solution');
    expect(response.starter_code.javascript).toContain('solve(nums, k)');
  });

  test('filters non-language keys from solution code map', () => {
    const doc: any = {
      _id: { toString: () => 'mongo-id-3' },
      title: 'Roman to Integer',
      problemId: '13',
      frontendId: '13',
      difficulty: 'Easy',
      problemSlug: 'roman-to-integer',
      topics: [],
      companyTags: [],
      description: 'Problem statement',
      examples: [],
      constraints: [],
      sampleTestCases: [],
      hiddenTestCases: [],
      hints: [],
      codeSnippets: new Map(),
      solution: {
        bruteForce: {
          explaination: 'Parse from left to right',
          timeComplexity: 'O(n)',
          spaceComplexity: 'O(1)',
          code: {
            python3: 'class Solution:\n    pass',
            cpp: 'class Solution { };',
            time_complexity: 'O(n)',
            space_complexity: 'O(1)',
          },
        },
      },
    };

    const response = buildIDEResponse(normalizeDSAQuestion(doc));
    const keys = Object.keys(response.solution?.bruteForce?.code || {});

    expect(keys).toContain('python3');
    expect(keys).toContain('cpp');
    expect(keys).not.toContain('time_complexity');
    expect(keys).not.toContain('space_complexity');
  });
});
