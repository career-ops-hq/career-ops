/**
 * What the score screen is allowed to claim.
 * The rubric in modes/_shared.md scores five dimensions. Requirement
 * importance, posting legitimacy, evidence confidence, and role clarity do not
 * move the 1-5 number. The bands come from the shared score-action table.
 */
import { APPLY_MIN, MAYBE_MIN, SCORE_BANDS, STRONG_APPLY_MIN } from "./core/score-action.mjs";

export function scoringDimensions() {
  return [
    { name: "CV match", detail: "How well your CV maps to the stated requirements. This moves the score." },
    { name: "North Star alignment", detail: "How close the role is to the career goal in your profile. This moves the score." },
    { name: "Compensation", detail: "Pay the posting states. When the posting states none, this is unknown and does not move the score." },
    { name: "Cultural signals", detail: "Culture evidence in the posting. No evidence means unknown, not a middle score, and unknown does not move the score." },
    { name: "Red flags", detail: "Warnings can move the score down. A hard stop forces Skip and does not change the score." },
  ];
}

export function ignoredByScore() {
  return [
    "Posting legitimacy (report block G)",
    "How important a requirement is (block B)",
    "Evidence confidence",
    "Role clarity",
  ];
}

export function scoreBandSummary() {
  const strong = SCORE_BANDS.find((band) => band.id === "strong_apply");
  const apply = SCORE_BANDS.find((band) => band.id === "apply");
  const maybe = SCORE_BANDS.find((band) => band.id === "maybe");
  const skip = SCORE_BANDS.find((band) => band.id === "skip");
  return [
    `${strong.label} starts at ${STRONG_APPLY_MIN.toFixed(1)}. The recommendation is ${strong.decision}.`,
    `${apply.label} starts at ${APPLY_MIN.toFixed(1)}. The recommendation is ${apply.decision}.`,
    `${maybe.label} starts at ${MAYBE_MIN.toFixed(1)}. The recommendation is ${maybe.decision}. Do not apply unless you have a reason.`,
    `${skip.label} is below ${MAYBE_MIN.toFixed(1)}. The recommendation is ${skip.decision}.`,
  ];
}

export function leverCopy() {
  return {
    sectionTitle: "Score and recommendation",
    holdingTitle: "Holding it down",
    holdingHint: "Hard stops force Skip. They do not change the score.",
    closeTitle: "CV gaps",
    closeHint: "Gaps in the match between your CV and the role. The match dimension can move the score.",
    verifyTitle: "Check the evidence",
    verifyHint: "Open questions. Evidence confidence does not change the 1 to 5 score.",
    strengthsTitle: "Working for you",
    strengthsHint: "The strongest matches named for this role.",
  };
}
