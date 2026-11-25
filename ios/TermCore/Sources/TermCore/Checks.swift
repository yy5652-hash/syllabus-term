// Deterministic checks run on every model answer (port of web/src/core/checks.ts).
import Foundation

public let SUM_TOLERANCE = 0.5

public enum Severity: String, Sendable { case fail, warn, review }
public enum CheckStatus: String, Sendable { case checked, review, failed }

public struct Issue: Equatable, Sendable {
  public var code: String
  public var severity: Severity
  public var message: String
}

public struct CheckReport: Equatable, Sendable {
  public var issues: [Issue]
  public var ok: Bool { status != .failed }
  public var status: CheckStatus {
    if issues.contains(where: { $0.severity == .fail }) { return .failed }
    return issues.contains(where: { $0.severity == .review }) ? .review : .checked
  }
}

// Adjacent rows with their own value are independent. Borrow only neighbours
// without a date or weight, such as the name cell above a standalone value.
private func context(_ lines: [String], at index: Int, anchors: [Bool],
                     includeNext: Bool = true, separator: String = " ") -> String {
  ((index - 1)...(includeNext ? index + 1 : index))
    .filter { lines.indices.contains($0) && ($0 == index || !anchors[$0]) }
    .map { lines[$0] }.joined(separator: separator)
}

private func weightText(_ weight: Double) -> String {
  if let integer = Int(exactly: weight) { return String(integer) }
  return String(weight)
}

public func checkGrading(_ result: GradingResult?, source: String) -> CheckReport {
  var result = result
  return checkGrading(&result, source: source)
}

/// Checks the answer and records deterministically grounded extra credit on it.
public func checkGrading(_ result: inout GradingResult?, source: String) -> CheckReport {
  guard var components = result?.components else {
    return CheckReport(issues: [Issue(code: "json", severity: .fail, message: "Answer was not valid JSON for the grading schema.")])
  }
  var issues: [Issue] = []
  if components.isEmpty {
    issues.append(Issue(code: "empty", severity: .fail, message: "No grading components found."))
  }
  let grading = GradingRows(source)
  let rows = grading.evidence
  if grading.pointMode {
    for i in components.indices {
      let c = components[i]
      if let points = c.points, rows.contains(where: { $0.bonus && $0.binds(c, points) }) { components[i].bonus = true }
    }
    let pointsSum = components.reduce(0.0) { $0 + ($1.bonus == true ? 0 : $1.points ?? 0) }
    let total = result?.totalPoints ?? pointsSum
    result?.totalPoints = total
    let written = rows.contains { row in row.entries.contains { $0.value == total && totalWord.hasMatch(in: $0.label) } }
    if !total.isFinite || total <= 0 || (!written && abs(total - pointsSum) > 1e-7) {
      issues.append(Issue(code: "total-points", severity: .fail, message: "Check the total points against the course total."))
    }
    for i in components.indices {
      let points = components[i].points ?? 0
      components[i].weight = points.isFinite && total > 0 ? (points / total * 10000).rounded() / 100 : 0
    }
  }
  let normalizedSource = norm(source)
  var seen: Set<String> = []
  for index in components.indices {
    let component = components[index]
    let key = norm(component.name).trimmingCharacters(in: .whitespaces)
    let weight = weightText(component.weight)
    if !seen.insert(key).inserted {
      issues.append(Issue(code: "duplicate", severity: .fail, message: "\"\(component.name)\" is listed twice."))
    }
    guard component.weight > 0 && component.weight <= 100 else {
      issues.append(Issue(code: "range", severity: .fail, message: "\"\(component.name)\" has weight \(weight), outside 0–100."))
      continue
    }
    let amount = grading.pointMode ? component.points ?? 0 : component.weight
    let unit = grading.pointMode ? " points" : "%"
    let bound = rows.filter { $0.binds(component, amount) }
    let group = groupParts(component, rows, pointMode: grading.pointMode) != nil
    if group { issues.append(Issue(code: "group-has-parts", severity: .fail, message: "Split '\(component.name)' into its parts")) }
    if !group && !rows.contains(where: { $0.entries.contains { $0.value == amount } }) {
      issues.append(Issue(code: "weight-not-in-text", severity: .fail,
                          message: "\(weightText(amount))\(unit) for \"\(component.name)\" does not appear in the syllabus."))
    }
    let words = significantWords(component.name)
    if bound.isEmpty && !words.isEmpty && !sharesWord(component.name, source) && !words.contains(where: { normalizedSource.contains($0) }) {
      issues.append(Issue(code: "name-not-in-text", severity: .fail, message: "\"\(component.name)\" is not mentioned in the syllabus."))
    }
    if bound.contains(where: \.bonus) { components[index].bonus = true }
    if bound.isEmpty && !group {
      issues.append(Issue(code: "weight-not-bound", severity: .fail, message: "Cannot link \"\(component.name)\" to \(weightText(amount))\(unit) in its grading row."))
    }
  }

  let sum = components.reduce(0.0) { sum, component in
    sum + (component.bonus == true || component.weight.isNaN ? 0 : component.weight)
  }
  if !components.isEmpty && abs(sum - 100) > SUM_TOLERANCE {
    let rounded = floor(sum * 10 + 0.5) / 10
    issues.append(Issue(code: "sum", severity: .fail, message: "Weights add up to \(weightText(rounded))%, not 100%."))
  }
  result?.components = components
  return CheckReport(issues: issues)
}

public func dateGrounded(_ iso: String, _ source: String, term: Term? = nil) -> Bool {
  guard isRealDate(iso), let year = Int(term?.start.prefix(4) ?? iso.prefix(4)) else { return false }
  return findDates(source, defaultYear: year, term: term).contains { $0.iso == iso }
}

