// Verify each section's first answer, then escalate failed device answers
// with the failed checks as hints (port of web/src/core/router.ts).
import Foundation

public enum Source: String, Sendable { case onDevice = "on_device", inCloud = "in_cloud", unknown }
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
  /// Items removed locally from the retained answer and their failure codes.
  public var removed: [RemovedItem] = []
  var splitGroups = 0
  public var repairedItems: Int { removed.count + splitGroups }
}

/// The lines a section needs plus the nearest non-blank line on each side. Blank lines are skipped
/// so a table exported one cell per line keeps the name next to its weight.
public func sliceSection(_ text: String, _ section: Section) -> String {
  let lines = syllabusLines(text)
  let anchors = section == .grading ? GradingRows(text).anchors : lines.map(lineHasDate)
  var keep = Set<Int>()
  for i in lines.indices where anchors[i] {
    for j in (i - 1)...(i + 1) where lines.indices.contains(j) { keep.insert(j) }
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
    gradingUsesPoints(section) ? "Return each graded component with its points and the course totalPoints if written. Omit weight." :
    "Return every graded component with its weight as a percent of the final grade (numbers only, e.g. 30 for 30%).",
    "List each separately weighted item. If a group is split into parts with their own percentages, or says 'N% each', list the parts (e.g. Midterm 30%, Final 40%; Test 1 15%, Test 2 15%, Test 3 15%), not the group.",
    "Mark extra credit added on top of 100% with bonus: true.",
    "Use only components and numbers written in the text. Do not invent components.",
  ], hints, section)
}

public func schedulePrompt(_ section: String, year: Int, hints: [String] = [], term: Term? = nil) -> String {
  let dateInstruction: String
  if let term, term.start.prefix(4) != term.end.prefix(4) {
    dateInstruction = "Write dates as YYYY-MM-DD. For dates without a year, use the year inside the term \(term.start) to \(term.end) where possible. Otherwise use \(year)."
  } else {
    dateInstruction = "Write dates as YYYY-MM-DD. If the year is not written, the year is \(year)."
  }
  return withHints([
    "List every graded event with a date in this course syllabus excerpt: exams, quizzes, and due dates of assignments, problem sets, papers and projects.",
    "Do not list lectures, class topics, readings, holidays, breaks, office hours or add/drop deadlines.",
    dateInstruction,
    "Use only dates written in the text.",
  ], hints, section)
}

public struct RouterOptions<G: Sendable, S: Sendable>: Sendable {
  public var deviceGrading: Runner<G>, cloudGrading: Runner<G>
  public var deviceSchedule: Runner<S>, cloudSchedule: Runner<S>
  public var escalate: Bool
  public var term: Term?
  /// The device model is unavailable, so first dispatches use the cloud runners.
  public var cloudFirst: Bool
  public init(deviceGrading: @escaping Runner<G>, cloudGrading: @escaping Runner<G>, deviceSchedule: @escaping Runner<S>,
              cloudSchedule: @escaping Runner<S>, escalate: Bool = true, term: Term? = nil, cloudFirst: Bool = false) {
    self.deviceGrading = deviceGrading; self.cloudGrading = cloudGrading
    self.deviceSchedule = deviceSchedule; self.cloudSchedule = cloudSchedule
    self.escalate = escalate; self.term = term; self.cloudFirst = cloudFirst
  }
}

