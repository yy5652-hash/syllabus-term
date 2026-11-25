// Mirrors web/src/core/checks-v2.test.ts.
import Testing
@testable import TermCore

private func component(_ name: String, _ weight: Double) -> GradingComponent {
  GradingComponent(name: name, weight: weight, kind: "other")
}

private func event(_ label: String, _ date: String, _ kind: String = "exam") -> DatedItem {
  DatedItem(label: label, date: date, kind: kind)
}

private func failCodes(_ report: CheckReport) -> [String] {
  report.issues.filter { $0.severity == .fail }.map(\.code)
}

private func grading(_ components: GradingComponent...) -> GradingResult {
  GradingResult(components: components)
}

private func schedule(_ items: DatedItem...) -> ScheduleResult {
  ScheduleResult(items: items)
}

@Suite struct ChecksV2Tests {
  private let examRows = "Midterm October 2\nFinal December 1"

  @Test func evidenceKeepsBoundSourceLinesAndSkipsAdjacentDates() throws {
    let survey = component("Survey", 3)
    let gradingRows = "Final 100%\nSurvey\n\n3% extra credit"
    #expect(evidenceFor(survey, source: gradingRows) == "Survey\n3% extra credit")
    #expect(survey.bonus == nil)
    #expect(evidenceFor(component("Final", 3), source: gradingRows) == nil)
    let winter = try #require(inferTerm("2025 Winter"))
    let scheduleRows = "Midterm December 17\nExam 1\nJan 4"
    #expect(evidenceFor(event("Exam 1", "2026-01-04"), source: scheduleRows, term: winter) == "Exam 1\nJan 4")
    #expect(evidenceFor(event("Exam 2", "2026-01-04"), source: scheduleRows, term: winter) == nil)
    #expect(evidenceFor(event("Exam 1", "2025-01-04"), source: scheduleRows, term: winter) == nil)
  }

