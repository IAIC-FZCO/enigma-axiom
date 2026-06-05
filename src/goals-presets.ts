/**
 * Starter goal templates shown when the user's goal tree is empty, so the first
 * run isn't a blank page. One click adds them as normal, editable goals.
 *
 * Domains follow the popular "Wheel of Life" areas (Career, Finance, Health,
 * Family, Growth, Recreation) plus research/science; subgoals are concrete
 * (SMART-flavoured: specific + measurable) and intentionally wholesome.
 * Shared by the toolbar popup (GoalsPanel) and the on-page window (inline.ts)
 * so both show the same set.
 */

export interface GoalPreset {
  goal: string;
  subgoals: string[];
}

export const GOAL_PRESETS: GoalPreset[] = [
  {
    goal: "Finances",
    subgoals: [
      "Build a 6-month emergency fund",
      "Save or invest 20% of income each month",
      "Pay off high-interest debt",
    ],
  },
  {
    goal: "Career",
    subgoals: [
      "Earn a promotion or raise this year",
      "Master one high-value skill for my field",
      "Add 5 new professional contacts each quarter",
    ],
  },
  {
    goal: "Research & Science",
    subgoals: [
      "Publish or submit one paper",
      "Read one key paper every week",
      "Start a new experiment or idea",
    ],
  },
  {
    goal: "Health & Sport",
    subgoals: [
      "Exercise at least 3 times a week",
      "Sleep 7-8 hours consistently",
      "Run or complete a 5K",
    ],
  },
  {
    goal: "Family",
    subgoals: [
      "Weekly quality time, no screens",
      "Call parents or close ones regularly",
      "Plan one trip together",
    ],
  },
  {
    goal: "Travel",
    subgoals: [
      "Visit one new country",
      "Take a short trip each quarter",
      "Learn the basics of a new language",
    ],
  },
  {
    goal: "Learning",
    subgoals: [
      "Read 24 books this year (2 a month)",
      "Finish one online course",
      "Practice a new skill 30 min a day",
    ],
  },
];

/**
 * Seed the preset tree using a caller-supplied create(goalText, parentId) → id
 * function. Creates each super-goal, then its subgoals under it. Best-effort:
 * if a super-goal fails to create, its subgoals are skipped.
 */
export async function seedPresetGoals(
  create: (goalText: string, parentId: string | null) => Promise<string | null>,
): Promise<void> {
  for (const p of GOAL_PRESETS) {
    const parentId = await create(p.goal, null);
    if (!parentId) continue;
    for (const s of p.subgoals) {
      await create(s, parentId);
    }
  }
}
