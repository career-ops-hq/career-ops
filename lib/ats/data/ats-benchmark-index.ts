import softwareEngineer from './ats-benchmarks/software-engineer.json' with { type: 'json' };
import dataScientist from './ats-benchmarks/data-scientist.json' with { type: 'json' };
import marketingManager from './ats-benchmarks/marketing-manager.json' with { type: 'json' };
import financialAnalyst from './ats-benchmarks/financial-analyst.json' with { type: 'json' };
import productManager from './ats-benchmarks/product-manager.json' with { type: 'json' };
import entryLevelEngineer from './ats-benchmarks/entry-level-engineer.json' with { type: 'json' };
import engineeringManager from './ats-benchmarks/engineering-manager.json' with { type: 'json' };
import salesManager from './ats-benchmarks/sales-manager.json' with { type: 'json' };
import uxDesigner from './ats-benchmarks/ux-designer.json' with { type: 'json' };
import operationsManager from './ats-benchmarks/operations-manager.json' with { type: 'json' };

export interface ATSBenchmark {
  id: string;
  role: string;
  category: string;
  level: string;
  expectedScore: [number, number];
  rawText: string;
  jobDescriptionText?: string;
  sections: string[];
  skills: string[];
  keywords: string[];
  achievementSignals: string[];
  formattingSignals: {
    singleColumn: boolean;
    standardHeadings: boolean;
    tables: boolean;
    graphics: boolean;
    icons: boolean;
    readablePdfText: boolean;
  };
  qualitySignals: {
    quantifiedAchievements: boolean;
    actionVerbs: boolean;
    relevantKeywords: boolean;
    clearDates: boolean;
    careerProgression: boolean;
  };
}

