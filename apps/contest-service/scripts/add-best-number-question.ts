/**
 * Script to insert the "Best Number" contest question into MongoDB.
 *
 * Usage:
 *   npx tsx scripts/add-best-number-question.ts
 *
 * Requires MONGODB_URI to be set in the environment (or in apps/.env).
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'mockr_questions';
const COLLECTION = 'contest_questions';
const COUNTER_ID = 'contest_questions_frontend_id';

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set. Add it to .env or export it.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI!, { dbName: MONGODB_DB });
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db!;
  const col = db.collection(COLLECTION);
  const counters = db.collection(COUNTER_ID.includes('counter') ? 'counters' : 'counters');

  // Check if already exists
  const existing = await col.findOne({ problemSlug: 'best-number' });
  if (existing) {
    console.log('⚠️  "Best Number" already exists (id:', existing._id.toString(), '). Skipping.');
    await mongoose.disconnect();
    return;
  }

  // Allocate next ID
  const maxDoc = await col
    .aggregate([
      { $project: { numId: { $convert: { input: '$frontendId', to: 'int', onError: 0, onNull: 0 } } } },
      { $sort: { numId: -1 } },
      { $limit: 1 },
    ])
    .toArray();
  const maxExisting = Number(maxDoc[0]?.numId || 0);
  await counters.updateOne(
    { _id: COUNTER_ID as any },
    { $max: { seq: maxExisting }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  const counterResult = await counters.findOneAndUpdate(
    { _id: COUNTER_ID as any },
    { $inc: { seq: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  const nextId = String(
    (counterResult && 'value' in counterResult ? (counterResult as any).value?.seq : (counterResult as any)?.seq) || maxExisting + 1,
  );

  const now = new Date();

  const question = {
    title: 'Best Number',
    problemId: nextId,
    frontendId: nextId,
    difficulty: 'Medium',
    problemSlug: 'best-number',
    topics: ['Math', 'Simulation', 'Greedy'],
    companyTags: [],
    description: `Egor is fascinated by the number $x$ and is participating in a peculiar election known as the **Best Number** contest.

There are $n$ voters. The $i$-th voter brings a positive integer $a_i$ and declares it as a candidate. Voters then proceed to vote: each voter votes for the candidate whose value is **closest** to $x$. If two candidates are equally close, the voter breaks the tie in favor of the **smaller** candidate.

A candidate wins the election if it receives **strictly more votes** than every other candidate.

For each voter $i$, determine whether the candidate $a_i$ wins the election.

### Input

The first line contains two integers $n$ and $x$ ($1 \\le n \\le 2 \\cdot 10^5$, $1 \\le x \\le 10^9$) — the number of voters and Egor's favourite number.

The second line contains $n$ integers $a_1, a_2, \\ldots, a_n$ ($1 \\le a_i \\le 10^9$) — the candidates declared by each voter.

### Output

Print a binary string of length $n$. The $i$-th character should be **1** if candidate $a_i$ wins the election, and **0** otherwise.`,
    examples: [
      {
        example_num: 1,
        example_text: `Input:
5 3
1 2 3 4 5

Output:
00100

Explanation:
All voters vote for the candidate closest to $x = 3$. The candidate $3$ is at distance $0$, so it receives all 5 votes. No other candidate gets any votes, and $3$ wins. Hence the answer is "00100" — only position 3 is "1".`,
      },
      {
        example_num: 2,
        example_text: `Input:
4 5
1 9 5 5

Output:
0011

Explanation:
Candidate $5$ is at distance $0$ from $x = 5$. Voters 1 and 2 also prefer $5$ (distance 0 is better than distances 4 and 4). Candidate $5$ appears twice (voters 3 and 4), and each copy is a separate candidate — but they are the same value so they tie. Since all 4 votes go to value $5$ and both copies share the same value, each of the two copies gets 2 votes (votes split equally among identical candidates). No other candidate receives more, but neither copy receives strictly more than the other. Both copies win.`,
      },
      {
        example_num: 3,
        example_text: `Input:
3 10
1 1 1

Output:
111

Explanation:
All three candidates have the same value $1$. Each voter votes for value $1$ (the only candidate). All three copies share the 3 votes equally (1 vote each). Since no candidate receives strictly more, and all candidates tie — each candidate wins (they all have the same count and there is no one with strictly more).`,
      },
    ],
    constraints: [
      '$1 \\le n \\le 2 \\cdot 10^5$',
      '$1 \\le x \\le 10^9$',
      '$1 \\le a_i \\le 10^9$',
    ],
    sampleTestCases: [
      { id: 'sample_1', description: 'Basic case', input: '5 3\n1 2 3 4 5', output: '00100' },
      { id: 'sample_2', description: 'Duplicates at optimal', input: '4 5\n1 9 5 5', output: '0011' },
      { id: 'sample_3', description: 'All same', input: '3 10\n1 1 1', output: '111' },
    ],
    hiddenTestCases: [
      { id: 'hidden_1', description: 'Single voter', input: '1 1\n1', output: '1' },
      { id: 'hidden_2', description: 'Two equidistant — smaller wins', input: '2 5\n3 7', output: '10' },
      { id: 'hidden_3', description: 'Large x with small values', input: '3 1000000000\n999999999 1000000000 999999998', output: '010' },
      { id: 'hidden_4', description: 'Tie between many duplicates', input: '6 5\n5 5 5 5 5 5', output: '111111' },
      { id: 'hidden_5', description: 'Two distinct equidistant', input: '4 5\n4 6 4 6', output: '1010' },
      { id: 'hidden_6', description: 'One clear winner among many', input: '5 10\n1 2 10 20 30', output: '00100' },
      { id: 'hidden_7', description: 'Reverse sorted', input: '5 3\n5 4 3 2 1', output: '00100' },
      { id: 'hidden_8', description: 'All far from x', input: '4 500\n1 999 1 999', output: '1010' },
      { id: 'hidden_9', description: 'Large n uniform', input: '3 50\n49 51 50', output: '001' },
      { id: 'hidden_10', description: 'x equals a candidate exactly', input: '5 7\n7 7 8 6 100', output: '11000' },
    ],
    codeSnippets: {
      python3: {
        starter_code: `import sys
input = sys.stdin.readline

def solve():
    n, x = map(int, input().split())
    a = list(map(int, input().split()))
    # Your code here
    print("")

solve()`,
        wrapper_code: '',
      },
      cpp: {
        starter_code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    
    int n;
    long long x;
    cin >> n >> x;
    
    vector<long long> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    
    // Your code here
    
    return 0;
}`,
        wrapper_code: '',
      },
      java: {
        starter_code: `import java.util.*;
import java.io.*;

public class Solution {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        long x = Long.parseLong(st.nextToken());
        
        st = new StringTokenizer(br.readLine());
        long[] a = new long[n];
        for (int i = 0; i < n; i++) {
            a[i] = Long.parseLong(st.nextToken());
        }
        
        // Your code here
        
        System.out.println("");
    }
}`,
        wrapper_code: '',
      },
      javascript: {
        starter_code: `const input = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split('\\n');
const [n, x] = input[0].split(' ').map(Number);
const a = input[1].split(' ').map(Number);

// Your code here

console.log("");`,
        wrapper_code: '',
      },
    },
    followUp: [],
    hints: [
      'For each voter, compute the distance $|a_i - x|$ to find which candidate value each voter prefers.',
      'All voters will prefer the same candidate value — the one closest to $x$ (ties broken by smaller value). Count how many copies of that winning value exist and how many total votes it gets.',
    ],
    solution: {
      bruteForce: {
        explanation: 'For each voter, find the candidate closest to x (breaking ties by smaller value). Count votes for each candidate value. Then check if a value has strictly more votes than all others.',
        timeComplexity: 'O(n log n)',
        spaceComplexity: 'O(n)',
        code: {},
      },
      optimized: {
        explanation: 'All voters vote for the same value — the unique candidate value closest to x (tie-break: smaller). So compute that best value, count its occurrences, check if its vote count is strictly greater than every other candidate\'s count. Each copy of the best value is a winner iff (total_votes / count_of_best_value copies) > max_count_of_any_other_value. Since all votes go to the best value, every copy of it wins and everything else loses.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
        code: {
          python3: `import sys
from collections import Counter
input = sys.stdin.readline

def solve():
    n, x = map(int, input().split())
    a = list(map(int, input().split()))
    
    # Find the best candidate value (closest to x, tie-break smaller)
    best_val = None
    best_dist = float('inf')
    for v in a:
        d = abs(v - x)
        if d < best_dist or (d == best_dist and v < best_val):
            best_dist = d
            best_val = v
    
    # All n votes go to best_val
    # Count how many copies of best_val exist
    cnt = Counter(a)
    best_count = cnt[best_val]
    
    # Each copy of best_val gets n // best_count votes (they split equally)
    # Actually: all voters vote for best_val. The votes are shared among
    # all copies of best_val. Each copy gets total_votes / copies.
    # But for the "strictly more" check, we compare votes per copy.
    # Since all votes go to best_val copies: votes_per_copy = n / best_count (integer division doesn't matter for comparison)
    # For other values: votes = 0
    # So best_val copies always win (they have > 0 votes, others have 0)
    # Unless... we need to check if best_val copies tie among themselves.
    # A candidate wins if it has strictly more votes than EVERY other candidate.
    # All copies of best_val get the same number of votes, so they don't beat each other.
    # But they DO beat all other candidates (who get 0 votes).
    # So: a copy of best_val wins iff no other candidate has >= its vote count.
    # Since others have 0 and best copies have n/best_count > 0, best copies win.
    
    result = []
    for v in a:
        if v == best_val:
            result.append('1')
        else:
            result.append('0')
    
    print(''.join(result))

solve()`,
          cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    
    int n;
    long long x;
    cin >> n >> x;
    
    vector<long long> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    
    // Find best candidate value
    long long bestVal = a[0];
    long long bestDist = abs(a[0] - x);
    for (int i = 1; i < n; i++) {
        long long d = abs(a[i] - x);
        if (d < bestDist || (d == bestDist && a[i] < bestVal)) {
            bestDist = d;
            bestVal = a[i];
        }
    }
    
    string result(n, '0');
    for (int i = 0; i < n; i++) {
        if (a[i] == bestVal) result[i] = '1';
    }
    
    cout << result << "\\n";
    return 0;
}`,
          java: `import java.util.*;
import java.io.*;

public class Solution {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        long x = Long.parseLong(st.nextToken());
        
        st = new StringTokenizer(br.readLine());
        long[] a = new long[n];
        for (int i = 0; i < n; i++) {
            a[i] = Long.parseLong(st.nextToken());
        }
        
        long bestVal = a[0];
        long bestDist = Math.abs(a[0] - x);
        for (int i = 1; i < n; i++) {
            long d = Math.abs(a[i] - x);
            if (d < bestDist || (d == bestDist && a[i] < bestVal)) {
                bestDist = d;
                bestVal = a[i];
            }
        }
        
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            sb.append(a[i] == bestVal ? '1' : '0');
        }
        System.out.println(sb.toString());
    }
}`,
          javascript: `const input = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split('\\n');
const [n, x] = input[0].split(' ').map(Number);
const a = input[1].split(' ').map(Number);

let bestVal = a[0];
let bestDist = Math.abs(a[0] - x);
for (let i = 1; i < n; i++) {
    const d = Math.abs(a[i] - x);
    if (d < bestDist || (d === bestDist && a[i] < bestVal)) {
        bestDist = d;
        bestVal = a[i];
    }
}

const result = a.map(v => v === bestVal ? '1' : '0').join('');
console.log(result);`,
        },
      },
    },
    isUsedInContest: false,
    currentlyChoosedForContest: false,
    usedInContests: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(question);
  console.log('✅ "Best Number" question inserted successfully!');
  console.log('   MongoDB _id:', result.insertedId.toString());
  console.log('   problemId / frontendId:', nextId);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