private func runSection<T: Sendable>(
  _ section: Section, slice: String, prompt: (_ hints: [String]) -> String,
  device: Runner<T>, cloud: Runner<T>, escalate: Bool, cloudFirst: Bool,
  check: (inout T?) -> CheckReport, repair: ((T) -> (value: T, removed: [RemovedItem], splitGroups: Int))? = nil
) async -> SectionOutcome<T> {
  let start = ContinuousClock.now
  let firstRunner = cloudFirst ? cloud : device
  let first = (try? await firstRunner(prompt([]))) ?? (value: nil, source: .unknown)
  let dispatchedToCloud = cloudFirst || first.source == .inCloud
  let charCount = slice.utf16.count

  func evaluate(_ answer: T?) -> (value: T?, initial: CheckReport, final: CheckReport, removed: [RemovedItem], splitGroups: Int) {
    var value = answer
    let initial = check(&value)
    if initial.status == .failed, let repair, let answer = value {
      let repaired = repair(answer)
      value = repaired.value
      let final = repaired.removed.isEmpty && repaired.splitGroups == 0 ? initial : check(&value)
      return (value, initial, final, repaired.removed, repaired.splitGroups)
    }
    return (value, initial, initial, [], 0)
  }

  let firstResult = evaluate(first.value)
  var out = SectionOutcome(section: section, value: firstResult.value, firstSource: first.source, finalSource: first.source,
                           firstReport: firstResult.initial, finalReport: firstResult.final,
                           charsSentToCloud: dispatchedToCloud ? charCount : 0, removed: firstResult.removed, splitGroups: firstResult.splitGroups)
  if out.finalReport.status == .failed && !dispatchedToCloud && escalate {
    let hints = out.finalReport.issues.filter { $0.severity == .fail }.map(\.message)
    out.escalated = true
    out.charsSentToCloud += charCount
    do {
      let second = try await cloud(prompt(hints))
      let result = evaluate(second.value)
      out.value = result.value
      out.finalSource = .inCloud
      out.finalReport = result.final
      out.removed = result.removed
      out.splitGroups = result.splitGroups
    } catch {
      out.escalationError = String(String(describing: error).prefix(200))
    }
  }
  let duration = start.duration(to: .now).components
  out.seconds = Double(duration.seconds) + Double(duration.attoseconds) / 1e18
  return out
}

public struct TermPlan: Sendable {
  public var grading: SectionOutcome<GradingResult>
  public var schedule: SectionOutcome<ScheduleResult>
  public var sourceChars: Int
}

public func extractTermPlan(_ text: String, year: Int, _ opts: RouterOptions<GradingResult, ScheduleResult>) async throws -> TermPlan {
  let g = sliceSection(text, .grading), s = sliceSection(text, .schedule)
  let term = opts.term
  let scheduleYear = (term ?? inferTerm(text)).flatMap { Int($0.start.prefix(4)) } ?? inferYear(text) ?? year
  func checkDates(_ result: ScheduleResult?) -> CheckReport {
    checkSchedule(result, source: s, term: term, fullText: text, defaultYear: scheduleYear)
  }
  let grading = await runSection(.grading, slice: g, prompt: { gradingPrompt(g, hints: $0) },
    device: opts.deviceGrading, cloud: opts.cloudGrading, escalate: opts.escalate, cloudFirst: opts.cloudFirst,
    check: { value in checkGrading(&value, source: g) }, repair: { result in
      let grading = GradingRows(g)
      var count = 0
      let rows = grading.evidence
      var repaired = result
      repaired.components = result.components.flatMap { component -> [GradingComponent] in
        guard let parts = groupParts(component, rows, pointMode: grading.pointMode), !parts.isEmpty else { return [component] }
        count += 1
        return parts.map { part in
          var split = component
          split.name = part.name
          if grading.pointMode { split.points = part.value } else { split.weight = part.value }
          return split
        }
      }
      return (repaired, [], count)
    })
  let schedule = await runSection(.schedule, slice: s, prompt: { schedulePrompt(s, year: scheduleYear, hints: $0, term: term) },
    device: opts.deviceSchedule, cloud: opts.cloudSchedule, escalate: opts.escalate, cloudFirst: opts.cloudFirst,
    check: { checkDates($0) },
    repair: { value in
      var removed: [RemovedItem] = []
      let items = value.items.filter { item in
        let codes = Set(checkDates(ScheduleResult(items: [item])).issues.map(\.code))
        guard let reason = ["date-format", "year-mismatch", "date-not-in-text", "date-not-bound"].first(where: codes.contains)
        else { return true }
        removed.append(RemovedItem(item: item, reason: reason))
        return false
      }
      return (ScheduleResult(items: items), removed, 0)
    })
  return TermPlan(grading: grading, schedule: schedule, sourceChars: text.utf16.count)
}