export const ATS_BENCHMARKS: ATSBenchmark[] = [
  {
    id: softwareEngineer.resumeId,
    role: softwareEngineer.targetRole,
    category: softwareEngineer.category,
    level: softwareEngineer.experienceLevel,
    expectedScore: softwareEngineer.expectedScore as [number, number],
    rawText: softwareEngineer.rawText,
    jobDescriptionText: softwareEngineer.jobDescriptionText,
    sections: softwareEngineer.sections,
    skills: softwareEngineer.skills,
    keywords: softwareEngineer.keywords,
    achievementSignals: softwareEngineer.achievementSignals,
    formattingSignals: softwareEngineer.formattingSignals,
    qualitySignals: softwareEngineer.qualitySignals
  },
  {
    id: dataScientist.resumeId,
    role: dataScientist.targetRole,
    category: dataScientist.category,
    level: dataScientist.experienceLevel,
    expectedScore: dataScientist.expectedScore as [number, number],
    rawText: dataScientist.rawText,
    jobDescriptionText: dataScientist.jobDescriptionText,
    sections: dataScientist.sections,
    skills: dataScientist.skills,
    keywords: dataScientist.keywords,
    achievementSignals: dataScientist.achievementSignals,
    formattingSignals: dataScientist.formattingSignals,
    qualitySignals: dataScientist.qualitySignals
  },
  {
    id: marketingManager.resumeId,
    role: marketingManager.targetRole,
    category: marketingManager.category,
    level: marketingManager.experienceLevel,
    expectedScore: marketingManager.expectedScore as [number, number],
    rawText: marketingManager.rawText,
    jobDescriptionText: marketingManager.jobDescriptionText,
    sections: marketingManager.sections,
    skills: marketingManager.skills,
    keywords: marketingManager.keywords,
    achievementSignals: marketingManager.achievementSignals,
    formattingSignals: marketingManager.formattingSignals,
    qualitySignals: marketingManager.qualitySignals
  },
  {
    id: financialAnalyst.resumeId,
    role: financialAnalyst.targetRole,
    category: financialAnalyst.category,
    level: financialAnalyst.experienceLevel,
    expectedScore: financialAnalyst.expectedScore as [number, number],
    rawText: financialAnalyst.rawText,
    jobDescriptionText: financialAnalyst.jobDescriptionText,
    sections: financialAnalyst.sections,
    skills: financialAnalyst.skills,
    keywords: financialAnalyst.keywords,
    achievementSignals: financialAnalyst.achievementSignals,
    formattingSignals: financialAnalyst.formattingSignals,
    qualitySignals: financialAnalyst.qualitySignals
  },
  {
    id: productManager.resumeId,
    role: productManager.targetRole,
    category: productManager.category,
    level: productManager.experienceLevel,
    expectedScore: productManager.expectedScore as [number, number],
    rawText: productManager.rawText,
    jobDescriptionText: productManager.jobDescriptionText,
    sections: productManager.sections,
    skills: productManager.skills,
    keywords: productManager.keywords,
    achievementSignals: productManager.achievementSignals,
    formattingSignals: productManager.formattingSignals,
    qualitySignals: productManager.qualitySignals
  },
  {
    id: entryLevelEngineer.resumeId,
    role: entryLevelEngineer.targetRole,
    category: entryLevelEngineer.category,
    level: entryLevelEngineer.experienceLevel,
    expectedScore: entryLevelEngineer.expectedScore as [number, number],
    rawText: entryLevelEngineer.rawText,
    jobDescriptionText: entryLevelEngineer.jobDescriptionText,
    sections: entryLevelEngineer.sections,
    skills: entryLevelEngineer.skills,
    keywords: entryLevelEngineer.keywords,
    achievementSignals: entryLevelEngineer.achievementSignals,
    formattingSignals: entryLevelEngineer.formattingSignals,
    qualitySignals: entryLevelEngineer.qualitySignals
  },
  {
    id: engineeringManager.resumeId,
    role: engineeringManager.targetRole,
    category: engineeringManager.category,
    level: engineeringManager.experienceLevel,
    expectedScore: engineeringManager.expectedScore as [number, number],
    rawText: engineeringManager.rawText,
    jobDescriptionText: engineeringManager.jobDescriptionText,
    sections: engineeringManager.sections,
    skills: engineeringManager.skills,
    keywords: engineeringManager.keywords,
    achievementSignals: engineeringManager.achievementSignals,
    formattingSignals: engineeringManager.formattingSignals,
    qualitySignals: engineeringManager.qualitySignals
  },
  {
    id: salesManager.resumeId,
    role: salesManager.targetRole,
    category: salesManager.category,
    level: salesManager.experienceLevel,
    expectedScore: salesManager.expectedScore as [number, number],
    rawText: salesManager.rawText,
    jobDescriptionText: salesManager.jobDescriptionText,
    sections: salesManager.sections,
    skills: salesManager.skills,
    keywords: salesManager.keywords,
    achievementSignals: salesManager.achievementSignals,
    formattingSignals: salesManager.formattingSignals,
    qualitySignals: salesManager.qualitySignals
  },
  {
    id: uxDesigner.resumeId,
    role: uxDesigner.targetRole,
    category: uxDesigner.category,
    level: uxDesigner.experienceLevel,
    expectedScore: uxDesigner.expectedScore as [number, number],
    rawText: uxDesigner.rawText,
    jobDescriptionText: uxDesigner.jobDescriptionText,
    sections: uxDesigner.sections,
    skills: uxDesigner.skills,
    keywords: uxDesigner.keywords,
    achievementSignals: uxDesigner.achievementSignals,
    formattingSignals: uxDesigner.formattingSignals,
    qualitySignals: uxDesigner.qualitySignals
  },
  {
    id: operationsManager.resumeId,
    role: operationsManager.targetRole,
    category: operationsManager.category,
    level: operationsManager.experienceLevel,
    expectedScore: operationsManager.expectedScore as [number, number],
    rawText: operationsManager.rawText,
    jobDescriptionText: operationsManager.jobDescriptionText,
    sections: operationsManager.sections,
    skills: operationsManager.skills,
    keywords: operationsManager.keywords,
    achievementSignals: operationsManager.achievementSignals,
    formattingSignals: operationsManager.formattingSignals,
    qualitySignals: operationsManager.qualitySignals
  }
];

export function getBenchmarkById(id: string): ATSBenchmark | undefined {
  return ATS_BENCHMARKS.find(b => b.id === id);
}
