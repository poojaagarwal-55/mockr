/**
 * Question Models Registration
 * Registers all question models with the contest-selection tracking fields
 * This ensures the models are available for contest service operations
 */

import mongoose, { Schema } from 'mongoose';

/**
 * Common fields for contest tracking
 * These fields are added to all question models
 */
const contestTrackingFields = {
  usedInContests: {
    type: [String],
    default: [],
    index: true,
  },
  isUsedInContest: {
    type: Boolean,
    default: false,
    index: true,
  },
  currentlyChoosedForContest: {
    type: Boolean,
    default: false,
    index: true,
  },
};

/**
 * Register all question models
 * This function should be called during service initialization
 */
export function registerQuestionModels() {
  // Define minimal schemas for contest service
  // We only need the fields required for contest operations

  const BaseQuestionSchema = new Schema(
    {
      title: { type: String, required: true },
      difficulty: {
        type: String,
        required: true,
        enum: ['Easy', 'Medium', 'Hard'],
      },
      topics: { type: [String], default: [] },
      ...contestTrackingFields,
    },
    { strict: false, timestamps: true }
  );

  // Register all question model types
  const questionTypes = [
    { name: 'ContestDSAQuestion', collection: 'contest_questions' },
    { name: 'ContestMCQQuestion', collection: 'contest_mcq_questions' },
    { name: 'DSAQuestion', collection: 'dsa_questions' },
    { name: 'DSSQLQuestion', collection: 'ds_sql_questions' },
    { name: 'DSCodingQuestion', collection: 'ds_coding_questions' },
    { name: 'DSConceptQuestion', collection: 'ds_concept_questions' },
    { name: 'SQLQuestion', collection: 'sql_questions' },
    { name: 'CSFundamentalQuestion', collection: 'cs_fundamental_questions' },
    { name: 'GenAICodingQuestion', collection: 'genai_coding_questions' },
    { name: 'GenAIConceptQuestion', collection: 'genai_concept_questions' },
    { name: 'GenAIEthicsQuestion', collection: 'genai_ethics_questions' },
    { name: 'GenAISystemDesignQuestion', collection: 'genai_system_design_questions' },
    { name: 'PMCaseQuestion', collection: 'pm_case_questions' },
    { name: 'PMConceptQuestion', collection: 'pm_concept_questions' },
    { name: 'PMStrategyQuestion', collection: 'pm_strategy_questions' },
  ];

  for (const { name, collection } of questionTypes) {
    if (mongoose.models[name]) continue;
    const schema = BaseQuestionSchema.clone();
    mongoose.model(name, schema, collection);
  }

  console.log('✅ Question models registered for contest service');
}

/**
 * Get a question model by type
 * @param type - The question type (e.g., 'dsa', 'sql', 'ds-sql')
 * @returns The mongoose model for the question type
 */
export function getQuestionModel(type: string) {
  // Ensure models are registered
  registerQuestionModels();

  // Map question types to model names
  const typeMap: Record<string, string> = {
    'contest-dsa': 'ContestDSAQuestion',
    'contest-mcq': 'ContestMCQQuestion',
    'mcq': 'ContestMCQQuestion',
    'dsa': 'DSAQuestion',
    'sql': 'SQLQuestion',
    'ds-sql': 'DSSQLQuestion',
    'ds-coding': 'DSCodingQuestion',
    'ds-concept': 'DSConceptQuestion',
    'cs-fundamental': 'CSFundamentalQuestion',
    'genai-coding': 'GenAICodingQuestion',
    'genai-concept': 'GenAIConceptQuestion',
    'genai-ethics': 'GenAIEthicsQuestion',
    'genai-system-design': 'GenAISystemDesignQuestion',
    'pm-case': 'PMCaseQuestion',
    'pm-concept': 'PMConceptQuestion',
    'pm-strategy': 'PMStrategyQuestion',
  };

  const modelName = typeMap[type];
  if (!modelName) {
    throw new Error(`Unknown question type: ${type}`);
  }

  return mongoose.model(modelName);
}
