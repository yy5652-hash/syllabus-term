// Values annotated by a table header retain their original PDF lines for citations.
import Foundation

private let percent = syllabusRegex(#"(?<![.\d])(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?|pct|additional (?:percentage )?points?\b)"#, options: .caseInsensitive)
private let points = syllabusRegex(#"(?<![.\d])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:points?|pts)\b"#, options: .caseInsensitive)
private let tableHeader = syllabusRegex(#"^\s*(?:type|item|category|component|assessment|assignment|activity)\s*[|\s]+(?:%|weight(?:\s*\(%\))?|percent(?:age)?)(?:[|\s]+(?:description|notes?|details?))?[|\s]*$"#, options: .caseInsensitive)
private let tableRow = syllabusRegex(#"^\s*([a-z][a-z -]*?(?:\s+\d+)?)\s*[|\s]+(\d+(?:\.\d+)?)(?=[|\s]|$)(.*)$"#, options: .caseInsensitive)
private let parenthetical = syllabusRegex(#"\((\d+(?:\.\d+)?)\)"#)
private let countWords = "zero one two three four five six seven eight nine ten".components(separatedBy: " ")
private let countNoun = syllabusRegex(#"\b(\d+|"# + countWords.dropFirst(2).joined(separator: "|") + #")\s+("# + assessmentNoun + ")" + pluralSuffix + #"?\b"#, options: .caseInsensitive)
private let eachWord = syllabusRegex(#"^\s*each\b"#, options: .caseInsensitive)
private let bonusText = syllabusRegex(#"\b(?:extra[ -]credit|bonus|additional (?:percentage )?points?|added to your (?:final )?grade)\b"#, options: .caseInsensitive)
private let bonusHeading = syllabusRegex(#"^\s*(?:extra[ -]credit|bonus)[:\s]*$"#, options: .caseInsensitive)
private let pluralHeading = syllabusRegex(#"\b("# + assessmentNoun + ")" + pluralSuffix + #"[\s(:=—–-]*$"#, options: .caseInsensitive)
private let unnamed = syllabusRegex(#"^[\s(,:=&-]*(?:and\b[\s,]*)?$"#, options: .caseInsensitive)
private let introducesParts = syllabusRegex(#"^\s*\)?\s*[:=]"#)
private let opensParts = syllabusRegex(#"^\s*\([^)]*$"#)
let totalWord = syllabusRegex(#"\btotal\b"#, options: .caseInsensitive)

private func equal(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-7 }
private func capitalized(_ name: String) -> String { name.prefix(1).uppercased() + name.dropFirst() }
public func lineHasWeight(_ line: String) -> Bool { percent.hasMatch(in: line) }
public func weightGrounded(_ weight: Double, _ source: String) -> Bool {
  percent.all(source).contains { Double((source as NSString).substring(with: $0.range(at: 1))) == weight }
}

struct GradingRows {
  let lines: [String]
  let annotated: [String]
  let pointMode: Bool
  let unit: NSRegularExpression
  let anchors: [Bool]

  init(_ source: String) {
    lines = syllabusLines(source)
    var inTable = false
    annotated = lines.map { line in
      if tableHeader.hasMatch(in: line) { inTable = true; return line }
      let text = line.trimmingCharacters(in: .whitespaces) as NSString
      guard inTable, let row = tableRow.all(text as String).first,
            let weight = Double(text.substring(with: row.range(at: 2))), weight <= 100 else { inTable = false; return line }
      var detail = text.substring(with: row.range(at: 3))
      let parts = parenthetical.all(detail).compactMap { Double((detail as NSString).substring(with: $0.range(at: 1))) }
      if parts.count >= 2 && equal(parts.reduce(0, +), weight) { detail = parenthetical.replacing(detail, with: "$1%") }
      return text.substring(with: row.range(at: 1)) + " " + text.substring(with: row.range(at: 2)) + "%" + detail
    }
    pointMode = !annotated.contains(where: lineHasWeight) && annotated.contains(where: points.hasMatch)
    unit = pointMode ? points : percent
    anchors = annotated.map(unit.hasMatch)
  }
}

public func gradingUsesPoints(_ source: String) -> Bool { GradingRows(source).pointMode }

struct GradeRow {
  struct Entry { var label: String; let value: Double; let introducesParts: Bool; let each: Bool }
  struct Each { let label: String; let perItem: Double; let count: Int; let noun: String }
  let index: Int
  let row: String
  let window: String
  let entries: [Entry]
  let groups: [Each]
  let bonus: Bool

  func binds(_ component: GradingComponent, _ value: Double) -> Bool {
    let numbers = ordinals(component.name)
    if numbers.count == 1 && groups.contains(where: { $0.count >= 2 && $0.perItem == value && sharesWord(component.name, $0.noun) &&
      !examConflict(component.name, $0.label) && numbers[0] <= $0.count }) { return true }
    return entries.contains { $0.value == value && sharesWord(component.name, $0.label) &&
      ordinalsMatch(component.name, $0.label) && !examConflict(component.name, $0.label) }
  }
}

private func numberUnnamedParts(_ entries: [GradeRow.Entry]) -> [GradeRow.Entry] {
  var numbered = entries
  for (i, entry) in entries.enumerated() {
    guard let heading = pluralHeading.all(entry.label).first else { continue }
    let start = entry.introducesParts ? i + 1 : i
    var end = i + 1
    while end < entries.count && unnamed.hasMatch(in: entries[end].label) { end += 1 }
    guard end - start >= 2 else { continue }
    let parts = entries[start..<end]
    if entry.introducesParts && !equal(parts.reduce(0) { $0 + $1.value }, entry.value) { continue }
    let noun = capitalized((entry.label as NSString).substring(with: heading.range(at: 1)).lowercased())
    for j in parts.indices { numbered[j].label = "\(noun) \(j - start + 1)" }
  }
  return numbered
}

extension GradingRows {
  var evidence: [GradeRow] {
    annotated.indices.compactMap { i in
      let line = annotated[i] as NSString
      let matches = unit.all(line as String)
      guard !matches.isEmpty else { return nil }
      let indices = ((i - 1)...(i + 1)).filter { lines.indices.contains($0) && ($0 == i || !anchors[$0]) }
      let row = indices.map { annotated[$0] }.joined(separator: " ")
      let preceding = indices.contains(i - 1) ? annotated[i - 1] + " " : ""
      var end = 0
      let entries = matches.enumerated().map { n, m in
        let label = matches.count == 1 ? unit.replacing(row, with: " ") :
          (n == 0 ? preceding : "") + line.substring(with: NSRange(location: end, length: m.range.location - end))
        end = NSMaxRange(m.range)
        let raw = line.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: "")
        let opensInlineParts = matches.indices.contains(n + 1) &&
          opensParts.hasMatch(in: line.substring(with: NSRange(location: end, length: matches[n + 1].range.location - end)))
        let introduces = introducesParts.hasMatch(in: line.substring(from: end)) ||
          opensInlineParts || (n == 0 && matches.count > 1 && line as String != lines[i])
        let each = eachWord.hasMatch(in: line.substring(from: end)) ||
          (matches.count == 1 && annotated.indices.contains(i + 1) && eachWord.hasMatch(in: annotated[i + 1]))
        return GradeRow.Entry(label: label, value: Double(raw) ?? 0, introducesParts: introduces, each: each)
      }
      let groups: [GradeRow.Each] = entries.enumerated().compactMap { j, entry in
        guard entry.each && !pointMode else { return nil }
        let label = nameWords(entry.label).isEmpty && j > 0 ? entries[j - 1].label : entry.label
        let counts = countNoun.all(label)
        let text = label as NSString
        let token = counts.count == 1 ? text.substring(with: counts[0].range(at: 1)).lowercased() : ""
        let noun = counts.count == 1 ? text.substring(with: counts[0].range(at: 2)).lowercased() : ""
        return GradeRow.Each(label: label, perItem: entry.value, count: Int(token) ?? countWords.firstIndex(of: token) ?? 0, noun: noun)
      }
      let nextBonus = anchors.indices.contains(i + 2) && anchors[i + 2] && bonusHeading.hasMatch(in: lines[i + 1])
      return GradeRow(index: i, row: row, window: indices.map { lines[$0] }.joined(separator: "\n"), entries: numberUnnamedParts(entries),
        groups: groups,
        bonus: bonusText.hasMatch(in: nextBonus ? preceding + (line as String) : row))
    }
  }
}

struct GradingPart { let name: String; let value: Double }

private let partHeading = syllabusRegex(#"^[^(]*\(\s*(?=[a-z])"#, options: .caseInsensitive)
private let partEdges = syllabusRegex(#"^[^a-z0-9]+|[^a-z0-9]+$"#, options: .caseInsensitive)
private let partPrefix = syllabusRegex(#"^(?:and\s+)?(?:(?:one|an?)\s+)?"#, options: .caseInsensitive)
private let partSuffix = syllabusRegex(#"\s+(?:(?:is\s+)?worth|counts?\s+for|at|is)$"#, options: .caseInsensitive)
private let partName = syllabusRegex(#"^(?:\d+(?:st|nd|rd|th) +)?[a-z][a-z0-9]*(?:[ -]+[a-z0-9]+)*$"#, options: .caseInsensitive)

private func namedParts(_ entries: [GradeRow.Entry]) -> [GradingPart] {
  let parts = entries.map { entry in
    let label = partEdges.replacing(partHeading.replacing(entry.label, with: ""), with: "")
    let name = partSuffix.replacing(partPrefix.replacing(label, with: ""), with: "")
    return GradingPart(name: capitalized(name), value: entry.value)
  }
  guard parts.allSatisfy({ partName.hasMatch(in: $0.name) && !nameWords($0.name).isEmpty }),
        Set(parts.map { $0.name.lowercased() }).count == parts.count else { return [] }
  return parts
}

// Keep a subtotal inside its own inline or consecutive named parts.
private func sourceGroup(_ name: String, _ amount: Double, _ rows: [GradeRow]) -> [GradingPart]? {
  func member(_ label: String) -> Bool {
    sharesWord(name, label) || (sharesWord(name, "exam") && sharesWord(label, "final"))
  }
  var found = false
  for (i, row) in rows.enumerated() {
    guard sharesWord(name, row.row), !examConflict(name, row.row) else { continue }
    let parent = row.entries.firstIndex { $0.value == amount && sharesWord(name, $0.label) && ordinalsMatch(name, $0.label) }
    if parent == nil && hasOrdinal(name) { continue }
    for group in row.groups {
      let ratio = amount / group.perItem
      guard sharesWord(name, group.label), group.perItem > 0, ratio >= 2, equal(ratio.rounded() * group.perItem, amount) else { continue }
      found = true
      guard (2...1000).contains(group.count), sharesWord(name, group.noun), !examConflict(name, group.label),
            equal(Double(group.count) * group.perItem, amount), !hasOrdinal(name) else { continue }
      let noun = capitalized(group.noun)
      return (1...group.count).map { GradingPart(name: "\(noun) \($0)", value: group.perItem) }
    }
    let members = row.entries.dropFirst(parent.map { $0 + 1 } ?? 0)
    let introduced = parent.map { row.entries[$0].introducesParts } ?? false
    var sum = 0.0
    var parts: [GradeRow.Entry] = []
    for j in i..<rows.count {
      if j > i && rows[j].index != rows[j - 1].index + 1 { break }
      let entries = j == i ? members : rows[j].entries[...]
      var stop = false
      for entry in entries {
        if entry.value <= 0 || entry.value >= amount || (!introduced && !member(entry.label)) { stop = true; break }
        sum += entry.value
        parts.append(entry)
        if parts.count >= 2 && equal(sum, amount) {
          let named = namedParts(parts)
          if !named.isEmpty { return named }
          found = true
          break
        }
      }
      if stop || sum >= amount { break }
    }
  }
  return found ? [] : nil
}

private let nameBreakdown = syllabusRegex(#"^(.+?)\s*\(([^()]+)\)\s*$"#)

// An empty array identifies a subtotal without enough information to repair it.
func groupParts(_ component: GradingComponent, _ rows: [GradeRow], pointMode: Bool) -> [GradingPart]? {
  guard let amount = pointMode ? component.points : component.weight, amount.isFinite, amount > 0 else { return nil }
  let unit = pointMode ? points : percent
  let name = component.name as NSString
  guard let match = nameBreakdown.all(component.name).first else { return sourceGroup(component.name, amount, rows) }
  let breakdown = name.substring(with: match.range(at: 2))
  guard unit.all(breakdown).count >= 2 else { return sourceGroup(component.name, amount, rows) }
  let heading = name.substring(with: match.range(at: 1))
  let fromSource = sourceGroup(heading, amount, rows)
  if let fromSource, !fromSource.isEmpty { return fromSource }
  let ownRow = GradingRows("\(heading) \(amount)\(pointMode ? " points" : "%"): \(breakdown)").evidence.first
  if let entries = ownRow?.entries.dropFirst(), entries.count >= 2, entries.allSatisfy({ $0.value > 0 }),
     equal(entries.reduce(0) { $0 + $1.value }, amount) {
    let parts = namedParts(Array(entries))
    if !parts.isEmpty { return parts }
  }
  return fromSource
}
