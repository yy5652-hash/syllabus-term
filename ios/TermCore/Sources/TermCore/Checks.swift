// Deterministic checks run on every model answer (port of web/src/core/checks.ts).
// A "fail" issue means the section is not trusted and is escalated to the cloud.
import Foundation

public enum Severity: String, Sendable { case fail, warn }

public struct Issue: Equatable, Sendable {
  public var code: String
  public var severity: Severity
  public var message: String
}

public struct CheckReport: Equatable, Sendable {
  public var issues: [Issue]
  public var ok: Bool { !issues.contains { $0.severity == .fail } }
}

func norm(_ s: String) -> String {
  s.lowercased()
    .replacingOccurrences(of: "–", with: "-").replacingOccurrences(of: "—", with: "-")
    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
}

func matches(_ pattern: String, _ s: String) -> Bool {
  s.range(of: pattern, options: .regularExpression) != nil
}

private let stop: Set<String> = ["the", "and", "for", "with", "your", "final", "class", "course", "grade", "total", "each"]

func significantWords(_ name: String) -> [String] {
  norm(name).split(whereSeparator: { !($0.isASCII && ($0.isLetter || $0.isNumber)) })
    .map(String.init).filter { $0.count >= 4 && !stop.contains($0) }
}

func formatWeight(_ w: Double, decimals: Int) -> String { String(format: "%.\(decimals)f", w) }

/// Weight like 30 or 12.5 appears in the text as a percentage (30%, 30 %, 30 percent).
public func weightGrounded(_ weight: Double, _ source: String) -> Bool {
  let s = norm(source)
  var forms: Set<String> = []
  if weight == weight.rounded() { forms.insert(formatWeight(weight, decimals: 0)) }
  if Double(formatWeight(weight, decimals: 1)) == weight { forms.insert(formatWeight(weight, decimals: 1)) }
  let shortest = String(weight)
  if Double(shortest) == weight, !shortest.hasSuffix(".0") { forms.insert(shortest) }
  for f in forms {
    let esc = f.replacingOccurrences(of: ".", with: "\\.")
    if matches("(^|[^0-9.])\(esc)\\s*(%|percent|pct)", s) { return true }
  }
  return false
}

private func round1(_ x: Double) -> String {
  let r = (x * 10).rounded() / 10
  return r == r.rounded() ? String(Int(r)) : String(r)
}

private func weightText(_ w: Double) -> String { w == w.rounded() ? String(Int(w)) : String(w) }

public func checkGrading(_ r: GradingResult?, source: String) -> CheckReport {
  guard let r else { return CheckReport(issues: [Issue(code: "json", severity: .fail, message: "The answer did not follow the grading schema.")]) }
  var issues: [Issue] = []
  if r.components.isEmpty { issues.append(Issue(code: "empty", severity: .fail, message: "No grading components found.")) }
  var seen: Set<String> = []
  let src = norm(source)
  for c in r.components {
    let key = norm(c.name).trimmingCharacters(in: .whitespaces)
    if seen.contains(key) { issues.append(Issue(code: "duplicate", severity: .fail, message: "\"\(c.name)\" is listed twice.")) }
    seen.insert(key)
    guard c.weight > 0 && c.weight <= 100 else {
      issues.append(Issue(code: "range", severity: .fail, message: "\"\(c.name)\" has weight \(weightText(c.weight)), outside 0–100."))
      continue
    }
    if !weightGrounded(c.weight, source) {
      issues.append(Issue(code: "weight-not-in-text", severity: .fail, message: "\(weightText(c.weight))% for \"\(c.name)\" does not appear in the syllabus."))
    }
    let words = significantWords(c.name)
    if !words.isEmpty && !words.contains(where: { src.contains($0) }) {
      issues.append(Issue(code: "name-not-in-text", severity: .fail, message: "\"\(c.name)\" is not mentioned in the syllabus."))
    }
  }
  let sum = r.components.reduce(0) { $0 + $1.weight }
  if !r.components.isEmpty && abs(sum - 100) > 0.5 {
    issues.append(Issue(code: "sum", severity: .fail, message: "Weights add up to \(round1(sum))%, not 100%."))
  }
  return CheckReport(issues: issues)
}

private let months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

public func isRealDate(_ iso: String) -> Bool {
  guard matches(#"^\d{4}-\d{2}-\d{2}$"#, iso) else { return false }
  let p = iso.split(separator: "-").compactMap { Int($0) }
  var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
  guard let d = cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return false }
  let c = cal.dateComponents([.year, .month, .day], from: d)
  return c.year == p[0] && c.month == p[1] && c.day == p[2]
}

/// The date is written somewhere in the text: "Oct 14", "October 14th", "14 Oct", "10/14", "2026-10-14".
public func dateGrounded(_ iso: String, _ source: String) -> Bool {
  guard isRealDate(iso) else { return false }
  let p = iso.split(separator: "-").compactMap { Int($0) }
  let (mm, dd) = (p[1], p[2])
  let s = norm(source)
  if s.contains(iso) { return true }
  let month = months[mm - 1]
  let day = "0?\(dd)(st|nd|rd|th)?"
  for n in [month, String(month.prefix(3)), String(month.prefix(4))] {
    if matches("\\b\(n)\\.?\\s+\(day)\\b", s) { return true }
    if matches("\\b\(day)\\s+(of\\s+)?\(n)\\b", s) { return true }
  }
  return matches("(^|[^0-9])0?\(mm)/0?\(dd)([^0-9]|$)", s)
}

public func checkSchedule(_ r: ScheduleResult?, source: String, term: Term? = nil) -> CheckReport {
  guard let r else { return CheckReport(issues: [Issue(code: "json", severity: .fail, message: "The answer did not follow the schedule schema.")]) }
  var issues: [Issue] = []
  for it in r.items {
    if it.label.trimmingCharacters(in: .whitespaces).isEmpty {
      issues.append(Issue(code: "label", severity: .fail, message: "An item on \(it.date) has no name."))
    }
    guard isRealDate(it.date) else {
      issues.append(Issue(code: "date-format", severity: .fail, message: "\"\(it.label)\" has an invalid date \"\(it.date)\"."))
      continue
    }
    if !dateGrounded(it.date, source) {
      issues.append(Issue(code: "date-not-in-text", severity: .fail, message: "\(it.date) for \"\(it.label)\" does not appear in the syllabus."))
    }
    if let term, it.date < term.start || it.date > term.end {
      issues.append(Issue(code: "outside-term", severity: .fail, message: "\"\(it.label)\" on \(it.date) falls outside the term."))
    }
  }
  return CheckReport(issues: issues)
}