  @Test func dateOffsetsAndWrittenYears() throws {
    let spring = try #require(inferTerm("Spring Semester 2026"))
    for raw in ["September 17", "Sept. 17th", "Sep 17", "17 September", "17th of September",
                "Wed, Sep 17", "Wednesday September 17th", "9/17"] {
      #expect(findDates("On \(raw).", defaultYear: 2026) ==
              [DateMatch(iso: "2026-09-17", explicitYear: false, index: 3, raw: raw)])
    }
    for raw in ["September 17th, 2025", "17th of September 2025", "9/17/25", "9/17/2025",
                "9-17-2025", "09-17-25", "2025-09-17"] {
      #expect(findDates(raw, defaultYear: 2026, term: spring) ==
              [DateMatch(iso: "2025-09-17", explicitYear: true, index: 0, raw: raw)])
    }
    #expect(findDates("📅 Sep 17", defaultYear: 2026).first?.index == 3)
  }

  @Test func slicingAndGroundingUseTheSameDateParser() {
    for (line, iso) in [("Exam 1 September 17th", "2025-09-17"), ("Midterm on 8-21-2025", "2025-08-21")] {
      #expect(sliceSection("Syllabus\nLectures\n\(line)", .schedule).contains(line))
      #expect(dateGrounded(iso, line))
    }
    for invalid in ["17/9/2025", "31-10-2025", "2025-02-29", "4/31", "chapters 2-4"] {
      #expect(!lineHasDate(invalid))
    }
  }

  @Test func firstSeasonOrMostFrequentYearOnDatedLines() throws {
    #expect(inferTerm("Autumn Quarter 2025, then 2026 Spring") ==
            Term(label: "Fall 2025", start: "2025-08-15", end: "2025-12-31"))
    #expect(inferTerm("sometime in 2025") == nil)
    #expect(inferYear("2024 2024 2024\nOct 5 2025\n9/17/2025\n10/14/2026") == 2025)
    #expect(inferYear("Copyright 2026\nFall") == nil)
    let winter = try #require(inferTerm("2025 Winter"))
    #expect(winter.end == "2026-02-28")
    #expect(findDates("Dec 18 and Jan 4 and Jan 5, 2025", defaultYear: 2025, term: winter).map(\.iso) ==
            ["2025-12-18", "2026-01-04", "2025-01-05"])
  }

  @Test func northwesternMidtermCannotBorrowFinalWeight() {
    // Relevant rows from eval/cases/nu-econ201-f2025.txt, kept here for standalone SwiftPM tests.
    let excerpt = """
    Thurs Dec. 11  Cumulative Final Exam - Noon-2 - Tech Aud  (45% of class grade)

    Grading  Share of
       Class Grade
    First Midterm (in class)  15%
    Second Midterm (in class)  30%
    Final exam  45%
    Canvas Homework  10%
    """
    let codes = failCodes(checkGrading(grading(component("Midterm II", 45)), source: sliceSection(excerpt, .grading)))
    #expect(codes.contains("weight-not-bound"))
    #expect(!codes.contains("weight-not-in-text"))
  }

  @Test func adjacentCompleteGradingRowsRejectSwappedWeights() {
    let result = grading(component("Final", 70), component("Homework", 30))
    #expect(failCodes(checkGrading(result, source: "Final 30%\nHomework 70%")) == ["weight-not-bound", "weight-not-bound"])
  }

  @Test func gradesBindAcrossSplitCellsAndEquivalentOrdinals() {
    #expect(checkGrading(grading(component("Midterm II", 100)), source: "Second midterm\n\n100 percent").status == .checked)
    #expect(failCodes(checkGrading(grading(component("Exam 1", 100)), source: "Second exam 100%")).contains("weight-not-bound"))
  }

  @Test func additionalPercentagePointsAreExcludedFromOrdinaryTotal() {
    var result: GradingResult? = grading(component("Homework", 70), component("Final", 30), component("Extra credit", 3))
    let excerpt = sliceSection("Homework 70%\nFinal 30%\nExtra credit: up to 3 additional percentage points", .grading)
    #expect(checkGrading(&result, source: excerpt).status == .checked)
    #expect(result?.components.map { $0.bonus == true } == [false, false, true])
  }

  @Test func bonusHeadingOrContinuationBindsToItsOwnWeight() {
    for source in ["Final 100%\nExtra credit\nSurvey 3%", "Final 100%\nSurvey 3%\nadded to your final grade"] {
      var result: GradingResult? = grading(component("Final", 100), component("Survey", 3))
      #expect(checkGrading(&result, source: source).status == .checked)
      #expect(result?.components.map { $0.bonus == true } == [false, true])
    }
  }

  @Test func adjacentCompleteScheduleRowsRejectSwappedDates() {
    let result = schedule(event("Final", "2025-10-02"), event("Midterm", "2025-12-01"))
    #expect(failCodes(checkSchedule(result, source: examRows)) == ["date-not-bound", "date-not-bound"])
  }

  @Test func aNamedDeadlineCannotBindToADifferentAssessment() {
    let rows = "Paper due October 2\nProject due December 1"
    let swapped = schedule(event("Project due", "2025-10-02", "deadline"), event("Paper due", "2025-12-01", "deadline"))
    #expect(failCodes(checkSchedule(swapped, source: rows)) == ["date-not-bound", "date-not-bound"])
    #expect(checkSchedule(schedule(event("Submission", "2025-10-02", "deadline")), source: rows).status == .checked)
  }

  @Test func coverageDistinguishesMissingDatesFromUndatedExams() {
    #expect(failCodes(checkSchedule(schedule(), source: examRows)).contains("missing-dates"))
    let review = checkSchedule(schedule(), source: "", fullText: "Two midterms and a final")
    #expect(review.status == .review)
    #expect(review.issues.map(\.code) == ["no-dates"])
    #expect(checkSchedule(schedule(), source: "October 2: first lecture").status == .checked)
  }

  @Test func outsideTermDateSurvivesRepairAndChangedYearIsRemoved() async throws {
    let spring = try #require(inferTerm("Spring Semester 2026"))
    let valid = event("Quiz", "2025-03-10", "quiz")
    let wrong = event("Quiz", "2026-03-10", "quiz")
    let plan = try await extractTermPlan("Final 100%\nQuiz March 10, 2025", year: 2025, RouterOptions(
      deviceGrading: { _ in (grading(component("Final", 100)), .onDevice) },
      cloudGrading: { _ in throw Boom(description: "unexpected cloud call") },
      deviceSchedule: { _ in (schedule(valid, wrong), .onDevice) },
      cloudSchedule: { _ in throw Boom(description: "unexpected cloud call") },
      term: spring))
    #expect(plan.schedule.value?.items == [valid])
    #expect(plan.schedule.removed == [RemovedItem(item: wrong, reason: "year-mismatch")])
    #expect(!plan.schedule.escalated && plan.schedule.repairedItems == 1 && plan.schedule.finalSource == .onDevice)
    #expect(plan.schedule.finalReport.status == .review)
    #expect(plan.schedule.finalReport.issues.map(\.code) == ["outside-term"])
    #expect(plan.schedule.finalReport.issues.map(\.severity) == [.review])
  }

  @Test func confirmedCrossYearTermIsUsedForPromptsAndChecks() async throws {
    let winter = try #require(inferTerm("2025 Winter"))
    let prompts = Calls()
    let dates: Runner<ScheduleResult> = { prompt in
      await prompts.add(prompt)
      return (schedule(event("Exam", "2026-01-04")), .onDevice)
    }
    let grades: Runner<GradingResult> = { _ in (grading(component("Final", 100)), .onDevice) }
    let plan = try await extractTermPlan("Final 100%\nExam Jan 4", year: 2030, RouterOptions(
      deviceGrading: grades, cloudGrading: grades, deviceSchedule: dates, cloudSchedule: dates, term: winter))
    let prompt = try #require(await prompts.log.first)
    #expect(prompt.contains("2025-12-15 to 2026-02-28"))
    #expect(plan.schedule.finalReport.status == .checked)
  }

  @Test func hybridFailureHasUnknownSourceAndFailedCloudDispatchCounts() async throws {
    let plan = try await extractTermPlan(examRows, year: 2025, RouterOptions(
      deviceGrading: { _ in throw Boom(description: "hybrid failed") },
      cloudGrading: { _ in throw Boom(description: "quota") },
      deviceSchedule: { _ in throw Boom(description: "hybrid failed") },
      cloudSchedule: { _ in throw Boom(description: "quota") }))
    #expect(plan.schedule.firstSource == .unknown && plan.schedule.finalSource == .unknown)
    #expect(plan.schedule.escalated && plan.schedule.charsSentToCloud == examRows.utf16.count)
    #expect(plan.schedule.escalationError == "quota")
  }

  @Test func repairedCloudAnswerKeepsCloudProvenance() async throws {
    let invented = event("Quiz", "2025-11-10", "quiz")
    let plan = try await extractTermPlan(examRows, year: 2025, RouterOptions(
      deviceGrading: { _ in (nil, .onDevice) },
      cloudGrading: { _ in (nil, .inCloud) },
      deviceSchedule: { _ in (nil, .onDevice) },
      cloudSchedule: { _ in (schedule(event("Midterm", "2025-10-02"), invented), .inCloud) }))
    #expect(plan.schedule.finalSource == .inCloud && plan.schedule.escalated)
    #expect(plan.schedule.repairedItems == 1)
    #expect(plan.schedule.removed == [RemovedItem(item: invented, reason: "date-not-in-text")])
    #expect(plan.schedule.finalReport.status == .checked)
  }

  @Test func failedCloudFirstDispatchCountsWithoutRetry() async throws {
    let calls = Calls()
    let plan = try await extractTermPlan(examRows, year: 2025, RouterOptions(
      deviceGrading: { _ in await calls.add("device grading"); return (nil, .onDevice) },
      cloudGrading: { _ in await calls.add("cloud grading"); throw Boom(description: "timeout") },
      deviceSchedule: { _ in await calls.add("device schedule"); return (nil, .onDevice) },
      cloudSchedule: { _ in await calls.add("cloud schedule"); throw Boom(description: "timeout") },
      cloudFirst: true))
    #expect(await calls.log == ["cloud grading", "cloud schedule"])
    #expect(plan.schedule.firstSource == .unknown && plan.schedule.finalSource == .unknown)
    #expect(!plan.schedule.escalated && plan.schedule.charsSentToCloud == examRows.utf16.count)
    #expect(plan.schedule.finalReport.status == .failed)
  }

  @Test func routerRetainsInferredBonusAndUsesSyllabusYearWithoutATerm() async throws {
    let plan = try await extractTermPlan("Final 100%\nSurvey 3% extra credit\nPaper due Nov 5, 2025\nFinal Dec 1", year: 2030, RouterOptions(
      deviceGrading: { _ in (grading(component("Final", 100), component("Survey", 3)), .onDevice) },
      cloudGrading: { _ in throw Boom(description: "unexpected cloud call") },
      deviceSchedule: { prompt in
        #expect(prompt.contains("the year is 2025"))
        return (schedule(event("Final", "2025-12-01")), .onDevice)
      },
      cloudSchedule: { _ in throw Boom(description: "unexpected cloud call") }))
    #expect(plan.grading.value?.components.map { $0.bonus == true } == [false, true])
    #expect(plan.grading.finalReport.status == .checked)
    #expect(plan.schedule.finalReport.status == .checked)
  }
}
