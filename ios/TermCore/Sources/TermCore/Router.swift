// Verify-then-escalate (port of web/src/core/router.ts): every section is first
// answered on device; the answer is checked; only a section that fails its checks
// is sent to the cloud model, with the failed checks as hints.
import Foundation

public enum Source: String, Sendable { case onDevice = "on_device", inCloud = "in_cloud" }
public enum Section: String, Sendable { case grading, schedule }

/// A model call returning a typed answer, or nil when the model could not produce one.
public typealias Runner<T> = @Sendable (_ prompt: String) async throws -> (value: T?, source: Source)

public struct SectionOutcome<T: Sendable>: Sendable {
  public var section: Section
  public var value: T?
  public var firstSource: Source
  public var finalSource: Source
  public var escalated = false
  public var firstReport: CheckReport
  public var finalReport: CheckReport
  public var charsSentToCloud = 0
  public var seconds = 0.0
  /// Set when escalation was needed but the cloud call failed.
  public var escalationError: String?
  /// Items removed on device because they failed item-level checks.
  public var repairedItems = 0
}

private let dateRE = #"(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b"#
private let weightRE = #"(?i)\d\s*(%|percent)"#

/// The lines a section needs plus the nearest non-blank line on each side. Blank lines are skipped
/// so a table exported one cell per line keeps the name next to its weight.
public func sliceSection(_ text: String, _ section: Section) -> String {
  let lines = text.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
  let re = section == .grading ? weightRE : dateRE
  var keep = Set<Int>()
  for (i, l) in lines.enumerated() where matches(re, l) {
    for j in (i - 1)...(i + 1) where j >= 0 && j < lines.count { keep.insert(j) }
  }
  return keep.sorted().map { lines[$0] }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
}

private func withHints(_ base: [String], _ hints: [String], _ section: String) -> String {
  (base + (hints.isEmpty ? [] : ["A previous answer failed these checks; fix them:"] + hints.map { "- \($0)" })
    + ["", "Syllabus excerpt:", section]).joined(separator: "\n")
}

public func gradingPrompt(_ section: String, hints: [String] = []) -> String {
  withHints([
    "Extract the grading breakdown from this course syllabus excerpt.",
    "Return every graded component with its weight as a percent of the final grade (numbers only, e.g. 30 for 30%).",
    "Use only components and numbers written in the text. Do not invent components.",
  ], hints, section)
}

public func schedulePrompt(_ section: String, year: Int, hints: [String] = []) -> String {
  withHints([
    "List every graded event with a date in this course syllabus excerpt: exams, quizzes, and due dates of assignments, problem sets, papers and projects.",
    "Do not list lectures, class topics, readings, holidays, breaks, office hours or add/drop deadlines.",
    "Write dates as YYYY-MM-DD. If the year is not written, the year is \(year).",
    "Use only dates written in the text.",
  ], hints, section)
}

public struct RouterOptions<G: Sendable, S: Sendable>: Sendable {
  public var deviceGrading: Runner<G>, cloudGrading: Runner<G>
  public var deviceSchedule: Runner<S>, cloudSchedule: Runner<S>
  public var escalate = true
  public var term: Term?
  public init(deviceGrading: @escaping Runner<G>, cloudGrading: @escaping Runner<G>, deviceSchedule: @escaping Runner<S>,
              cloudSchedule: @escaping Runner<S>, escalate: Bool = true, term: Term? = nil) {
    self.deviceGrading = deviceGrading; self.cloudGrading = cloudGrading
    self.deviceSchedule = deviceSchedule; self.cloudSchedule = cloudSchedule
    self.escalate = escalate; self.term = term
  }
}

func runSection<T: Sendable>(
  _ section: Section, slice: String, prompt: (_ hints: [String]) -> String,
  device: Runner<T>, cloud: Runner<T>, escalate: Bool,
  check: (T?) -> CheckReport, repair: ((T?) -> (value: T?, removed: Int))? = nil
) async throws -> SectionOutcome<T> {
  let t0 = Date()
  var first: (value: T?, source: Source)
  do { first = try await device(prompt([])) } catch {
    // On-device failure: treat as a failed answer so escalation can still produce a result.
    if !escalate { throw error }
    first = (nil, .onDevice)
  }
  let firstReport = check(first.value)
  var out = SectionOutcome(section: section, value: first.value, firstSource: first.source, finalSource: first.source,
                           firstReport: firstReport, finalReport: firstReport,
                           charsSentToCloud: first.source == .inCloud ? slice.count : 0)
  // Repair before escalating: an item whose date is not in the text cannot be fixed by a
  // bigger model reading the same text, so it is removed on device.
  if !firstReport.ok, let repair {
    let r = repair(first.value)
    if r.removed > 0 {
      let rep = check(r.value)
      if rep.ok { out.value = r.value; out.finalReport = rep; out.repairedItems = r.removed }
    }
  }
  if !out.finalReport.ok && first.source == .onDevice && escalate {
    let hints = firstReport.issues.filter { $0.severity == .fail }.map(\.message)
    do {
      let second = try await cloud(prompt(hints))
      out.value = second.value; out.finalSource = second.source; out.escalated = true
      out.finalReport = check(second.value); out.charsSentToCloud = slice.count
    } catch {
      // Cloud unavailable: keep the on-device answer, flagged by its failed checks.
      out.escalated = true; out.escalationError = String(String(describing: error).prefix(200))
    }
  }
  out.seconds = Date().timeIntervalSince(t0)
  return out
}

public struct TermPlan: Sendable {
  public var grading: SectionOutcome<GradingResult>
  public var schedule: SectionOutcome<ScheduleResult>
  public var sourceChars: Int
}

public func extractTermPlan(_ text: String, year: Int, _ opts: RouterOptions<GradingResult, ScheduleResult>) async throws -> TermPlan {
  let g = sliceSection(text, .grading), s = sliceSection(text, .schedule)
  let grading = try await runSection(.grading, slice: g, prompt: { gradingPrompt(g, hints: $0) },
    device: opts.deviceGrading, cloud: opts.cloudGrading, escalate: opts.escalate, check: { checkGrading($0, source: g) })
  let term = opts.term
  let schedule = try await runSection(.schedule, slice: s, prompt: { schedulePrompt(s, year: year, hints: $0) },
    device: opts.deviceSchedule, cloud: opts.cloudSchedule, escalate: opts.escalate,
    check: { checkSchedule($0, source: s, term: term) },
    repair: { v in
      guard let v else { return (nil, 0) }
      let items = v.items.filter { checkSchedule(ScheduleResult(items: [$0]), source: s, term: term).ok }
      return (ScheduleResult(items: items), v.items.count - items.count)
    })
  return TermPlan(grading: grading, schedule: schedule, sourceChars: text.count)
}
