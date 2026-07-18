// ============================================
// Seed: Problem Solving Case Questions
// ============================================
// Run with: npx tsx src/scripts/seed-problem-solving-cases.ts
// Safe seed: upserts by title, does not delete existing questions.

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "node:path";
import { ProblemSolvingCaseQuestion } from "../models/ProblemSolvingCaseQuestion.js";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const CASES = [
    {
        title: "Counterfeit Coin in Three Weighings",
        caseType: "logic_partitioning",
        difficulty: "Hard",
        prompt: "You have 12 identical-looking coins. Exactly one coin is counterfeit, and it may be either heavier or lighter than the real coins. You have a balance scale and can use it exactly three times. Design a strategy that always identifies the counterfeit coin and whether it is heavier or lighter.",
        candidateInstructions: "Restate the goal, list assumptions about the scale and coins, then reason out a strategy. You do not need to code.",
        assumptions: [
            "The balance scale only reports left heavy, right heavy, or balanced.",
            "Exactly one coin is counterfeit.",
            "The counterfeit can be heavier or lighter, and this is initially unknown.",
            "A valid strategy must work for every possible outcome path.",
        ],
        decompositionPrompts: [
            "How many possible states must your three weighings distinguish?",
            "What information does one weighing outcome give you?",
            "Can you design the first weighing so every outcome leaves at most nine possibilities?",
        ],
        hintLadder: [
            "Think of each weighing as producing one of three outcomes. Three weighings create 27 possible outcome paths.",
            "Each coin has two possible bad states: heavy or light. For 12 coins that is 24 states, so the strategy must partition states carefully.",
            "Try weighing 4 coins against 4 coins first, leaving 4 coins aside. Then handle the balanced and unbalanced branches differently.",
        ],
        followUps: [
            "What would your second weighing be if the first weighing balances?",
            "What would your second weighing be if the left side is heavier?",
            "How do you avoid confusing a heavy coin on one side with a light coin on the other side?",
        ],
        twist: {
            prompt: "Now suppose the first weighing is allowed to use only three coins per side. Does the three-weighing guarantee still work for 12 coins?",
            expectedAdaptation: "Candidate should reason that the first branch sizes may become too imbalanced and should verify remaining possible states against the two remaining weighings.",
        },
        convictionProbes: [
            "Why are you confident every branch leaves enough information to finish?",
            "Can you show one concrete outcome path from first weighing through final identification?",
            "What would break your strategy?",
        ],
        referenceSolution: "A strong solution frames this as ternary information. There are 24 possible counterfeit states, and 3 weighings provide up to 27 outcome paths. A known valid strategy begins by weighing coins 1-4 against 5-8. If balanced, the counterfeit is among 9-12; use known-good coins in the next two weighings to identify which and whether heavy/light. If unbalanced, the suspect states are the four heavy candidates on the heavy side plus four light candidates on the light side; the remaining two weighings must mix suspects and known-good coins to split those states into groups of at most three outcomes each. The exact tree may vary, but it must preserve a unique mapping from outcome path to coin and direction.",
        evaluationGuide: "Look for state counting, careful branch partitioning, explicit treatment of heavy vs light ambiguity, and proof that the strategy covers every outcome path.",
        redFlags: [
            "Assumes the counterfeit is only heavier or only lighter.",
            "Gives an intuitive strategy without verifying all branches.",
            "Uses the result of a weighing as if it identifies a coin directly.",
        ],
        successSignals: [
            "Counts 24 states and 27 possible outcome paths.",
            "Separates balanced and unbalanced first-weighing branches.",
            "Can defend why every branch is uniquely resolved.",
        ],
    },
    {
        title: "Bridge Crossing With One Torch",
        caseType: "optimization",
        difficulty: "Medium",
        prompt: "Four people need to cross a bridge at night with one torch. At most two people can cross at a time, and anyone crossing must have the torch. Their crossing times are 1, 2, 7, and 10 minutes. When two cross together, they move at the slower person's pace. Find the minimum total time and explain the strategy.",
        candidateInstructions: "Think aloud about why a locally fast move may not be globally optimal. State the sequence and total time.",
        assumptions: [
            "The torch must be carried on every crossing.",
            "At most two people can cross together.",
            "Someone must bring the torch back until everyone is across.",
            "Crossing together takes the slower person's time.",
        ],
        decompositionPrompts: [
            "Who are the best candidates to shuttle the torch back?",
            "Should the two slowest cross together or separately?",
            "Can you compare two different patterns for getting the slowest people across?",
        ],
        hintLadder: [
            "The fastest people are valuable not only for crossing but also for returns.",
            "Try comparing: send the two fastest as shuttles versus using the fastest alone as the shuttle.",
            "For times a <= b <= c <= d, compare 2b + a + d against 2a + c + d for moving c and d across.",
        ],
        followUps: [
            "Why is sending 1 back every time not necessarily optimal?",
            "What sequence gives 17 minutes?",
            "How would the strategy change if the slowest time were 50 instead of 10?",
        ],
        twist: {
            prompt: "Now add a fifth person with crossing time 3. How would you reason about extending the strategy?",
            expectedAdaptation: "Candidate should avoid recomputing randomly and describe repeatedly moving the two slowest remaining across using the cheaper of the two shuttle patterns.",
        },
        convictionProbes: [
            "Why do you believe 17 is minimal, not just a good sequence?",
            "Which return trips are unavoidable?",
            "What invariant or exchange argument supports your choice?",
        ],
        referenceSolution: "Optimal sequence: 1 and 2 cross (2), 1 returns (1), 7 and 10 cross (10), 2 returns (2), 1 and 2 cross (2). Total 17. The key is using 1 and 2 as shuttles so the two slowest cross together once, avoiding separate expensive trips.",
        evaluationGuide: "Evaluate for comparing strategies, not just finding a memorized answer. Strong candidates explain why the two slowest should cross together and why the returners matter.",
        redFlags: [
            "Uses a greedy always-send-fastest-back approach without comparing alternatives.",
            "Forgets return trips.",
            "Adds crossing times incorrectly when two people cross together.",
        ],
        successSignals: [
            "Finds the 17-minute sequence.",
            "Explains the shuttle trade-off.",
            "Can generalize to additional people.",
        ],
    },
    {
        title: "Poisoned Bottle With Limited Testers",
        caseType: "information_encoding",
        difficulty: "Medium",
        prompt: "You have 1000 bottles of liquid. Exactly one bottle is poisoned. You have 10 testers, and poison causes a clear reaction exactly 24 hours after ingestion. You have only one day to identify the poisoned bottle. How can you determine which bottle is poisoned?",
        candidateInstructions: "Restate the constraints, then design a testing scheme. You may use labels or encoding if useful.",
        assumptions: [
            "Exactly one bottle is poisoned.",
            "A tester can sample from multiple bottles.",
            "The reaction is binary: reacts or does not react.",
            "All test results are available after 24 hours.",
        ],
        decompositionPrompts: [
            "How many distinct result patterns can 10 binary testers produce?",
            "Can each bottle be mapped to one unique pattern?",
            "How would you label bottles to make decoding easy?",
        ],
        hintLadder: [
            "Each tester's result is one bit of information.",
            "Ten testers can represent 2^10 = 1024 distinct patterns.",
            "Label bottles from 1 to 1000 in binary. Tester i drinks from bottles whose label has bit i set.",
        ],
        followUps: [
            "How do you decode the result if testers 1, 4, and 7 react?",
            "What if no tester reacts?",
            "How would this change if there were two poisoned bottles?",
        ],
        twist: {
            prompt: "Now suppose each tester can drink from at most 100 bottles. Does the binary encoding scheme still work as-is?",
            expectedAdaptation: "Candidate should check load distribution per tester and reason that simple binary labeling may assign about 500 samples to a bit, violating the cap; a different design or more rounds/testers may be needed.",
        },
        convictionProbes: [
            "Why does binary encoding guarantee uniqueness?",
            "What assumption makes one-day identification possible?",
            "Where would this method fail?",
        ],
        referenceSolution: "Assign each bottle a unique 10-bit binary code from 1 to 1000. Tester i drinks from every bottle whose code has bit i set. After 24 hours, the set of reacting testers forms the binary code of the poisoned bottle. Since 2^10 = 1024, there are enough unique patterns for 1000 bottles.",
        evaluationGuide: "Look for recognizing testers as bits, mapping bottles to unique binary signatures, and decoding reaction patterns correctly. The twist tests whether they validate capacity assumptions.",
        redFlags: [
            "Tests bottles one by one.",
            "Does not exploit that testers can sample multiple bottles.",
            "Misses that 10 testers provide 1024 combinations.",
        ],
        successSignals: [
            "Uses binary encoding.",
            "Handles the no-reaction pattern carefully.",
            "Checks constraints under the twist.",
        ],
    },
    {
        title: "Airplane Seating Probability",
        caseType: "probability_reasoning",
        difficulty: "Medium",
        prompt: "There are 100 passengers boarding a plane with 100 assigned seats. The first passenger has lost their boarding pass and chooses a random seat. Each later passenger sits in their assigned seat if available; otherwise they choose a random available seat. What is the probability that the last passenger gets their assigned seat?",
        candidateInstructions: "Reason from smaller cases before jumping to a formula. Explain the state that matters.",
        assumptions: [
            "Only the first passenger chooses randomly without checking their assignment.",
            "A displaced passenger chooses uniformly among available seats.",
            "Everyone after the first follows the same rule.",
            "There are exactly as many passengers as seats.",
        ],
        decompositionPrompts: [
            "What happens for 2 passengers? For 3 passengers?",
            "Which seats are actually important to track?",
            "When does the process become decided?",
        ],
        hintLadder: [
            "Most middle passengers are irrelevant unless their seat is taken.",
            "The process ends when someone chooses either passenger 1's seat or passenger 100's seat.",
            "By symmetry, those two decisive seats are equally likely to be chosen first.",
        ],
        followUps: [
            "Can you explain why the answer does not depend on 100 specifically?",
            "What is the probability for n passengers?",
            "What if the first two passengers both choose random seats?",
        ],
        twist: {
            prompt: "Now suppose the first passenger chooses uniformly among all seats except their own. What changes?",
            expectedAdaptation: "Candidate should see passenger 1's own seat cannot be chosen initially, but the same two-seat absorbing argument needs to be revisited because one absorbing outcome is removed at the first step.",
        },
        convictionProbes: [
            "Why are passenger 1's seat and the last passenger's seat the only decisive states?",
            "Can you prove the symmetry argument?",
            "What smaller example validates your reasoning?",
        ],
        referenceSolution: "The probability is 1/2. Track only seat 1 and seat 100. If at any point a displaced passenger chooses seat 1, then every remaining passenger gets their own seat and passenger 100 gets seat 100. If a displaced passenger chooses seat 100, passenger 100 loses their seat. Until one of those two seats is chosen, the displacement continues. By symmetry, seat 1 and seat 100 are equally likely to be the first decisive seat chosen.",
        evaluationGuide: "Evaluate for reducing the process to the two absorbing seats, checking small n, and giving a clear symmetry proof rather than relying on memory.",
        redFlags: [
            "Guesses 1/100 or 99/100 without process reasoning.",
            "Tracks all seats unnecessarily and gets lost.",
            "Cannot explain why middle seats do not affect the final probability.",
        ],
        successSignals: [
            "Tests small cases.",
            "Identifies the two decisive seats.",
            "Explains the 1/2 symmetry cleanly.",
        ],
    },
    {
        title: "Two Jugs Exact Measurement",
        caseType: "state_search",
        difficulty: "Easy",
        prompt: "You have a 3-liter jug and a 5-liter jug, unlimited water, and a drain. The jugs have no markings. How can you measure exactly 4 liters?",
        candidateInstructions: "Describe the allowed operations and give a sequence. Then explain why it reaches exactly 4 liters.",
        assumptions: [
            "You can fill a jug completely.",
            "You can empty a jug completely.",
            "You can pour from one jug to the other until the source is empty or the target is full.",
            "The goal is exactly 4 liters in either jug.",
        ],
        decompositionPrompts: [
            "What states can the pair of jug volumes be in?",
            "What operation changes the state most predictably?",
            "Can you work backward from 4 liters in the 5-liter jug?",
        ],
        hintLadder: [
            "Try using the 3-liter jug to create a remainder inside the 5-liter jug.",
            "If the 5-liter jug has 2 liters, filling the 3-liter jug and pouring into it can leave 1 liter in the 3-liter jug.",
            "Once you have 1 liter, empty the 5-liter jug and pour the 1 liter into it, then add 3 more.",
        ],
        followUps: [
            "Can you represent your sequence as states like (3-jug, 5-jug)?",
            "What makes a target volume measurable with two jug sizes?",
            "Can you measure 2 liters with the same jugs?",
        ],
        twist: {
            prompt: "Now suppose the target is 4 liters but the jugs are 6 liters and 10 liters. Is it still always possible?",
            expectedAdaptation: "Candidate should recognize gcd reasoning: measurable amounts are multiples of gcd(6,10)=2, so 4 is possible, but not every target is possible.",
        },
        convictionProbes: [
            "Why does your sequence not rely on hidden markings?",
            "How would you know whether a target is impossible?",
            "What invariant exists across reachable amounts?",
        ],
        referenceSolution: "Fill the 5-liter jug, pour into the 3-liter jug, leaving 2 liters in the 5-liter jug. Empty the 3-liter jug. Pour the remaining 2 liters into the 3-liter jug. Fill the 5-liter jug again, then pour into the 3-liter jug until the 3-liter jug is full. Since it already had 2 liters, it accepts 1 liter, leaving exactly 4 liters in the 5-liter jug.",
        evaluationGuide: "Look for a legal operation sequence, state tracking, and recognition of gcd reachability for the twist.",
        redFlags: [
            "Uses imaginary markings.",
            "Skips state tracking and asserts the answer.",
            "Does not distinguish exact fill/empty/pour operations.",
        ],
        successSignals: [
            "Gives a valid sequence.",
            "Tracks volumes accurately.",
            "Mentions gcd or reachability under the twist.",
        ],
    },
    {
        title: "Interview Scheduling Under Constraints",
        caseType: "constraint_satisfaction",
        difficulty: "Hard",
        prompt: "You need to schedule 6 candidates across 3 interviewers in a single afternoon. Each candidate needs two interviews with different interviewers. Each interviewer has four available slots. Two candidates cannot attend the first slot, and one interviewer cannot attend the last slot. Design a scheduling approach that either produces a valid schedule or explains why none exists.",
        candidateInstructions: "Clarify constraints, propose a representation, and reason through feasibility before trying to fill slots greedily.",
        assumptions: [
            "Each slot can hold at most one interview per interviewer.",
            "Each candidate can attend at most one interview per slot.",
            "A candidate's two interviews must be with different interviewers.",
            "There are 12 total interview requirements and 11 usable interviewer-slots if one interviewer misses the last slot.",
        ],
        decompositionPrompts: [
            "How would you model this: bipartite matching, flow, or backtracking?",
            "What capacity constraints must be satisfied before assigning anything?",
            "Can you detect impossibility from total capacity?",
        ],
        hintLadder: [
            "Start with a capacity check: 6 candidates times 2 interviews is 12 required interviews.",
            "Three interviewers times four slots gives 12 slots, but one unavailable last slot reduces capacity to 11.",
            "If the capacity is below demand, no schedule can exist unless a constraint is relaxed.",
        ],
        followUps: [
            "Which single relaxation would make the schedule feasible?",
            "If capacity were sufficient, what algorithm would you use to construct the schedule?",
            "How would you encode candidate unavailability?",
        ],
        twist: {
            prompt: "Now suppose the unavailable interviewer can add one extra slot at the end. Give a constructive scheduling strategy, not necessarily the full schedule.",
            expectedAdaptation: "Candidate should move from impossibility proof to a matching or flow formulation with candidate-slot and interviewer capacity constraints.",
        },
        convictionProbes: [
            "Why is the original problem impossible?",
            "What constraints would your algorithm enforce explicitly?",
            "How would you test the scheduler for fairness?",
        ],
        referenceSolution: "The original constraints are impossible by capacity: 6 candidates need 12 total interviews. Three interviewers with four slots each provide 12 interviewer-slots, but one interviewer cannot attend the last slot, leaving only 11 available interviewer-slots. Since demand exceeds capacity, no schedule exists. With one added slot, model the problem as a bipartite matching or max-flow problem: source to candidate interview requirements, candidate-slot availability edges, slot-interviewer capacity edges, and interviewer capacity to sink.",
        evaluationGuide: "Strong candidates do not blindly schedule; they first check feasibility, identify the capacity contradiction, then propose a construction method when the twist restores capacity.",
        redFlags: [
            "Attempts a greedy schedule despite impossible capacity.",
            "Misses that each candidate needs two different interviewers.",
            "Does not model candidate and interviewer conflicts separately.",
        ],
        successSignals: [
            "Performs demand/capacity check.",
            "States impossibility clearly.",
            "Uses matching/flow/backtracking appropriately after the twist.",
        ],
    },
];

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not set in .env");

    await mongoose.connect(uri);
    console.log("Connected to MongoDB");

    let upserted = 0;
    let updated = 0;

    for (const item of CASES) {
        const result = await ProblemSolvingCaseQuestion.updateOne(
            { title: item.title },
            { $set: item },
            { upsert: true }
        );
        if (result.upsertedCount > 0) {
            upserted++;
            console.log(`Inserted: ${item.title}`);
        } else {
            updated++;
            console.log(`Updated: ${item.title}`);
        }
    }

    console.log(`Done. Inserted: ${upserted}, Updated: ${updated}`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