private let examWord = syllabusRegex(#"\b(?:exams?|mid[ -]?terms?|finals?|quiz(?:zes)?)\b"#, options: .caseInsensitive)
private let datedAssessmentWord = syllabusRegex(#"\b(?:tests?|due|deadlines?)\b"#, options: .caseInsensitive)
private let kindWords = [
  "exam": #"\b(?:exams?|mid[ -]?terms?|finals?|tests?)\b"#,
  "quiz": #"\bquiz(?:zes)?\b"#,
  "deadline": #"\b(?:due|deadlines?|assignments?|homework|papers?|projects?|presentations?|reports?)\b"#,
].mapValues { syllabusRegex($0, options: .caseInsensitive) }

private func dateBound(_ item: DatedItem, context: String, dates: [DateMatch]) -> Bool {
  var evidence = context
  // Remove date digits before checking assessment ordinals such as Exam 1.
  for date in dates {
    if let range = evidence.range(of: date.raw, options: .literal) { evidence.replaceSubrange(range, with: " ") }
  }
  return (!hasOrdinal(evidence) || ordinalsMatch(item.label, evidence)) && !examConflict(item.label, evidence) &&
    !differentAssessments(item.label, evidence) &&
    (sharesWord(item.label, evidence) || kindWords[item.kind]?.hasMatch(in: evidence) == true)
}

public func checkSchedule(_ result: ScheduleResult?, source: String, term: Term? = nil,
                          fullText: String? = nil, defaultYear: Int? = nil) -> CheckReport {
  guard let result else {
    return CheckReport(issues: [Issue(code: "json", severity: .fail, message: "Answer was not valid JSON for the schedule schema.")])
  }
  var issues: [Issue] = []
  let lines = syllabusLines(source)
  let year = term.flatMap { Int($0.start.prefix(4)) } ?? defaultYear
  func datedLines(_ year: Int) -> [[DateMatch]] { lines.map { findDates($0, defaultYear: year, term: term) } }
  let dates = datedLines(year ?? 2000)
  if result.items.isEmpty && lines.indices.contains(where: { i in
    !dates[i].isEmpty && (examWord.hasMatch(in: lines[i]) || datedAssessmentWord.hasMatch(in: lines[i]))
  }) {
    issues.append(Issue(code: "missing-dates", severity: .fail, message: "The schedule lists dated assessments, but the answer contains none."))
  }
  if lines.isEmpty && examWord.hasMatch(in: fullText ?? source) {
    issues.append(Issue(code: "no-dates", severity: .review,
                        message: "We found exams in this syllabus but no dates for them. Check the course schedule."))
  }
  for item in result.items {
    if item.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      issues.append(Issue(code: "label", severity: .fail, message: "An item on \(item.date) has no name."))
    }
    guard isRealDate(item.date), let itemYear = Int(item.date.prefix(4)) else {
      issues.append(Issue(code: "date-format", severity: .fail, message: "\"\(item.label)\" has an invalid date \"\(item.date)\"."))
      continue
    }
    let rows = year == nil ? datedLines(itemYear) : dates
    let anchors = rows.map { !$0.isEmpty }
    var grounded = false
    var bound = false
    for (i, row) in rows.enumerated() where row.contains(where: { $0.iso == item.date }) {
      grounded = true
      if dateBound(item, context: context(lines, at: i, anchors: anchors), dates: row) {
        bound = true
        break
      }
    }
    if !grounded {
      issues.append(Issue(code: "date-not-in-text", severity: .fail, message: "\(item.date) for \"\(item.label)\" does not appear in the syllabus."))
      let sameDay = rows.joined().filter { $0.iso.dropFirst(5) == item.date.dropFirst(5) }
      if !sameDay.isEmpty && sameDay.allSatisfy(\.explicitYear) {
        issues.append(Issue(code: "year-mismatch", severity: .fail, message: "The written year for \"\(item.label)\" differs from \(item.date.prefix(4))."))
      }
    } else if !bound {
      issues.append(Issue(code: "date-not-bound", severity: .fail, message: "Cannot link \"\(item.label)\" to \(item.date) in the schedule."))
    }
    if let term, item.date < term.start || item.date > term.end {
      let boundary = item.date < term.start ? "starts \(term.start)" : "ends \(term.end)"
      let termName = term.label.map { $0.isEmpty ? "Term" : "\($0) term" } ?? "Term"
      issues.append(Issue(code: "outside-term", severity: .review,
                          message: "\(termName) \(boundary); check the term or this date (\(item.date))."))
    }
  }
  return CheckReport(issues: issues)
}

/// The first bound window with its original line breaks.
public func evidenceFor(_ component: GradingComponent, source: String) -> String? {
  guard component.weight > 0 && component.weight <= 100 else { return nil }
  let grading = GradingRows(source)
  guard let amount = grading.pointMode ? component.points : component.weight else { return nil }
  return grading.evidence.first { $0.binds(component, amount) }?.window
}

/// The first bound window with its original line breaks.
public func evidenceFor(_ item: DatedItem, source: String, term: Term? = nil) -> String? {
  guard isRealDate(item.date), !item.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        let year = Int(term?.start.prefix(4) ?? item.date.prefix(4)) else { return nil }
  let lines = syllabusLines(source)
  let rows = lines.map { findDates($0, defaultYear: year, term: term) }
  let anchors = rows.map { !$0.isEmpty }
  guard let index = rows.indices.first(where: { i in
    rows[i].contains { $0.iso == item.date } && dateBound(item, context: context(lines, at: i, anchors: anchors), dates: rows[i])
  }) else { return nil }
  return context(lines, at: index, anchors: anchors, separator: "\n")
}

public struct RemovedItem: Equatable, Sendable {
  public let item: DatedItem
  public let reason: String
}
