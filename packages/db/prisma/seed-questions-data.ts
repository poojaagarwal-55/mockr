// Combines all question data parts into a single export
import { questionsP1 } from './seed-questions-p1';
import { questionsP2 } from './seed-questions-p2';
import { questionsP3 } from './seed-questions-p3';

export const allNewQuestions = [...questionsP1, ...questionsP2, ...questionsP3];
