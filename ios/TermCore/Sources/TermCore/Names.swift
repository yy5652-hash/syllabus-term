import Foundation

func syllabusRegex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression {
  // JavaScript's word boundaries use ASCII word characters.
  let boundary = #"(?:(?<=[a-zA-Z0-9_])(?![a-zA-Z0-9_])|(?<![a-zA-Z0-9_])(?=[a-zA-Z0-9_]))"#
  return try! NSRegularExpression(pattern: pattern.replacingOccurrences(of: #"\b"#, with: boundary), options: options)
}

extension NSRegularExpression {
  func hasMatch(in text: String) -> Bool {
    firstMatch(in: text, range: NSRange(location: 0, length: text.utf16.count)) != nil
  }
}

func syllabusLines(_ text: String) -> [String] {
  text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

func norm(_ text: String) -> String {
  text.lowercased()
    .replacingOccurrences(of: "–", with: "-").replacingOccurrences(of: "—", with: "-")
    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
}

private let stop: Set<String> = ["the", "and", "for", "with", "your", "final", "class", "course", "grade", "total", "each"]

private func words(_ text: String) -> [String] {
  text.utf8.split { !(97...122).contains($0) && !(48...57).contains($0) }
    .map { String(decoding: $0, as: UTF8.self) }
}

func significantWords(_ name: String) -> [String] {
  words(norm(name)).filter { $0.count >= 4 && !stop.contains($0) }
}

private let aliases: [(NSRegularExpression, String)] = [
  (#"\b(?:mid[ -]?terms?|exams?)\b"#, "exam"),
  (#"\b(?:finals?|cumulative)\b"#, "final"),
  (#"\b(?:homeworks?|hw|problem[ -]sets?|psets?|assignments?)\b"#, "homework"),
  (#"\bquiz(?:zes)?\b"#, "quiz"),
  (#"\b(?:participation|attendance)\b"#, "participation"),
  (#"\b(?:papers?|essays?)\b"#, "paper"),
  (#"\bprojects?\b"#, "project"),
  (#"\blabs?\b"#, "lab"),
  (#"\b(test|post|presentation|report)s?\b"#, "$1"),
].map { (syllabusRegex($0.0), $0.1) }

let assessmentNoun = "mid[ -]?term|exam|test|quiz|paper|essay|project|assignment|homework|problem[ -]set|lab|blog post|post|presentation|report"
let pluralSuffix = "(?:s|(?<=quiz)zes)"
private let ordinalWords = "first second third fourth fifth sixth seventh eighth ninth tenth".components(separatedBy: " ")
private let suffixes = "1st 2nd 3rd 4th 5th 6th 7th 8th 9th 10th".components(separatedBy: " ")
private let roman = "i ii iii iv v vi vii viii ix x".components(separatedBy: " ")
private let explicit = syllabusRegex(#"\b("# + (ordinalWords + suffixes).joined(separator: "|") + #")\b"#)
private let numbered = syllabusRegex(#"\b((?:"# + assessmentNoun + ")" + pluralSuffix + #"?)\s*(10|[1-9]|"# + roman.joined(separator: "|") + #")\b"#)

extension NSRegularExpression {
  func all(_ text: String) -> [NSTextCheckingResult] {
    matches(in: text, range: NSRange(text.startIndex..., in: text))
  }
  func replacing(_ text: String, with template: String) -> String {
    stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
  }
}

func ordinals(_ text: String) -> [Int] {
  let label = norm(text)
  let outsideParens = label.replacingOccurrences(of: #"\([^()]*\)"#, with: " ", options: .regularExpression)
  let source = label as NSString
  return explicit.all(label).compactMap { match in
    let token = source.substring(with: match.range(at: 1))
    return (ordinalWords.firstIndex(of: token) ?? suffixes.firstIndex(of: token)).map { $0 + 1 }
  } + numbered.all(outsideParens).compactMap { match in
    let token = (outsideParens as NSString).substring(with: match.range(at: 2))
    return Int(token) ?? roman.firstIndex(of: token).map { $0 + 1 }
  }
}

func nameWords(_ name: String) -> [String] {
  var normalized = explicit.replacing(numbered.replacing(norm(name), with: "$1 "), with: " ")
  for (pattern, canonical) in aliases {
    normalized = pattern.stringByReplacingMatches(in: normalized, range: NSRange(location: 0, length: normalized.utf16.count), withTemplate: canonical)
  }
  return words(normalized).filter { word in
    (word.count >= 4 || word == "lab" || word == "due") && (word == "final" || !stop.contains(word)) &&
      word.contains(where: \.isLetter)
  }
}

func sharesWord(_ name: String, _ evidence: String) -> Bool {
  let evidenceWords = Set(nameWords(evidence))
  return nameWords(name).contains(where: evidenceWords.contains)
}

func hasOrdinal(_ text: String) -> Bool { !ordinals(text).isEmpty }

func ordinalsMatch(_ name: String, _ evidence: String) -> Bool {
  Set(ordinals(name)).isSubset(of: Set(ordinals(evidence)))
}

private let finalWord = syllabusRegex(#"\b(?:finals?|cumulative)\b"#, options: .caseInsensitive)
private let midtermWord = syllabusRegex(#"\bmid[ -]?terms?(?:\b|(?=\d))"#, options: .caseInsensitive)

func examConflict(_ name: String, _ evidence: String) -> Bool {
  let final = finalWord.hasMatch(in: evidence)
  let midterm = midtermWord.hasMatch(in: evidence)
  return (finalWord.hasMatch(in: name) && midterm && !final) ||
    (midtermWord.hasMatch(in: name) && final && !midterm)
}

private let specificAssessments: Set<String> = ["homework", "paper", "project", "quiz", "lab", "presentation", "report"]

func differentAssessments(_ label: String, _ evidence: String) -> Bool {
  let named = specificAssessments.intersection(nameWords(label))
  let present = specificAssessments.intersection(nameWords(evidence))
  return !named.isEmpty && !present.isEmpty && named.isDisjoint(with: present)
}
