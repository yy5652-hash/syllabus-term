// Mirrors web/src/core/core.test.ts so both platforms behave identically.
import Testing
@testable import TermCore

let SYL = """
ECON-UA 2 Principles of Macroeconomics — Fall 2026
Office hours: Tuesdays 2-4pm

Grading
Problem sets 25%
Midterm exam 30%
Final exam 30 percent
Participation 15%

Schedule
Sept 3: first class
Problem set 1 due Sept. 17
Midterm exam: Thursday, October 15th
10/29 Problem set 2 due
Final exam December 17
"""

let good = GradingResult(components: [
  .init(name: "Problem sets", weight: 25, kind: "assignment"), .init(name: "Midterm exam", weight: 30, kind: "exam"),
  .init(name: "Final exam", weight: 30, kind: "exam"), .init(name: "Participation", weight: 15, kind: "participation"),
])

@Test func weightsInText() {
  #expect(weightGrounded(25, SYL)); #expect(weightGrounded(30, SYL))
  #expect(!weightGrounded(20, SYL)); #expect(!weightGrounded(5, SYL)) // "25%" must not match 5
}

@Test func datesInText() {
  for d in ["2026-09-17", "2026-10-15", "2026-10-29", "2026-12-17"] { #expect(dateGrounded(d, SYL), "\(d)") }
  #expect(!dateGrounded("2026-12-07", SYL)); #expect(!dateGrounded("2026-02-30", SYL))
}

@Test func gradingChecks() {
  #expect(checkGrading(good, source: SYL).ok)
  let bad = GradingResult(components: Array(good.components.prefix(3)) + [.init(name: "Quizzes", weight: 20, kind: "quiz")])
  let codes = Set(checkGrading(bad, source: SYL).issues.map(\.code))
  #expect(codes.isSuperset(of: ["sum", "name-not-in-text", "weight-not-in-text"]))
  #expect(!checkGrading(nil, source: SYL).ok)
}

@Test func scheduleChecks() {
  let r = ScheduleResult(items: [.init(label: "Midterm exam", date: "2026-10-15", kind: "exam"),
    .init(label: "Final exam", date: "2027-12-17", kind: "exam"), .init(label: "Quiz", date: "2026-11-05", kind: "quiz")])
  let rep = checkSchedule(r, source: SYL, term: Term(start: "2026-09-01", end: "2026-12-23"))
  #expect(!rep.ok)
  #expect(Set(rep.issues.map(\.code)).isSuperset(of: ["outside-term", "date-not-in-text"]))
}

@Test func slicing() {
  #expect(sliceSection(SYL, .grading).contains("Midterm exam 30%"))
  #expect(!sliceSection(SYL, .grading).contains("December 17"))
  #expect(sliceSection(SYL, .schedule).contains("October 15th"))
  let g = sliceSection("| Assignments\n\n| Percentages\n\n| Quiz 1\n\n| 20%\n\n| Final Exam\n\n| 35%\n", .grading)
  #expect(g.contains("Quiz 1") && g.contains("Final Exam"))
}

actor Calls { var log: [String] = []; func add(_ s: String) { log.append(s) } }
struct Boom: Error, CustomStringConvertible { let description: String }

func options(_ calls: Calls, deviceG: GradingResult?, deviceS: ScheduleResult?, cloudG: GradingResult? = good,
             cloudFails: Bool = false, escalate: Bool = true) -> RouterOptions<GradingResult, ScheduleResult> {
  RouterOptions(
    deviceGrading: { _ in await calls.add("device"); return (deviceG, .onDevice) },
    cloudGrading: { p in await calls.add("cloud"); if cloudFails { throw Boom(description: "429 quota") }
      #expect(p.contains("not 100%")); return (cloudG, .inCloud) },
    deviceSchedule: { _ in await calls.add("device"); return (deviceS, .onDevice) },
    cloudSchedule: { _ in await calls.add("cloud"); throw Boom(description: "should not be called") },
    escalate: escalate)
}

@Test func escalatesOnlyFailingSection() async throws {
  let calls = Calls()
  let plan = try await extractTermPlan(SYL, year: 2026, options(calls,
    deviceG: GradingResult(components: [.init(name: "Midterm exam", weight: 30, kind: "exam")]),
    deviceS: ScheduleResult(items: [.init(label: "Final exam", date: "2026-12-17", kind: "exam")])))
  #expect(await calls.log == ["device", "cloud", "device"])
  #expect(plan.grading.escalated && plan.grading.finalReport.ok && !plan.schedule.escalated)
  #expect(plan.schedule.charsSentToCloud == 0 && plan.grading.charsSentToCloud < SYL.count)
}

@Test func repairsInventedDatesOnDevice() async throws {
  let calls = Calls()
  let plan = try await extractTermPlan(SYL, year: 2026, options(calls, deviceG: good,
    deviceS: ScheduleResult(items: [.init(label: "Final exam", date: "2026-12-17", kind: "exam"), .init(label: "quizzes", date: "2026-11-05", kind: "quiz")])))
  #expect(await calls.log == ["device", "device"])
  #expect(plan.schedule.repairedItems == 1 && plan.schedule.finalReport.ok)
  #expect(plan.schedule.value?.items.map(\.date) == ["2026-12-17"])
}

@Test func keepsDeviceAnswerWhenCloudFails() async throws {
  let plan = try await extractTermPlan(SYL, year: 2026, options(Calls(),
    deviceG: GradingResult(components: [.init(name: "Midterm exam", weight: 30, kind: "exam")]), deviceS: ScheduleResult(items: []), cloudFails: true))
  #expect(plan.grading.escalated && plan.grading.finalSource == .onDevice && !plan.grading.finalReport.ok)
  #expect(plan.grading.escalationError?.contains("429") == true)
}

@Test func killSwitchKeepsFailedSectionOnDevice() async throws {
  let calls = Calls()
  let plan = try await extractTermPlan(SYL, year: 2026, options(calls,
    deviceG: GradingResult(components: [.init(name: "Midterm exam", weight: 30, kind: "exam")]), deviceS: ScheduleResult(items: []), escalate: false))
  #expect(await calls.log == ["device", "device"])
  #expect(!plan.grading.finalReport.ok && plan.grading.charsSentToCloud == 0)
}
