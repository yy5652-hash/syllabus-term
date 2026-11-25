import Foundation

public struct DateMatch: Equatable, Sendable {
  public let iso: String
  public let explicitYear: Bool
  /// UTF-16 offset in the source, matching the web parser.
  public let index: Int
  public let raw: String
}

private let months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
private let datePattern: NSRegularExpression = {
  let month = "(?:" + (months + ["sept"] + months.map { String($0.prefix(3)) }).joined(separator: "|") + #")\.?"#
  let weekday = #"(?:(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\.?,?[ \t]+)?"#
  let space = #"[ \t]+"#
  func day(_ name: String) -> String { #"(?<\#(name)>[0-9]{1,2})(?:st|nd|rd|th)?"# }
  func year(_ name: String) -> String { #"(?:,?\#(space)(?<\#(name)>[0-9]{4}))?"# }
  let formats = [
    #"(?<isoYear>[0-9]{4})-(?<isoMonth>[0-9]{2})-"# + day("isoDay"),
    #"(?<slashMonth>[0-9]{1,2})/"# + day("slashDay") + #"(?:/(?<slashYear>[0-9]{4}|[0-9]{2}))?(?!/[0-9])"#,
    #"(?<dashMonth>[0-9]{1,2})-"# + day("dashDay") + #"-(?<dashYear>[0-9]{4}|[0-9]{2})"#,
    #"(?<monthFirst>\#(month))"# + space + day("dayAfter") + year("yearAfter"),
    day("dayFirst") + space + #"(?:of\#(space))?(?<monthAfter>\#(month))(?!\#(space)[0-9]{1,2}(?:st|nd|rd|th)?\b)"# + year("yearLast"),
  ]
  return syllabusRegex(#"\b\#(weekday)(?:\#(formats.joined(separator: "|")))\b"#, options: .caseInsensitive)
}()

private func isoDate(_ year: Int, _ month: Int, _ day: Int) -> String {
  guard (0...9999).contains(year) else { return "" }
  return String(format: "%04d-%02d-%02d", year, month, day)
}

private let isoPattern = syllabusRegex(#"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#)

public func isRealDate(_ iso: String) -> Bool {
  guard iso.utf8.count == 10, isoPattern.hasMatch(in: iso),
        let year = Int(iso.prefix(4)), let month = Int(iso.dropFirst(5).prefix(2)),
        let day = Int(iso.suffix(2)), (1...12).contains(month) else { return false }
  let leap = year.isMultiple(of: 4) && (!year.isMultiple(of: 100) || year.isMultiple(of: 400))
  let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return (1...days[month - 1]).contains(day)
}

public func findDates(_ text: String, defaultYear: Int, term: Term? = nil) -> [DateMatch] {
  let source = text as NSString
  return datePattern.matches(in: text, range: NSRange(location: 0, length: source.length)).compactMap { match in
    func capture(_ name: String) -> String? {
      let range = match.range(withName: name)
      return range.location == NSNotFound ? nil : source.substring(with: range)
    }
    let month: Int
    if let named = capture("monthFirst") ?? capture("monthAfter") {
      guard let index = months.firstIndex(where: { $0.hasPrefix(named.prefix(3).lowercased()) }) else { return nil }
      month = index + 1
    } else {
      let numericMonth = capture("isoMonth") ?? capture("slashMonth") ?? capture("dashMonth")
      guard let number = numericMonth.flatMap({ Int($0) }) else { return nil }
      month = number
    }
    let numericDay = capture("isoDay") ?? capture("slashDay") ?? capture("dashDay") ?? capture("dayAfter") ?? capture("dayFirst")
    guard let day = numericDay.flatMap({ Int($0) }) else { return nil }
    let written = capture("isoYear") ?? capture("slashYear") ?? capture("dashYear") ?? capture("yearAfter") ?? capture("yearLast")
    let year = written.flatMap { digits in Int(digits).map { $0 + (digits.count == 2 ? 2000 : 0) } } ?? defaultYear
    var iso = isoDate(year, month, day)
    if written == nil, let term, let firstYear = Int(term.start.prefix(4)),
       let lastYear = Int(term.end.prefix(4)), firstYear <= lastYear {
      for candidateYear in firstYear...lastYear {
        let candidate = isoDate(candidateYear, month, day)
        if candidate >= term.start && candidate <= term.end && isRealDate(candidate) {
          iso = candidate
          break
        }
      }
    }
    guard isRealDate(iso) else { return nil }
    return DateMatch(iso: iso, explicitYear: written != nil, index: match.range.location, raw: source.substring(with: match.range))
  }
}

public func lineHasDate(_ line: String) -> Bool { !findDates(line, defaultYear: 2000).isEmpty }

private let termPattern: NSRegularExpression = {
  let season = "(Fall|Autumn|Spring|Summer|Winter)"
  let year = "(20[0-9]{2})"
  return syllabusRegex(#"\b(?:\#(season)(?:\s+(?:Term|Semester|Quarter))?\s+\#(year)|\#(year)\s+\#(season))\b"#,
                       options: .caseInsensitive)
}()

public func inferTerm(_ text: String) -> Term? {
  let source = text as NSString
  guard let match = termPattern.firstMatch(in: text, range: NSRange(location: 0, length: source.length)) else { return nil }
  let seasonFirst = match.range(at: 1).location != NSNotFound
  let season = source.substring(with: match.range(at: seasonFirst ? 1 : 4)).lowercased()
  guard let year = Int(source.substring(with: match.range(at: seasonFirst ? 2 : 3))) else { return nil }
  switch season {
  case "spring": return Term(label: "Spring \(year)", start: "\(year)-01-01", end: "\(year)-05-31")
  case "summer": return Term(label: "Summer \(year)", start: "\(year)-05-15", end: "\(year)-08-31")
  case "winter": return Term(label: "Winter \(year)", start: "\(year)-12-15", end: "\(year + 1)-02-28")
  default: return Term(label: "Fall \(year)", start: "\(year)-08-15", end: "\(year)-12-31")
  }
}

private let explicitYearPattern = syllabusRegex(#"\b20[0-9]{2}\b"#)

public func inferYear(_ text: String) -> Int? {
  var counts: [Int: Int] = [:]
  var writtenOrder: [Int] = []
  for line in syllabusLines(text) where lineHasDate(line) {
    let source = line as NSString
    for match in explicitYearPattern.matches(in: line, range: NSRange(location: 0, length: source.length)) {
      guard let year = Int(source.substring(with: match.range)) else { continue }
      if counts[year] == nil { writtenOrder.append(year) }
      counts[year, default: 0] += 1
    }
  }
  return writtenOrder.max { counts[$0, default: 0] < counts[$1, default: 0] }
}
