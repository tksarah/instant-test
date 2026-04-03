import type { ClassRoom, InstantTest, StudentAttempt } from "@/lib/mock-data";
import {
  getClassByCodePublic,
  getPublicTestStats,
  getPublishedTestByIdPublic,
  listAttempts,
  listPublishedClassesPublic,
  listPublishedTestsPublic,
  listClasses,
  listTests,
} from "@/lib/persistence";

export type TestStats = {
  participantCount: number;
  average: number;
  highest: number;
  lowest: number;
};

export type AvailableTestCard = {
  test: InstantTest;
  classroom?: ClassRoom;
  enabledQuestionCount: number;
};

function sortTests(tests: InstantTest[]) {
  return [...tests].sort((left, right) => {
    const dateDiff = right.date.localeCompare(left.date);

    return dateDiff !== 0 ? dateDiff : left.title.localeCompare(right.title, "ja");
  });
}

function getEnabledQuestionCount(test: InstantTest) {
  return test.questions.filter((question) => question.enabled).length;
}

export function calculateTestStats(attempts: StudentAttempt[]): TestStats {
  const scores = attempts.map((entry) => entry.score);

  if (scores.length === 0) {
    return {
      participantCount: 0,
      average: 0,
      highest: 0,
      lowest: 0,
    };
  }

  const total = scores.reduce((sum, score) => sum + score, 0);

  return {
    participantCount: scores.length,
    average: Math.round(total / scores.length),
    highest: Math.max(...scores),
    lowest: Math.min(...scores),
  };
}

export async function getHomepageData() {
  const [classes, tests] = await Promise.all([
    listPublishedClassesPublic(),
    listPublishedTestsPublic(),
  ]);
  const publishedTests = sortTests(tests);
  const featuredTest = publishedTests[0] ?? sortTests(tests)[0] ?? null;
  const summary = featuredTest
    ? await getPublicTestStats(featuredTest.id)
    : calculateTestStats([]);

  return {
    classes,
    publishedTests,
    featuredTest,
    summary,
  };
}

export async function getTeacherDashboardData() {
  const [classes, tests, attempts] = await Promise.all([
    listClasses(),
    listTests(),
    listAttempts(),
  ]);
  const sortedTests = sortTests(tests);
  const featuredTest = sortedTests[0] ?? null;
  const featuredClass = featuredTest
    ? classes.find((entry) => entry.id === featuredTest.classId)
    : undefined;
  const stats = featuredTest
    ? calculateTestStats(attempts.filter((entry) => entry.testId === featuredTest.id))
    : calculateTestStats([]);

  return {
    classes,
    tests: sortedTests,
    featuredTest,
    featuredClass,
    stats,
  };
}

export async function getTeacherBuilderData(testId?: string) {
  const [classes, tests] = await Promise.all([listClasses(), listTests()]);
  const sortedTests = sortTests(tests);
  const draft =
    sortedTests.find((entry) => entry.id === testId) ??
    sortedTests[0] ??
    null;
  const classroom = draft
    ? classes.find((entry) => entry.id === draft.classId)
    : undefined;

  return {
    classes,
    draft,
    classroom,
  };
}

export async function getTeacherResultsData(testId?: string) {
  const [classes, tests, attempts] = await Promise.all([
    listClasses(),
    listTests(),
    listAttempts(),
  ]);
  const sortedTests = sortTests(tests);
  const test =
    sortedTests.find((entry) => entry.id === testId) ??
    sortedTests[0] ??
    null;
  const classroom = test
    ? classes.find((entry) => entry.id === test.classId)
    : undefined;
  const filteredAttempts = test
    ? attempts.filter((entry) => entry.testId === test.id)
    : [];
  const stats = calculateTestStats(filteredAttempts);

  return {
    tests: sortedTests,
    test,
    classroom,
    attempts: filteredAttempts,
    stats,
  };
}

export async function getStudentLandingData() {
  const [classes, tests] = await Promise.all([
    listPublishedClassesPublic(),
    listPublishedTestsPublic(),
  ]);
  const availableTests: AvailableTestCard[] = sortTests(tests)
    .map((test) => ({
      test,
      classroom: classes.find((entry) => entry.id === test.classId),
      enabledQuestionCount: getEnabledQuestionCount(test),
    }));

  return {
    classes,
    availableTests,
    primaryClass: classes[0],
  };
}

export async function getStudentSessionData(options?: {
  testId?: string;
  classCode?: string;
}) {
  const [classes, tests, requestedTest] = await Promise.all([
    listPublishedClassesPublic(),
    listPublishedTestsPublic(),
    options?.testId ? getPublishedTestByIdPublic(options.testId) : Promise.resolve(undefined),
  ]);
  const publishedTests = sortTests(tests);
  const test = requestedTest ?? publishedTests[0] ?? null;
  const codeMatch = options?.classCode
    ? await getClassByCodePublic(options.classCode)
    : undefined;
  const classroom =
    codeMatch ??
    (test ? classes.find((entry) => entry.id === test.classId) : undefined);

  return {
    test,
    classroom,
  };
}